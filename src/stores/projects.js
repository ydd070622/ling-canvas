/**
 * Projects store | 项目状态管理
 * Manages projects with Tauri-file / IndexedDB persistence
 */
import { ref, computed } from 'vue'
import {
  deleteProjectDocuments,
  loadProjectDocuments,
  writeProjectDocuments
} from '../services/projectStorage'

// Storage key | 存储键
const STORAGE_KEY = 'ai-canvas-projects'
const MIGRATION_MARKER_KEY = 'ai-canvas-project-storage-v2'

let initializationPromise = null
let saveQueue = Promise.resolve()
let storageLoadSucceeded = false
let lastSaveError = null

// Generate unique ID | 生成唯一ID
const generateId = () => `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

// Default field values for migration | 旧数据迁移的默认值
const DEFAULT_PROJECT_FIELDS = {
  // folder 已废弃：文件夹不再绑定画布。保留仅为兼容旧数据，请勿在 UI 中读取。
  folder: null,
  visibility: 'all',
  cardCount: 0,
  creator: '我创建',
  deletedAt: null
}

/**
 * Migrate project data with default fields | 迁移项目数据，补充缺失字段
 */
const migrateProject = (p) => {
  const migrated = { ...p }
  for (const [key, defaultValue] of Object.entries(DEFAULT_PROJECT_FIELDS)) {
    if (migrated[key] === undefined) {
      migrated[key] = defaultValue
    }
  }
  return migrated
}

// All projects list (including trashed) | 全部项目列表（含回收站）
export const projects = ref([])

// Trashed projects (soft-deleted) | 回收站项目（软删除）
export const trashedProjects = computed(() =>
  projects.value.filter(p => p.deletedAt).sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt))
)

// Active projects (excluding trashed) | 活跃项目（不含回收站）
export const activeProjects = computed(() =>
  projects.value.filter(p => !p.deletedAt)
)

// Current project ID | 当前项目ID
export const currentProjectId = ref(null)

// Current project | 当前项目
export const currentProject = computed(() => {
  return projects.value.find(p => p.id === currentProjectId.value) || null
})

const deserializeProjects = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .filter(project => project && typeof project === 'object' && project.id)
    .map(project => migrateProject({
      ...project,
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt),
      deletedAt: project.deletedAt ? new Date(project.deletedAt) : null
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

const readLegacyProjects = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch (err) {
    console.error('Failed to read legacy projects:', err)
    return []
  }
}

/**
 * Load project documents and migrate the old localStorage snapshot once.
 * The legacy snapshot is removed only after every migrated project can be read
 * back from the new backend.
 */
export const loadProjects = async () => {
  const legacyProjects = readLegacyProjects()
  try {
    let storedProjects = await loadProjectDocuments()
    const migrationCompleted = localStorage.getItem(MIGRATION_MARKER_KEY) === '1'

    if (!migrationCompleted && legacyProjects.length) {
      const merged = new Map(legacyProjects.map(project => [String(project.id), project]))
      storedProjects.forEach(project => merged.set(String(project.id), project))
      const migrationSnapshot = [...merged.values()].map(cleanProjectForStorage)
      await writeProjectDocuments(migrationSnapshot)

      const verifiedProjects = await loadProjectDocuments()
      const verifiedIds = new Set(verifiedProjects.map(project => String(project.id)))
      if (!migrationSnapshot.every(project => verifiedIds.has(String(project.id)))) {
        throw new Error('迁移校验失败，部分项目未写入新存储')
      }
      storedProjects = verifiedProjects
      localStorage.removeItem(STORAGE_KEY)
      localStorage.setItem(MIGRATION_MARKER_KEY, '1')
    }

    projects.value = deserializeProjects(storedProjects)
    storageLoadSucceeded = true
  } catch (err) {
    storageLoadSucceeded = false
    console.error('Failed to load project documents:', err)
    // Migration/read failure must never hide the user's existing canvases.
    projects.value = deserializeProjects(legacyProjects)
    window.$message?.error('项目存储加载失败，已保留并使用旧数据；请勿清理应用数据')
  }
  return projects.value
}

/**
 * Clean node data for storage | 清理节点数据用于存储
 * Removes base64 data URLs to reduce storage size | 移除 base64 数据减小存储大小
 */
const cleanNodeForStorage = (node) => {
  if (!node.data) return node
  
  const cleanedData = { ...node.data }
  
  // Remove base64 data | 移除 base64 数据
  if (cleanedData.base64) {
    delete cleanedData.base64
  }
  
  // Inline data and blob URLs are persisted in IndexedDB. A blob URL is valid
  // only for the WebView session that created it, so saving it here guarantees
  // a broken image after the next app restart.
  if (cleanedData.url?.startsWith?.('data:') || cleanedData.url?.startsWith?.('blob:')) {
    delete cleanedData.url
  }
  if (Array.isArray(cleanedData.galleryUrls)) {
    cleanedData.galleryUrls = cleanedData.galleryUrls.map(url =>
      url?.startsWith?.('data:') || url?.startsWith?.('blob:') ? null : url
    )
  }
  
  // Remove mask data | 移除蒙版数据
  if (cleanedData.maskData) {
    delete cleanedData.maskData
  }

  // 兜底：任何残留的「图片数组」字段都可能在保存时被 base64 撑爆配额。
  // 历史上 SimpleImageNode 写过 data.images，这里统一清掉，避免老数据复燃。
  if (cleanedData.images) {
    delete cleanedData.images
  }

  // 运行期瞬态字段不落盘：loading 一旦存下来，下次启动就会变成一个没有任何
  // 请求在跑的「永远生成中」僵尸（生成中关掉应用即复现）；autoExecute 是
  // 创建节点时的一次性触发开关，落盘会让节点在下次打开时自己跑一次生成。
  delete cleanedData.loading
  delete cleanedData.autoExecute

  return { ...node, data: cleanedData }
}

/**
 * Clean project for storage | 清理项目用于存储
 */
const cleanProjectForStorage = (project) => {
  return {
    ...project,
    canvasData: project.canvasData ? {
      ...project.canvasData,
      nodes: project.canvasData.nodes?.map(cleanNodeForStorage) || []
    } : project.canvasData,
    // Remove base64 thumbnails | 移除 base64 缩略图
    // blob: 只在创建它的 WebView 会话里有效，asset: 依赖 asset 协议；两者写进
    // 项目文档都只会在下次启动变成碎图。素材库节点的 url 在内存里恒为 blob:，
    // 不在这里一并剥掉的话，每个含素材的项目都会往存储层写一个死链接。
    thumbnail: /^(data|blob|asset):/.test(String(project.thumbnail || '')) ? '' : project.thumbnail
  }
}

/**
 * Queue document writes so an older asynchronous save can never overwrite a
 * newer canvas snapshot.
 */
const enqueueStorageOperation = (operation) => {
  saveQueue = saveQueue
    .then(async () => {
      await operation()
      lastSaveError = null
    })
    .catch(err => {
      lastSaveError = err
      console.error('Failed to persist project documents:', err)
      const detail = typeof err === 'string' ? err : err?.message
      window.$message?.error(`项目保存失败，本次修改尚未写入磁盘，请勿关闭应用${detail ? `：${detail}` : ''}`)
    })
  return saveQueue
}

export const saveProjects = (projectIds = null) => {
  const ids = projectIds ? new Set(projectIds.map(String)) : null
  // Clone now, not when the queued operation starts: Vue may mutate the live
  // node objects again while an earlier disk write is still in progress.
  const snapshots = projects.value
    .filter(project => !ids || ids.has(String(project.id)))
    .map(project => JSON.parse(JSON.stringify(cleanProjectForStorage(project))))
  return enqueueStorageOperation(() => writeProjectDocuments(snapshots))
}

export const flushProjectSaves = async () => {
  await saveQueue
  return !lastSaveError
}

/**
 * Create a new project | 创建新项目
 * @param {string} name - Project name | 项目名称
 * @param {string|null} folder - Folder name | 分类名称
 * @returns {string} - New project ID | 新项目ID
 */
export const createProject = (name = '未命名项目', folder = null) => {
  const id = generateId()
  const now = new Date()
  
  const newProject = {
    id,
    name,
    thumbnail: '',
    createdAt: now,
    updatedAt: now,
    folder: folder,
    visibility: 'all',
    cardCount: 0,
    creator: '我创建',
    deletedAt: null,
    // Canvas data | 画布数据
    canvasData: {
      nodes: [],
      edges: [],
      viewport: { x: 100, y: 50, zoom: 0.8 }
    }
  }
  
  projects.value = [newProject, ...projects.value]
  saveProjects([id])
  
  return id
}

/**
 * Update project | 更新项目
 * @param {string} id - Project ID | 项目ID
 * @param {object} data - Update data | 更新数据
 */
export const updateProject = (id, data) => {
  const index = projects.value.findIndex(p => p.id === id)
  if (index === -1) return false
  
  projects.value[index] = {
    ...projects.value[index],
    ...data,
    updatedAt: new Date()
  }
  
  // Move to top of list | 移动到列表顶部
  const [updated] = projects.value.splice(index, 1)
  projects.value = [updated, ...projects.value]
  
  saveProjects([id])
  return true
}

/**
 * Update project canvas data | 更新项目画布数据
 * @param {string} id - Project ID | 项目ID
 * @param {object} canvasData - Canvas data (nodes, edges, viewport) | 画布数据
 */
export const updateProjectCanvas = (id, canvasData) => {
  const project = projects.value.find(p => p.id === id)
  if (!project) return false
  
  project.canvasData = {
    ...project.canvasData,
    ...canvasData
  }
  project.updatedAt = new Date()
  
  // Auto-update cardCount from nodes | 自动更新卡片数量
  if (canvasData.nodes) {
    project.cardCount = canvasData.nodes.length
  }

  // Auto-update thumbnail from last edited image/video node | 自动从最后编辑的图片/视频节点更新缩略图
  if (canvasData.nodes) {
    const mediaNodes = canvasData.nodes
      .filter(node => (node.type === 'image' || node.type === 'video') && node.data?.url)
      .sort((a, b) => {
        // Sort by last updated time | 按最后更新时间排序
        const aTime = a.data?.updatedAt || a.data?.createdAt || 0
        const bTime = b.data?.updatedAt || b.data?.createdAt || 0
        return bTime - aTime
      })
    if (mediaNodes.length > 0) {
      const latestNode = mediaNodes[0]
      // Use thumbnail for video nodes, url for image nodes | 视频节点使用缩略图，图片节点使用 URL
      if (latestNode.type === 'video') {
        project.thumbnail = latestNode.data.thumbnail || latestNode.data.url
      } else {
        project.thumbnail = latestNode.data.url
      }
    } else {
      // 画布中已没有可预览媒体时同步清除旧缩略图，避免首页误报有内容。
      project.thumbnail = ''
    }
  }
  
  saveProjects([id])
  return true
}

/**
 * Get project canvas data | 获取项目画布数据
 * @param {string} id - Project ID | 项目ID
 * @returns {object|null} - Canvas data or null | 画布数据或空
 */
export const getProjectCanvas = (id) => {
  const project = projects.value.find(p => p.id === id)
  return project?.canvasData || null
}

/**
 * Delete project (soft delete to trash) | 删除项目（软删除到回收站）
 * @param {string} id - Project ID | 项目ID
 */
export const deleteProject = (id) => {
  const project = projects.value.find(p => p.id === id)
  if (project) {
    project.deletedAt = new Date()
    saveProjects([id])
  }
}

/**
 * Restore project from trash | 从回收站恢复项目
 * @param {string} id - Project ID | 项目ID
 */
export const restoreProject = (id) => {
  const project = projects.value.find(p => p.id === id)
  if (project && project.deletedAt) {
    delete project.deletedAt
    project.updatedAt = new Date()
    saveProjects([id])
    return true
  }
  return false
}

/**
 * Permanently delete a project | 永久删除项目
 * @param {string} id - Project ID | 项目ID
 */
export const permanentlyDeleteProject = (id) => {
  projects.value = projects.value.filter(p => p.id !== id)
  enqueueStorageOperation(() => deleteProjectDocuments([String(id)]))
}

/**
 * Empty the trash (permanently delete all trashed projects) | 清空回收站
 */
export const emptyProjectTrash = () => {
  const deletedIds = projects.value.filter(p => p.deletedAt).map(p => String(p.id))
  projects.value = projects.value.filter(p => !p.deletedAt)
  enqueueStorageOperation(() => deleteProjectDocuments(deletedIds))
}

/**
 * Duplicate project | 复制项目
 * @param {string} id - Source project ID | 源项目ID
 * @returns {string|null} - New project ID or null | 新项目ID或空
 */
export const duplicateProject = (id) => {
  const source = projects.value.find(p => p.id === id)
  if (!source) return null
  
  const newId = generateId()
  const now = new Date()
  
  const newProject = migrateProject({
    ...JSON.parse(JSON.stringify(source)), // Deep clone | 深拷贝
    id: newId,
    name: `${source.name} (副本)`,
    createdAt: now,
    updatedAt: now
  })
  
  projects.value = [newProject, ...projects.value]
  saveProjects([newId])
  
  return newId
}

/**
 * Rename project | 重命名项目
 * @param {string} id - Project ID | 项目ID
 * @param {string} name - New name | 新名称
 */
export const renameProject = (id, name) => {
  return updateProject(id, { name })
}

/**
 * Update project thumbnail | 更新项目缩略图
 * @param {string} id - Project ID | 项目ID
 * @param {string} thumbnail - Thumbnail URL (base64 or URL) | 缩略图URL
 */
export const updateProjectThumbnail = (id, thumbnail) => {
  return updateProject(id, { thumbnail })
}

/**
 * Get sorted projects | 获取排序后的项目列表
 * @param {string} sortBy - Sort field (updatedAt, createdAt, name) | 排序字段
 * @param {string} order - Sort order (asc, desc) | 排序顺序
 */
export const getSortedProjects = (sortBy = 'updatedAt', order = 'desc') => {
  return computed(() => {
    const sorted = [...projects.value]
    sorted.sort((a, b) => {
      let valueA = a[sortBy]
      let valueB = b[sortBy]
      
      if (valueA instanceof Date) {
        valueA = valueA.getTime()
        valueB = valueB.getTime()
      }
      
      if (typeof valueA === 'string') {
        valueA = valueA.toLowerCase()
        valueB = valueB.toLowerCase()
      }
      
      if (order === 'asc') {
        return valueA > valueB ? 1 : -1
      } else {
        return valueA < valueB ? 1 : -1
      }
    })
    return sorted
  })
}

/**
 * Initialize projects store | 初始化项目存储
 */
export const initProjectsStore = () => {
  if (initializationPromise) return initializationPromise
  initializationPromise = (async () => {
    await loadProjects()

    // Create sample project if empty | 如果为空则创建示例项目
    // A failed disk read must never be interpreted as a genuinely empty
    // library, otherwise creating the sample could mask an existing library.
    if (storageLoadSucceeded && projects.value.length === 0) {
      const id = createProject('示例项目')
      const project = projects.value.find(p => p.id === id)
      if (project) {
        project.canvasData = {
          nodes: [
            {
              id: 'node_0',
              type: 'text',
              position: { x: 150, y: 150 },
              data: {
                content: '一只金毛寻回犬在草地上奔跑，摇着尾巴，脸上带着快乐的表情。它的毛发在阳光下闪耀，眼神充满了对自由的渴望，全身散发着阳光、友善的气息。',
                label: '文本输入'
              }
            },
            {
              id: 'node_1',
              type: 'image',
              position: { x: 500, y: 150 },
              data: {
                prompt: '',
                model: '',
                size: '512x512',
                label: '图片',
                expanded: true
              }
            }
          ],
          edges: [
            {
              id: 'edge_node_0_node_1',
              source: 'node_0',
              target: 'node_1',
              sourceHandle: 'right',
              targetHandle: 'left',
              type: 'flowEdge',
              data: { label: '提示词', color: '#e8912e', order: 1 }
            }
          ],
          viewport: { x: 100, y: 50, zoom: 0.8 }
        }
        project.cardCount = 2
        saveProjects([id])
      }
    }
    await flushProjectSaves()
    return projects.value
  })()
  return initializationPromise
}

// Export for debugging | 导出用于调试
if (typeof window !== 'undefined') {
  window.__aiCanvasProjects = {
    projects,
    loadProjects,
    saveProjects,
    createProject,
    deleteProject
  }
}
