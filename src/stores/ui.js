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

  const DEFAULT_FOLDERS = ['我的项目', '家居设计', '参考资料']
  const loadFolders = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('ling-canvas-folders') || '[]')
      return [...new Set([...DEFAULT_FOLDERS, ...saved.filter(Boolean)])]
    } catch {
      return [...DEFAULT_FOLDERS]
    }
  }
  const folders = ref(loadFolders())

  // 计算属性 | Computed properties
  const viewTitle = computed(() => {
    if (currentView.value === 'folder' && currentFolder.value) {
      return currentFolder.value
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

  function addFolder(name) {
    const value = String(name || '').trim()
    if (!value || folders.value.includes(value)) return false
    folders.value.push(value)
    localStorage.setItem('ling-canvas-folders', JSON.stringify(folders.value))
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
    addFolder
  }
})
