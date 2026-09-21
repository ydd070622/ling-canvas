/**
 * Canvas store | 画布状态管理
 * Manages nodes, edges and canvas state
 */
import { ref } from 'vue'
import { updateProjectCanvas, getProjectCanvas } from './projects'
import { saveImage, loadImage, listImageKeys, deleteImage } from './imageStore'
import { createDefaultNodeData, isMediaNodeType } from '../config/nodeRegistry'
import { migrateCanvasDocument, dropUnsupportedNodes, resetTransientNodeState, CANVAS_SCHEMA_VERSION } from '../utils/migrateCanvasDocument'
import {
  computeSlots,
  resolveRefs,
  renumberRefs,
  removeOrphanRefs as buildOrphanCleanup
} from '../utils/promptRefs'
import { resolveAssetUrl, runLimited, statAssetFiles } from '../services/assetLibrary'

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
  if (history.value.length > MAX_HISTORY) history.value.shift()

  // 索引永远指向最新一条。以前只在没触发上限时才 ++，一旦开始丢弃最老的一条，
  // 索引就停在倒数第二条不动了，从那一刻起撤销/重做整体偏一位。
  historyIndex.value = history.value.length - 1
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
/**
 * 预检拦下的那条报错 | Pre-flight error
 *
 * 点生成被预检拦下时会在节点上写一条 `error`（"请输入提示词…"这类）。**用户一改这个节点，
 * 它就作废** —— 你已经补了正文 / 换了预设 / 加了连线，那条提示就不该继续挂着。
 *
 * 刻意放在这里同步做，而不是让节点组件去 watch「预检是否重新通过」：
 * 那样的判断要读组件自己的 `props.data`，而清 error 又会改 `nodes.value`、再次触发判断，
 * 此时组件还没重渲染、读到的仍是上一帧，条件永远为真 —— 会变成清不掉的死循环。
 *
 * 只作废预检那类（`errorKind === 'preflight'`），真正的接口报错不动。
 */
const stripPreflight = (node, patch) => {
  if (node?.data?.errorKind !== 'preflight') return null
  if (patch && patch.error !== undefined) return null
  return { error: '', errorKind: '' }
}

export const updateNode = (id, data) => {
  const now = Date.now()
  nodes.value = nodes.value.map(node => (node.id === id
    ? { ...node, data: { ...node.data, ...stripPreflight(node, data), ...data, updatedAt: data.updatedAt || now } }
    : node))
  scheduleHistorySave()
  debouncedSave()
}

// Update Vue Flow node-level properties without mixing them into node data.
export const updateNodeMeta = (id, patch) => {
  nodes.value = nodes.value.map(node => node.id === id ? { ...node, ...patch } : node)
  scheduleHistorySave()
  debouncedSave()
}

/* ==========================================================================
   引用 | References
   ========================================================================== */

const findNode = (id) => nodes.value.find(node => String(node.id) === String(id))
const findEdge = (id) => edges.value.find(edge => edge.id === id)

/** 该节点的入边，按顺序升序 */
export const inEdges = (id) =>
  edges.value
    .filter(edge => String(edge.target) === String(id))
    .sort((a, b) => (Number(a.data?.order) || 0) - (Number(b.data?.order) || 0))

/** 节点是否已有产出（文本看 content，媒体看 url） */
const hasResult = (node) =>
  node?.type === 'text' ? !!String(node.data?.content || '').trim() : !!node.data?.url

/**
 * 「上游已变更」的失效标记机制**已整体移除**。
 *
 * 它做的是：任何一处编辑都沿下游 BFS，给每个下游写 `stale`、再触发一次存档。
 * 但界面上它只表现为一句"上游数据已变更，建议重新生成"——用户明确说这条没用
 * （改完上游本来就要重新生成，提示不提示都一样），于是连标记本身一起去掉：
 * 没有 UI 承载的话，留着只是每次编辑都白遍历一遍全图 + 多存一次盘。
 *
 * 旧项目数据里残留的 `data.stale` 不再被读取，留着不影响任何行为。
 */

/**
 * 一次「离散」修改：进撤销栈。
 * 连续输入（打字）请直接用 updateNode —— 它内部是 350ms 合并的。
 */
export const editNode = (id, patch) => {
  updateNode(id, patch)
}

/** 重算某节点正文里的引用编号（重排顺序、断线、切模式之后调用） */
export const renumberNodeRefs = (id) => {
  const node = findNode(id)
  if (!node) return false
  const result = renumberRefs(node, nodes.value, edges.value)
  if (result.collided) {
    node.data.warn = {
      message: '引用编号有冲突：一处引用已失效、另一处要占用它的编号。已跳过自动重写，请手动检查正文。',
      actions: []
    }
    return false
  }
  node.data.warn = null
  if (result.changed) {
    node.data.prompt = result.prompt
    node.data.refBindings = result.refBindings
  }
  return result.changed
}

/** 断开一条连线：重排编号 + 让下游失效 + 记一步撤销 */
export const cutEdge = (edgeId) => {
  const edge = findEdge(edgeId)
  if (!edge) return null
  const targetId = edge.target
  edges.value = edges.value.filter(e => e.id !== edgeId)
  normalizeEdgeOrders()
  renumberNodeRefs(targetId)
  saveToHistory(true)
  debouncedSave()
  return targetId
}

/** 重排某节点的入边顺序（拖拽引用顺序浮层时用），一次算一步撤销 */
export const reorderNodeEdges = (nodeId, orderedEdgeIds) => {
  const orderById = new Map(orderedEdgeIds.map((id, index) => [id, index + 1]))
  edges.value = edges.value.map(edge => orderById.has(edge.id)
    ? { ...edge, data: { ...(edge.data || {}), order: orderById.get(edge.id) } }
    : edge)
  renumberNodeRefs(nodeId)
  saveToHistory(true)
  debouncedSave()
}

/** 清掉正文里的失效引用，返回清掉的条数 */
export const dropOrphanRefs = (id) => {
  const node = findNode(id)
  if (!node) return 0
  const removed = resolveRefs(node, nodes.value, edges.value).filter(r => r.status === 'orphan').length
  const cleanup = buildOrphanCleanup(node, nodes.value, edges.value)
  if (!cleanup) return 0
  updateNode(id, { prompt: cleanup.prompt, refBindings: cleanup.refBindings, error: '' })
  return removed
}

/** 写入本地素材（上传 / 拖入） */
export const setNodeMedia = (id, { url, base64, fileName }) => {
  const patch = { url, galleryUrls: [], mainImageIndex: 0, loading: false, error: '', updatedAt: Date.now() }
  if (base64 !== undefined) patch.base64 = base64
  if (fileName !== undefined) patch.fileName = fileName
  editNode(id, patch)
}

/**
 * 连续输入的字段编辑（正文 / 文本内容）。
 * 撤销由 scheduleHistorySave 在 350ms 内合并成一步。
 */
export const editField = (id, field, value) => {
  const node = findNode(id)
  if (!node) return
  const now = Date.now()
  nodes.value = nodes.value.map(n => (String(n.id) === String(id) ? {
    ...n,
    data: { ...n.data, ...stripPreflight(n), [field]: value, updatedAt: now }
  } : n))
  scheduleHistorySave()
  debouncedSave()
}

/** 取某节点当前的槽位与引用状态（组件用） */
export const nodeSlots = (id) => {
  const node = findNode(id)
  return node ? computeSlots(node, nodes.value, edges.value) : { slots: [], idle: [], modeDef: null }
}
export const nodeRefs = (id) => {
  const node = findNode(id)
  return node ? resolveRefs(node, nodes.value, edges.value) : []
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
  // 下游节点：断了入边之后引用会变 orphan，编号也要补位
  const victims = [...new Set(edges.value.filter(edge => edge.source === id).map(edge => edge.target))]

  nodes.value = nodes.value.filter(node => node.id !== id)
  edges.value = edges.value.filter(edge => edge.source !== id && edge.target !== id)
  normalizeEdgeOrders()
  victims.forEach((victimId) => {
    if (!findNode(victimId)) return
    renumberNodeRefs(victimId)
  })

  saveToHistory() // Save after removing node | 删除节点后保存
  if (currentProjectId.value) deleteImage(`${currentProjectId.value}:${id}`).catch(() => {})
  debouncedSave()
}

/**
 * Duplicate node | 复制节点
 *
 * 连同**入边与出边**一起复制：
 * - 入边让副本的提示词引用立刻可用（否则副本里全是失效引用）
 * - 出边追加到下游入边序列末尾，不会打乱下游已有的引用编号
 * 副本的 `refBindings` 必须重绑到副本自己的入边上，否则会指向原节点的边、
 * 解析出来全是 orphan。
 */
export const duplicateNode = (id) => {
  const sourceNode = nodes.value.find(node => node.id === id)
  if (!sourceNode) return null

  const newId = getNodeId()
  const maxZIndex = Math.max(0, ...nodes.value.map(n => n.zIndex || 0))

  const inbound = inEdges(id)
  const outbound = edges.value.filter(edge => edge.source === id)
  const edgeIdMap = new Map()
  const newEdges = []

  inbound.forEach((edge) => {
    const nextId = getEdgeId()
    edgeIdMap.set(edge.id, nextId)
    newEdges.push({ ...edge, id: nextId, target: newId })
  })
  outbound.forEach((edge) => {
    const maxOrder = Math.max(0, ...inEdges(edge.target).map(e => Number(e.data?.order) || 0))
    newEdges.push({ ...edge, id: getEdgeId(), source: newId, data: { ...(edge.data || {}), order: maxOrder + 1 } })
  })

  const rebind = {}
  Object.entries(sourceNode.data?.refBindings || {}).forEach(([key, edgeId]) => {
    rebind[key] = edgeIdMap.get(edgeId) || edgeId
  })

  const newNode = {
    id: newId,
    type: sourceNode.type,
    position: { x: sourceNode.position.x + 50, y: sourceNode.position.y + 50 },
    data: {
      ...sourceNode.data,
      refBindings: rebind,
      // 生成中的任务不跟着复制，副本从干净状态开始
      loading: false
    },
    zIndex: maxZIndex + 1
  }

  startBatchOperation()
  nodes.value = [...nodes.value, newNode]
  edges.value = [...edges.value, ...newEdges]
  endBatchOperation()
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

/**
 * 每个目标的入边重新编号 1..n。
 * 单一输入口之后不再需要按 targetHandle 分组：一个节点只有一个输入口，
 * 入边顺序就是它在正文里的引用编号顺序。
 */
export const normalizeEdgeOrders = () => {
  const groups = new Map()
  edges.value.forEach(edge => {
    if (!groups.has(edge.target)) groups.set(edge.target, [])
    groups.get(edge.target).push(edge)
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
    // 瞬态状态必须清掉：上一轮生成没跑完就关掉应用时，loading/autoExecute
    // 会跟着落盘，直接恢复会得到「永远生成中」的空转节点。
    nodes.value = dropUnsupportedNodes(resetTransientNodeState(migratedCanvasData.nodes || []))
    // 边要跟着过滤：连到已被丢弃的节点上的边留着只会指向空气
    const aliveIds = new Set(nodes.value.map(node => node.id))
    edges.value = (migratedCanvasData.edges || [])
      .filter(edge => aliveIds.has(edge.source) && aliveIds.has(edge.target))
    canvasViewport.value = migratedCanvasData.viewport || { x: 100, y: 50, zoom: 0.8 }

    // Restore persisted node images from IndexedDB | 从 IndexedDB 恢复节点图片
    imageRestorePromise = restoreProjectImages(projectId, migratedCanvasData._imageNodeAliases)
      // 串行、且必须挂在同一个 promise 上：autoSaveEnabled 的解除挂在它后面
      // （见下方 imageRestorePromise.finally）。素材 hydrate 是 N 次 IPC，
      // 比 restore 慢得多，并发会让自动保存在图片还没读完时就打开。
      .then(() => hydrateAssetRefs(projectId))
    
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
    schemaVersion: CANVAS_SCHEMA_VERSION,
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
 * Persist node data-URL media to IndexedDB | 把节点里的 base64 图片/视频写入 IndexedDB
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
  nodes.value.forEach((node) => {
    node.data?.galleryUrls?.forEach((url, index) => {
      if (!url?.startsWith?.('data:')) return
      const key = `${projectId}:${node.id}:gallery:${index}`
      const fingerprint = `${url.length}:${url.slice(0, 64)}:${url.slice(-64)}`
      if (savedImageKeys.get(key) === fingerprint) return
      saveImage(key, url)
        .then(() => savedImageKeys.set(key, fingerprint))
        .catch(() => {})
    })
  })
}

/**
 * Restore node media from IndexedDB after reload | 重新加载项目时从 IndexedDB 恢复节点图片/视频
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
      const galleryMatch = storedNodeId.match(/^(.*):gallery:(\d+)$/)
      if (galleryMatch) {
        const galleryNode = nodesById.get(galleryMatch[1])
        if (galleryNode?.type === 'image' && Array.isArray(galleryNode.data?.galleryUrls)) {
          const index = Number(galleryMatch[2])
          if (index >= galleryNode.data.galleryUrls.length) continue
          const blob = await loadImage(key)
          if (blob) {
            if (!galleryNode.data.galleryUrls[index]) galleryNode.data.galleryUrls[index] = URL.createObjectURL(blob)
          }
        }
        continue
      }
      const aliasedNodeId = imageNodeAliases?.[storedNodeId]
      let node = nodesById.get(String(aliasedNodeId ?? storedNodeId))

      // Projects saved once by the old migration no longer contain its alias
      // map. Legacy config/output node pairs used consecutive IDs, with the
      // output image immediately following the config node. Recover that
      // deterministic relationship without guessing across unrelated nodes.
      // 这条兜底只针对图片：旧的连续 ID 配对是「配置节点 → 生成图片」，把视频
      // 也套进来等于凭空猜测，所以即使下面的媒体判断已放开了 video，这里仍然保持 image。
      if (!node) {
        const previousId = previousSequentialNodeId(storedNodeId)
        const candidate = previousId ? nodesById.get(previousId) : null
        // 素材节点 hydrate 之后 url 恰好也是 blob:，会被这条兜底误判成「可恢复」，
        // 从而被一张无关的旧 blob 覆盖。带 assetRef 的节点一律让开。
        const candidateHasRecoverableUrl = !candidate?.data?.assetRef
          && (!candidate?.data?.url || candidate.data.url.startsWith?.('blob:'))
        if (candidate?.type === 'image' && candidateHasRecoverableUrl && !claimedNodeIds.has(previousId)) {
          node = candidate
        }
      }

      // Never delete an unmatched key here. A later schema migration or a
      // manual recovery pass may still be able to reconnect the binary.
      if (!node || !isMediaNodeType(node.type)) continue

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
    nodes.value.forEach(node => {
      if (node.type !== 'image' || !Array.isArray(node.data?.galleryUrls)) return
      const mainUrl = node.data.galleryUrls[Number(node.data.mainImageIndex) || 0]
      if (mainUrl) node.data.url = mainUrl
    })
  } catch (error) {
    console.warn('Failed to restore persisted project images:', error)
  }
}

const ASSET_MISSING_MESSAGE = '素材已丢失'
const ASSET_OFFLINE_MESSAGE = '素材库未连接'

/**
 * 按 id 取**当前**的节点对象 | Look the node up by id, right now
 *
 * 每次 await 之后都必须重新查一次，绝不能持有 await 之前的引用：画布把 nodes
 * 用 `v-model:nodes` 绑给了 Vue Flow，它会在节点挂载/更新时替换数组里的节点对象
 * （saveProject 上方那段注释讲的就是这件事）。拿旧引用去改数据，改的是一个已经
 * 脱离数组的孤儿对象——内存里看着改了，UI 毫无反应。
 */
const findNodeById = (nodeId) => nodes.value.find(node => String(node.id) === String(nodeId))

/** 把素材的渲染状态写回**当前**节点；不走 updateNode，避免污染撤销栈与触发保存 */
const applyAssetState = (nodeId, { url, error }) => {
  const node = findNodeById(nodeId)
  if (!node?.data) return
  node.data.url = url
  if (error) node.data.error = error
  else delete node.data.error
}

/**
 * 给引用了本地素材库的图片节点补上可渲染的 url | Hydrate asset-library nodes
 *
 * 引用式的收口点：节点持久化的只有 `data.assetRef`（相对素材库根的相对路径），
 * 字节在加载时按需读取、用完即弃，绝不进 localStorage 或 IndexedDB。
 *
 * **直接改 `node.data` 而不走 `updateNode`**：updateNode 会调 scheduleHistorySave()
 * 和 debouncedSave()，那样打开一个含 20 张素材的画布会往撤销栈塞 20 条记录、
 * 并触发 20 次 localStorage 写入。项目规则见
 * `.qoder/feedback-no-auto-save-on-node-change.md`。
 */
export const hydrateAssetRefs = async (projectId) => {
  // 只记 id 与引用：对象引用会在 await 期间被 Vue Flow 换掉，不能留着用
  const targets = nodes.value
    .filter(node => node.type === 'image' && node.data?.assetRef)
    .map(node => ({ id: String(node.id), ref: node.data.assetRef }))
  if (!targets.length) return

  // 给「用户手动上传覆盖过」的节点让路：IndexedDB 里有字节的归 restoreProjectImages 管，
  // 否则会用素材库的原图盖掉用户自己传的图。
  let storedNodeIds = new Set()
  try {
    const keys = await listImageKeys(`${projectId}:`)
    const prefixLength = String(projectId).length + 1
    storedNodeIds = new Set(keys.map(key => String(key).slice(prefixLength)))
  } catch {
    storedNodeIds = new Set()
  }

  // 按 id 复核一遍：节点可能已被删，url 也可能已被别处填上
  const pending = targets.filter(item => !storedNodeIds.has(item.id) && !findNodeById(item.id)?.data?.url)
  if (!pending.length) return

  const refs = [...new Set(pending.map(item => item.ref))]
  let statuses = null
  try {
    statuses = await statAssetFiles(refs)
  } catch {
    // 整批失败 = 素材库不可用（盘符没挂载）。这与「单个文件被删」必须区分：
    // 前者插回硬盘就能恢复，后者要用户自己去找。
    pending.forEach(item => applyAssetState(item.id, { url: '', error: ASSET_OFFLINE_MESSAGE }))
    return
  }

  const existsByRef = new Map(
    (statuses || []).map(status => [status.relativePath, status.exists])
  )

  // 并发压到 3：一张 4000×6000 的素材解码后接近 100MB
  await runLimited(pending, 3, async item => {
    if (existsByRef.get(item.ref) === false) {
      applyAssetState(item.id, { url: '', error: ASSET_MISSING_MESSAGE })
      return
    }
    try {
      const url = await resolveAssetUrl(item.ref)
      applyAssetState(item.id, { url })
    } catch {
      applyAssetState(item.id, { url: '', error: ASSET_MISSING_MESSAGE })
    }
  })
}

/**
 * 刚插入单张素材时立刻补 url | Hydrate a freshly inserted asset node
 *
 * 同样是直接改 node.data：addNode 已经记过一条历史了，再走 updateNode 会多记一条。
 */
export const hydrateSingleAssetNode = async (nodeId) => {
  const initial = findNodeById(nodeId)
  if (!initial?.data?.assetRef) return
  const ref = initial.data.assetRef
  try {
    const [status] = await statAssetFiles([ref])
    if (status && !status.exists) {
      applyAssetState(nodeId, { url: '', error: ASSET_MISSING_MESSAGE })
      return
    }
    const url = await resolveAssetUrl(ref)
    applyAssetState(nodeId, { url })
  } catch {
    applyAssetState(nodeId, { url: '', error: ASSET_MISSING_MESSAGE })
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
