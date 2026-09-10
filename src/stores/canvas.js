/**
 * Canvas store | 画布状态管理
 * Manages nodes, edges and canvas state
 */
import { ref } from 'vue'
import { updateProjectCanvas, getProjectCanvas } from './projects'
import { saveImage, loadImage, listImageKeys } from './imageStore'
import { createDefaultNodeData } from '../config/nodeRegistry'
import { migrateCanvasDocument } from '../utils/migrateCanvasDocument'

// Node ID counter | 节点ID计数器
let nodeId = 0
const createUniqueId = (prefix) => {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}
const getNodeId = () => createUniqueId('node')
const getEdgeId = () => createUniqueId('edge')

// Current project ID | 当前项目ID
export const currentProjectId = ref(null)

// Nodes and edges | 节点和边
export const nodes = ref([])
export const edges = ref([])

// Homepage reference images pending for canvas | 首页待带入画布的参考图（内存传递，绕开 sessionStorage 容量限制）
export const pendingReferenceImages = ref([])

// Viewport state | 视口状态
export const canvasViewport = ref({ x: 100, y: 50, zoom: 0.8 })

// Selected node | 选中的节点
export const selectedNode = ref(null)

// Auto-save flag | 自动保存标志
let autoSaveEnabled = false
let saveTimeout = null

// History for undo/redo | 撤销/重做历史
const history = ref([])
const historyIndex = ref(-1)
const MAX_HISTORY = 50
let isRestoring = false
let historyTimeout = null

// Position change threshold for history | 位置变化阈值
const POSITION_THRESHOLD = 10

// Batch operation tracking | 批量操作跟踪
let isBatchOperation = false
let batchStartState = null

/**
 * Save current state to history | 保存当前状态到历史
 * @param {boolean} force - Force save even if batch operation | 强制保存，即使在批量操作中
 */
const saveToHistory = (force = false) => {
  if (isRestoring) return

  // If in batch operation and not forced, don't save | 如果在批量操作中且未强制保存，则不保存
  if (isBatchOperation && !force) return

  const state = {
    nodes: JSON.parse(JSON.stringify(nodes.value)),
    edges: JSON.parse(JSON.stringify(edges.value))
  }

  const current = history.value[historyIndex.value]
  if (current && JSON.stringify(current) === JSON.stringify(state)) return

  // Remove future history if we're not at the end | 如果不在末尾，删除未来历史
  if (historyIndex.value < history.value.length - 1) {
    history.value = history.value.slice(0, historyIndex.value + 1)
  }

  // Add new state | 添加新状态
  history.value.push(state)

  // Limit history size | 限制历史大小
  if (history.value.length > MAX_HISTORY) {
    history.value.shift()
  } else {
    historyIndex.value++
  }
}

// Coalesce rapid form edits into a single undo step.
const scheduleHistorySave = () => {
  if (isRestoring || isBatchOperation) return
  if (historyTimeout) clearTimeout(historyTimeout)
  historyTimeout = setTimeout(() => {
    historyTimeout = null
    saveToHistory()
  }, 350)
}

/**
 * Start batch operation | 开始批量操作
 * Records the starting state for batch operations
 */
export const startBatchOperation = () => {
  if (historyTimeout) {
    clearTimeout(historyTimeout)
    historyTimeout = null
    saveToHistory()
  }
  isBatchOperation = true
  batchStartState = {
    nodes: JSON.parse(JSON.stringify(nodes.value)),
    edges: JSON.parse(JSON.stringify(edges.value))
  }
}

/**
 * End batch operation and save to history | 结束批量操作并保存到历史
 * Compares with start state to decide if save is needed
 */
export const endBatchOperation = () => {
  if (!isBatchOperation || !batchStartState) {
    isBatchOperation = false
    return
  }

  // Check if there are significant changes | 检查是否有显著变化
  const hasSignificantChanges = checkSignificantChanges(batchStartState, {
    nodes: nodes.value,
    edges: edges.value
  })

  if (hasSignificantChanges) {
    saveToHistory(true)
    debouncedSave()
  }

  isBatchOperation = false
  batchStartState = null
}

/**
 * Check if changes are significant enough to save | 检查变化是否足够显著需要保存
 * @param {object} oldState - Previous state | 之前的状态
 * @param {object} newState - New state | 新状态
 * @returns {boolean} - Whether changes should be saved | 是否应该保存变化
 */
const checkSignificantChanges = (oldState, newState) => {
  const oldNodes = oldState.nodes || []
  const newNodes = newState.nodes || []

  // Check for added or removed nodes | 检查添加或删除的节点
  if (oldNodes.length !== newNodes.length) {
    return true
  }

  // Check for new nodes (by comparing IDs) | 检查新节点
  const oldNodeIds = new Set(oldNodes.map(n => n.id))
  const newNodeIds = new Set(newNodes.map(n => n.id))

  // Nodes added | 添加的节点
  for (const id of newNodeIds) {
    if (!oldNodeIds.has(id)) {
      return true
    }
  }

  // Nodes removed | 删除的节点
  for (const id of oldNodeIds) {
    if (!newNodeIds.has(id)) {
      return true
    }
  }

  // Check position changes for existing nodes | 检查现有节点的位置变化
  for (const newNode of newNodes) {
    const oldNode = oldNodes.find(n => n.id === newNode.id)
    if (oldNode) {
      const dx = Math.abs(newNode.position.x - oldNode.position.x)
      const dy = Math.abs(newNode.position.y - oldNode.position.y)

      // If any node moved beyond threshold, save | 如果任何节点移动超过阈值，则保存
      if (dx > POSITION_THRESHOLD || dy > POSITION_THRESHOLD) {
        return true
      }
    }
  }

  // Check for edge changes | 检查边的变化
  const oldEdges = oldState.edges || []
  const newEdges = newState.edges || []

  if (oldEdges.length !== newEdges.length) {
    return true
  }

  return false
}

// Add a new node | 添加新节点
export const addNode = (type, position = { x: 100, y: 100 }, data = {}) => {
  const id = getNodeId()
  const now = Date.now()
  const newNode = {
    id,
    type,
    position,
    data: {
      ...createDefaultNodeData(type),
      ...data,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now
    }
  }
  nodes.value = [...nodes.value, newNode]
  saveToHistory() // Save after adding node | 添加节点后保存
  debouncedSave()
  return id
}

/**
 * Add multiple nodes in batch | 批量添加多个节点
 * Uses batch operation to group all node additions into one history entry
 * @param {Array} nodeSpecs - Array of node specs [{ type, position, data }, ...]
 * @param {boolean} autoBatch - Whether to auto-manage batch operation (default: true)
 * @returns {Array} - Array of created node IDs | 创建的节点ID数组
 */
export const addNodes = (nodeSpecs, autoBatch = true) => {
  if (!nodeSpecs || nodeSpecs.length === 0) return []

  // Start batch operation if auto | 如果自动管理则开始批量操作
  if (autoBatch) {
    startBatchOperation()
  }

  const ids = []
  const now = Date.now()

  nodeSpecs.forEach(spec => {
    const { type, position = { x: 100, y: 100 }, data = {} } = spec
    const id = getNodeId()
    const newNode = {
      id,
      type,
      position,
      data: {
        ...createDefaultNodeData(type),
        ...data,
        createdAt: data.createdAt || now,
        updatedAt: data.updatedAt || now
      }
    }
    nodes.value = [...nodes.value, newNode]
    ids.push(id)
  })

  // End batch operation if auto | 如果自动管理则结束批量操作并保存到历史
  if (autoBatch) {
    endBatchOperation()
  }

  return ids
}

// Update node data | 更新节点数据
export const updateNode = (id, data) => {
  const now = Date.now()
  nodes.value = nodes.value.map(node =>
    node.id === id ? { ...node, data: { ...node.data, ...data, updatedAt: data.updatedAt || now } } : node
  )
  scheduleHistorySave()
  debouncedSave()
}

// Update Vue Flow node-level properties without mixing them into node data.
export const updateNodeMeta = (id, patch) => {
  nodes.value = nodes.value.map(node => node.id === id ? { ...node, ...patch } : node)
  scheduleHistorySave()
  debouncedSave()
}

// Remove node | 删除节点
export const removeNode = (id) => {
  const removedNode = nodes.value.find(node => node.id === id)
  if (removedNode?.type === 'group') {
    nodes.value = nodes.value.map(node => {
      if (node.parentNode !== id) return node
      const { parentNode, extent, ...rest } = node
      const { groupId, ...data } = node.data || {}
      return {
        ...rest,
        position: {
          x: (removedNode.position?.x || 0) + (node.position?.x || 0),
          y: (removedNode.position?.y || 0) + (node.position?.y || 0)
        },
        data
      }
    })
  } else {
    nodes.value = nodes.value.map(node => node.type === 'group'
      ? { ...node, data: { ...node.data, memberIds: (node.data?.memberIds || []).filter(memberId => memberId !== id) } }
      : node)
  }
  nodes.value = nodes.value.filter(node => node.id !== id)
  edges.value = edges.value.filter(edge => edge.source !== id && edge.target !== id)
  saveToHistory() // Save after removing node | 删除节点后保存
  if (currentProjectId.value) deleteImage(`${currentProjectId.value}:${id}`).catch(() => {})
  debouncedSave()
}

// Duplicate node | 复制节点
export const duplicateNode = (id) => {
  const sourceNode = nodes.value.find(node => node.id === id)
  if (!sourceNode) return null
  
  const newId = getNodeId()
  
  // Calculate max z-index | 计算最大层级
  const maxZIndex = Math.max(0, ...nodes.value.map(n => n.zIndex || 0))
  
  const newNode = {
    id: newId,
    type: sourceNode.type,
    position: {
      x: sourceNode.position.x + 50,
      y: sourceNode.position.y + 50
    },
    data: { ...sourceNode.data },
    zIndex: maxZIndex + 1
  }
  nodes.value = [...nodes.value, newNode]
  saveToHistory() // Save after duplicating node | 复制节点后保存
  debouncedSave()
  return newId
}

// Add edge | 添加边
export const addEdge = (params) => {
  const newEdge = {
    ...params,
    id: params.id || getEdgeId()
  }
  edges.value = [...edges.value, newEdge]
  saveToHistory() // Save after adding edge | 添加连线后保存
  debouncedSave()
  return newEdge.id
}

/**
 * Add multiple edges in batch | 批量添加多条边
 * Uses batch operation to group all edge additions into one history entry
 * @param {Array} edgeSpecs - Array of edge specs [{ source, target, sourceHandle, targetHandle, type, data }, ...]
 * @param {boolean} autoBatch - Whether to auto-manage batch operation (default: true)
 * @returns {Array} - Array of created edge IDs | 创建的边ID数组
 */
export const addEdges = (edgeSpecs, autoBatch = true) => {
  if (!edgeSpecs || edgeSpecs.length === 0) return []

  // Start batch operation if auto | 如果自动管理则开始批量操作
  if (autoBatch) {
    startBatchOperation()
  }

  const ids = []

  edgeSpecs.forEach(params => {
    const newEdge = {
      ...params,
      id: params.id || getEdgeId()
    }
    edges.value = [...edges.value, newEdge]
    ids.push(newEdge.id)
  })

  // End batch operation if auto | 如果自动管理则结束批量操作并保存到历史
  if (autoBatch) {
    endBatchOperation()
  }

  return ids
}

// Update edge data | 更新边数据
export const updateEdge = (id, data) => {
  edges.value = edges.value.map(edge => 
    edge.id === id ? { ...edge, data: { ...edge.data, ...data } } : edge
  )
  saveToHistory() // Save after updating edge | 更新连线后保存
  debouncedSave()
}

// Remove edge | 删除边
export const removeEdge = (id) => {
  edges.value = edges.value.filter(edge => edge.id !== id)
  normalizeEdgeOrders()
  saveToHistory() // Save after removing edge | 删除连线后保存
  debouncedSave()
}

export const normalizeEdgeOrders = () => {
  const groups = new Map()
  edges.value.forEach(edge => {
    const key = `${edge.target}:${edge.targetHandle || 'left'}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(edge)
  })
  const orderById = new Map()
  groups.forEach(group => {
    group
      .sort((a, b) => (Number(a.data?.order) || 0) - (Number(b.data?.order) || 0))
      .forEach((edge, index) => orderById.set(edge.id, index + 1))
  })
  edges.value = edges.value.map(edge => ({
    ...edge,
    data: { ...(edge.data || {}), order: orderById.get(edge.id) || 1 }
  }))
}

// Clear canvas | 清空画布
export const clearCanvas = () => {
  nodes.value = []
  edges.value = []
  nodeId = 0
  debouncedSave()
}

/**
 * Load project data | 加载项目数据
 * @param {string} projectId - Project ID | 项目ID
 */
export const loadProject = (projectId) => {
  autoSaveEnabled = false
  isRestoring = true
  currentProjectId.value = projectId
  let imageRestorePromise = Promise.resolve()
  
  const canvasData = getProjectCanvas(projectId)
  
  if (canvasData) {
    const migratedCanvasData = migrateCanvasDocument(canvasData)
    // Restore nodes | 恢复节点
    nodes.value = migratedCanvasData.nodes || []
    edges.value = migratedCanvasData.edges || []
    canvasViewport.value = migratedCanvasData.viewport || { x: 100, y: 50, zoom: 0.8 }

    // Restore persisted node images from IndexedDB | 从 IndexedDB 恢复节点图片
    imageRestorePromise = restoreProjectImages(projectId, migratedCanvasData._imageNodeAliases)
    
    nodeId = nodes.value.length
  } else {
    // Empty project | 空项目
    clearCanvas()
  }
  
  // Initialize history with current state | 用当前状态初始化历史
  history.value = [{
    nodes: JSON.parse(JSON.stringify(nodes.value)),
    edges: JSON.parse(JSON.stringify(edges.value))
  }]
  historyIndex.value = 0
  
  // Do not let Vue Flow's initial layout events save a partially restored
  // document while IndexedDB images are still being reattached.
  imageRestorePromise.finally(() => {
    setTimeout(() => {
      autoSaveEnabled = true
      isRestoring = false
    }, 100)
  })
}

/**
 * Save current project | 保存当前项目
 */
export const saveProject = () => {
  if (!currentProjectId.value) return
  const projectId = currentProjectId.value
  // Never put Vue Flow's live reactive objects into the project store. Vue Flow
  // enriches nodes during mount (dimensions, dragging state, handle bounds, ...).
  // Sharing those objects with persistence can turn one internal layout update
  // into a cascade of project/localStorage updates.
  const snapshot = JSON.parse(JSON.stringify({
    schemaVersion: 2,
    nodes: nodes.value,
    edges: edges.value,
    viewport: canvasViewport.value
  }))
  updateProjectCanvas(projectId, {
    ...snapshot
  })
  persistProjectImages(projectId)
}

// Already-persisted asset fingerprints, avoids rewriting unchanged binary payloads.
const savedImageKeys = new Map()

/**
 * Persist node data-URL images to IndexedDB | 把节点里的 base64 图片写入 IndexedDB
 * (localStorage copies are stripped by cleanNodeForStorage)
 */
const persistProjectImages = (projectId) => {
  nodes.value.forEach((node) => {
    const base64 = node.data?.base64
    const dataUrl = base64 || (node.data?.url?.startsWith?.('data:') ? node.data.url : '')
    if (!dataUrl) return
    const key = `${projectId}:${node.id}`
    const fingerprint = `${dataUrl.length}:${dataUrl.slice(0, 64)}:${dataUrl.slice(-64)}`
    if (savedImageKeys.get(key) === fingerprint) return
    saveImage(key, dataUrl)
      .then(() => savedImageKeys.set(key, fingerprint))
      .catch(() => {})
  })
}

/**
 * Restore node images from IndexedDB after reload | 重新加载项目时从 IndexedDB 恢复节点图片
 */
const previousSequentialNodeId = (nodeId) => {
  const match = String(nodeId).match(/^(.*?)(\d+)$/)
  if (!match) return ''
  const index = Number(match[2])
  return index > 0 ? `${match[1]}${index - 1}` : ''
}

const restoreProjectImages = async (projectId, imageNodeAliases = {}) => {
  try {
    const prefix = `${projectId}:`
    const keys = await listImageKeys(prefix)
    if (!keys.length) return

    const nodesById = new Map(nodes.value.map(node => [String(node.id), node]))
    const claimedNodeIds = new Set()

    for (const key of keys) {
      const storedNodeId = String(key).slice(prefix.length)
      const aliasedNodeId = imageNodeAliases?.[storedNodeId]
      let node = nodesById.get(String(aliasedNodeId ?? storedNodeId))

      // Projects saved once by the old migration no longer contain its alias
      // map. Legacy config/output node pairs used consecutive IDs, with the
      // output image immediately following the config node. Recover that
      // deterministic relationship without guessing across unrelated nodes.
      if (!node) {
        const previousId = previousSequentialNodeId(storedNodeId)
        const candidate = previousId ? nodesById.get(previousId) : null
        const candidateHasRecoverableUrl = !candidate?.data?.url || candidate.data.url.startsWith?.('blob:')
        if (candidate?.type === 'image' && candidateHasRecoverableUrl && !claimedNodeIds.has(previousId)) {
          node = candidate
        }
      }

      // Never delete an unmatched key here. A later schema migration or a
      // manual recovery pass may still be able to reconnect the binary.
      if (!node || node.type !== 'image') continue

      const blob = await loadImage(key)
      const hasTemporaryBlobUrl = node.data?.url?.startsWith?.('blob:')
      if (blob && node.data && (!node.data.url || hasTemporaryBlobUrl)) {
        node.data.url = URL.createObjectURL(blob)
        const restoredNodeId = String(node.id)
        claimedNodeIds.add(restoredNodeId)

        // Copy the legacy asset to the surviving node ID. Keep the old key as
        // a recovery fallback instead of destructively garbage-collecting it.
        if (restoredNodeId !== storedNodeId) {
          await saveImage(`${projectId}:${restoredNodeId}`, node.data.url)
        }
      }
    }
  } catch (error) {
    console.warn('Failed to restore persisted project images:', error)
  }
}

/**
 * Debounced auto-save | 防抖动自动保存
 */
const debouncedSave = () => {
  if (!autoSaveEnabled || !currentProjectId.value) return
  
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  
  saveTimeout = setTimeout(() => {
    saveProject()
  }, 500)
}

/**
 * Update viewport and save | 更新视口并保存
 */
export const updateViewport = (viewport) => {
  canvasViewport.value = viewport
  debouncedSave()
}

/**
 * Undo last action | 撤销上一步操作
 */
export const undo = () => {
  if (historyIndex.value <= 0) {
    window.$message?.info('没有可撤销的操作')
    return false
  }
  
  historyIndex.value--
  restoreState(history.value[historyIndex.value])
  return true
}

/**
 * Redo last undone action | 重做上一步撤销的操作
 */
export const redo = () => {
  if (historyIndex.value >= history.value.length - 1) {
    window.$message?.info('没有可重做的操作')
    return false
  }
  
  historyIndex.value++
  restoreState(history.value[historyIndex.value])
  return true
}

/**
 * Restore state from history | 从历史恢复状态
 */
const restoreState = (state) => {
  isRestoring = true
  nodes.value = JSON.parse(JSON.stringify(state.nodes))
  edges.value = JSON.parse(JSON.stringify(state.edges))
  setTimeout(() => {
    isRestoring = false
    debouncedSave()
  }, 100)
}

/**
 * Check if can undo | 检查是否可以撤销
 */
export const canUndo = () => historyIndex.value > 0

/**
 * Check if can redo | 检查是否可以重做
 */
export const canRedo = () => historyIndex.value < history.value.length - 1

/**
 * Manually save current state to history | 手动保存当前状态到历史
 * Used for edge deletions and other operations not covered by automatic saves
 */
export const manualSaveHistory = () => {
  saveToHistory()
  debouncedSave()
}
