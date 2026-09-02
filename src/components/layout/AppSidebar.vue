<script setup>
/**
 * AppSidebar | 全局导航栏（简化版）
 * 4 个平铺导航项，纯文字图标，无折叠分组
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NTooltip } from 'naive-ui'
import {
  SunnyOutline,
  MoonOutline,
  SettingsOutline
} from '@vicons/ionicons5'
import { isDark, toggleTheme } from '../../stores/theme'
import { activeProjects, trashedProjects } from '../../stores/projects'
import { useUIStore } from '../../stores/ui'
import ApiSettings from '../ApiSettings.vue'

const router = useRouter()
const ui = useUIStore()

// 设置弹窗 | Settings modal
const showApiSettings = ref(false)

// 项目总数 | Total project count
const projectCount = computed(() => activeProjects.value.length)

// 回收站数量 | Trash count
const trashCount = computed(() => trashedProjects.value.length)

// 意式极简项目数
const yishiCount = computed(() =>
  activeProjects.value.filter(p => p.folder === '意式极简').length
)

// 法式风格项目数
const fashiCount = computed(() =>
  activeProjects.value.filter(p => p.folder === '法式风格').length
)

// 导航到视图 | Navigate to view
function navigateToView(view) {
  ui.setView(view)
  if (router.currentRoute.value.path !== '/') {
    router.push('/')
  }
}

// 导航到文件夹 | Navigate to folder
function navigateToFolder(folderName) {
  ui.setView('folder', folderName)
  if (router.currentRoute.value.path !== '/') {
    router.push('/')
  }
}

// 判断当前导航项是否激活 | Check if nav item is active
function isViewActive(view) {
  return ui.currentView === view
}

// 判断文件夹是否激活 | Check if folder is active
function isFolderActive(folderName) {
  return ui.currentView === 'folder' && ui.currentFolder === folderName
}
</script>

<template>
  <aside
    class="
      flex flex-col h-full w-[220px] flex-shrink-0
      bg-[#f5f6f8] dark:bg-[#1e1e2e]
      border-r border-gray-200/60 dark:border-gray-700/50
      transition-all duration-300
      select-none
    "
    :class="{ 'w-0 overflow-hidden': ui.sidebarCollapsed }"
  >
    <!-- 导航区域 | Navigation area -->
    <nav class="flex-1 overflow-y-auto px-2.5 py-2 scrollbar-thin">
      <!-- 个人分组标题 | Personal section header -->
      <div class="section-header">个人</div>

      <div class="space-y-0.5">
        <!-- 全部画布 -->
        <button
          class="sidebar-nav-item"
          :class="{ 'sidebar-nav-item--active': isViewActive('all') }"
          @click="navigateToView('all')"
        >
          <span class="nav-text-icon">全</span>
          <span class="flex-1 text-left">全部画布</span>
          <span class="sidebar-count-badge">{{ projectCount }}</span>
        </button>

        <!-- 意式极简 -->
        <button
          class="sidebar-nav-item"
          :class="{ 'sidebar-nav-item--active': isFolderActive('意式极简') }"
          @click="navigateToFolder('意式极简')"
        >
          <span class="nav-text-icon">意</span>
          <span class="flex-1 text-left">意式极简</span>
          <span class="sidebar-count-badge">{{ yishiCount }}</span>
        </button>

        <!-- 法式风格 -->
        <button
          class="sidebar-nav-item"
          :class="{ 'sidebar-nav-item--active': isFolderActive('法式风格') }"
          @click="navigateToFolder('法式风格')"
        >
          <span class="nav-text-icon">法</span>
          <span class="flex-1 text-left">法式风格</span>
          <span class="sidebar-count-badge">{{ fashiCount }}</span>
        </button>

        <!-- 回收站 -->
        <button
          class="sidebar-nav-item"
          :class="{ 'sidebar-nav-item--active': isViewActive('trash') }"
          @click="navigateToView('trash')"
        >
          <span class="nav-text-icon">废</span>
          <span class="flex-1 text-left">回收站</span>
          <span class="sidebar-count-badge">{{ trashCount }}</span>
        </button>
      </div>
    </nav>

    <!-- 底部工具栏 | Bottom toolbar -->
    <div class="flex items-center justify-between px-3 py-2.5 border-t border-gray-200/60 dark:border-gray-700/50">
      <!-- 主题切换 | Theme toggle -->
      <button
        class="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200 transition-colors cursor-pointer"
        @click="toggleTheme"
      >
        <SunnyOutline v-if="!isDark" class="w-4 h-4" />
        <MoonOutline v-else class="w-4 h-4" />
        <span>主题</span>
      </button>

      <!-- 设置 | Settings -->
      <n-tooltip placement="top" :show-arrow="false">
        <template #trigger>
          <button class="sidebar-tool-btn" @click="showApiSettings = true">
            <SettingsOutline class="w-4 h-4" />
          </button>
        </template>
        设置
      </n-tooltip>
    </div>

    <!-- API 设置弹窗 | API settings modal -->
    <ApiSettings v-model:show="showApiSettings" />
  </aside>
</template>

<style scoped>
/* 分组标题 | Section header */
.section-header {
  @apply px-3.5 pt-2 pb-1.5 text-[13px] font-semibold
    text-gray-400 dark:text-gray-500
    uppercase tracking-wider select-none;
}

/* 导航项基础样式 | Nav item base styles */
.sidebar-nav-item {
  @apply flex items-center gap-3 px-3.5 py-[11px] rounded-md text-[17px]
    text-gray-600 dark:text-gray-300
    hover:bg-gray-200/50 dark:hover:bg-gray-700/50
    transition-all duration-150 cursor-pointer w-full;
}

/* 导航项激活状态 | Nav item active state */
.sidebar-nav-item--active {
  @apply bg-blue-50 text-blue-600 font-medium
    dark:bg-blue-900/25 dark:text-blue-400
    hover:bg-blue-100/80 dark:hover:bg-blue-900/35;
}

/* 纯文字图标 | Text-based icon */
.nav-text-icon {
  @apply w-[22px] h-[22px] flex-shrink-0 text-[15px] font-bold leading-none
    flex items-center justify-center rounded-md
    bg-gray-200/60 dark:bg-gray-700/50
    text-gray-500 dark:text-gray-400;
}

/* 计数徽章 | Count badge */
.sidebar-count-badge {
  @apply text-[14px] text-gray-400 dark:text-gray-500 tabular-nums;
}

/* 底部工具按钮 | Bottom tool button */
.sidebar-tool-btn {
  @apply flex items-center justify-center w-8 h-8 rounded-md
    text-gray-500 dark:text-gray-400
    hover:bg-gray-200/50 dark:hover:bg-gray-700/50
    hover:text-gray-700 dark:hover:text-gray-200
    transition-all duration-150 cursor-pointer;
}

/* 自定义滚动条 | Custom scrollbar */
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  @apply bg-gray-300/60 dark:bg-gray-600/60 rounded-full;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  @apply bg-gray-400/60 dark:bg-gray-500/60;
}
</style>
