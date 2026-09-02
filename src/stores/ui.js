/**
 * UI store | UI 状态管理
 * Manages sidebar, view switching, and folder navigation
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUIStore = defineStore('ui', () => {
  // 当前视图：'all' | 'recent' | 'shared' | 'trash' | 'folder'
  const currentView = ref('all')
  // 当前选中的文件夹名称
  const currentFolder = ref(null)
  // 侧边栏折叠状态
  const sidebarCollapsed = ref(false)

  // 计算属性 | Computed properties
  const viewTitle = computed(() => {
    if (currentView.value === 'folder' && currentFolder.value) {
      return currentFolder.value
    }
    const titles = {
      all: '全部画布',
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

  return { currentView, currentFolder, sidebarCollapsed, viewTitle, setView, toggleSidebar }
})
