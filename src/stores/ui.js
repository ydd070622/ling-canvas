/**
 * UI store | UI 状态管理
 * Manages sidebar, view switching, and folder navigation
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUIStore = defineStore('ui', () => {
  // 当前视图：'all' | 'canvases' | 'templates' | 'favorites' | 'assets' | 'trash' | 'folder'
  const currentView = ref('all')
  // 当前选中的文件夹名称
  const currentFolder = ref(null)
  // 侧边栏折叠状态
  const sidebarCollapsed = ref(false)
  // 首页全局搜索词（标题栏与首页共用）
  const searchQuery = ref('')

  // 文件夹是本地目录，不承载画布，存为字符串数组、名字即唯一标识 | Folders are plain local
  // directories backed by a string array — the name IS the identity, no ids needed.
  const FOLDERS_KEY = 'ling-canvas-folders'
  const SEEDED_KEY = 'ling-canvas-folders-seeded'
  // 仅在"从来没有过文件夹记录"时注入，用户删掉后不再复活 | Seeded on first run only.
  const SEED_FOLDERS = ['我的项目', '家居设计', '参考资料']

  // 写操作单独包 try/catch：setItem 在隐私模式/配额耗尽时会抛，不能让它炸掉 store setup
  const safeSet = (key, value) => {
    try {
      localStorage.setItem(key, value)
      return true
    } catch (err) {
      console.error('Failed to persist folders:', err)
      return false
    }
  }

  const loadFolders = () => {
    let raw = null
    let seeded = false
    try {
      raw = localStorage.getItem(FOLDERS_KEY)
      seeded = localStorage.getItem(SEEDED_KEY) === '1'
    } catch (err) {
      // 读都读不了：退化为种子视图，不写盘
      console.error('Failed to load folders:', err)
      return [...SEED_FOLDERS]
    }

    if (raw === null && !seeded) {
      // 真·首次运行，注入种子
      safeSet(FOLDERS_KEY, JSON.stringify(SEED_FOLDERS))
      safeSet(SEEDED_KEY, '1')
      return [...SEED_FOLDERS]
    }
    // 老用户迁移：只补标记，绝不改写其现有列表
    if (!seeded) safeSet(SEEDED_KEY, '1')

    try {
      const parsed = JSON.parse(raw || '[]')
      if (!Array.isArray(parsed)) return []
      const seen = new Set()
      const list = []
      for (const item of parsed) {
        if (typeof item !== 'string') continue
        const name = item.trim()
        if (!name || seen.has(name)) continue
        seen.add(name)
        list.push(name)
      }
      return list
    } catch (err) {
      console.error('Failed to load folders:', err)
      return []
    }
  }
  const folders = ref(loadFolders())

  const persistFolders = () => {
    const ok = safeSet(FOLDERS_KEY, JSON.stringify(folders.value))
    if (!ok) window.$message?.error('本地存储写入失败，本次修改可能不会保留')
    return ok
  }

  // 计算属性 | Computed properties
  const viewTitle = computed(() => {
    if (currentView.value === 'folder' && currentFolder.value) {
      // 兜底：文件夹已被外部改动或删除时，不要渲染一个已死的名字
      return folders.value.includes(currentFolder.value) ? currentFolder.value : '全部画布'
    }
    const titles = {
      all: '全部画布',
      canvases: '全部画布',
      templates: '模板中心',
      favorites: '灵感收藏',
      assets: '素材库',
      recent: '最近使用',
      shared: '与我共享',
      trash: '回收站'
    }
    return titles[currentView.value] || '全部画布'
  })

  function setView(view, folder = null) {
    currentView.value = view
    currentFolder.value = folder
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function setSearchQuery(query) {
    searchQuery.value = query
  }

  /** @returns {'ok' | 'empty' | 'duplicate'} */
  function addFolder(name) {
    const value = String(name ?? '').trim()
    if (!value) return 'empty'
    if (folders.value.includes(value)) return 'duplicate'
    folders.value.push(value)
    persistFolders()
    return 'ok'
  }

  /** @returns {'ok' | 'unchanged' | 'empty' | 'duplicate' | 'missing'} */
  function renameFolder(oldName, newName) {
    const value = String(newName ?? '').trim()
    if (!value) return 'empty'
    const index = folders.value.indexOf(oldName)
    if (index === -1) return 'missing'
    if (value === oldName) return 'unchanged'
    if (folders.value.some((folder, i) => folder === value && i !== index)) return 'duplicate'
    folders.value.splice(index, 1, value)
    // 承重：正在浏览的文件夹改名后，视图标题与侧边栏高亮都要跟着走
    if (currentFolder.value === oldName) currentFolder.value = value
    persistFolders()
    return 'ok'
  }

  function removeFolder(name) {
    const index = folders.value.indexOf(name)
    if (index === -1) return false
    folders.value.splice(index, 1)
    // 删掉正在浏览的文件夹就回首页，避免把用户留在已不存在的视图里
    if (currentView.value === 'folder' && currentFolder.value === name) {
      setView('all')
    }
    persistFolders()
    return true
  }

  return {
    currentView,
    currentFolder,
    sidebarCollapsed,
    searchQuery,
    folders,
    viewTitle,
    setView,
    toggleSidebar,
    setSearchQuery,
    addFolder,
    renameFolder,
    removeFolder
  }
})
