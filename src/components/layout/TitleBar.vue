<script setup>
/**
 * Custom title bar | 自绘标题栏
 * Frameless window has no native chrome, so minimize/maximize/close and
 * drag-to-move are drawn here. Hidden entirely when running in a plain browser.
 */
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useUIStore } from '../../stores/ui'

// Tauri v2 injects this only inside the webview | 仅在 Tauri webview 内注入
const isTauri = '__TAURI_INTERNALS__' in window
const route = useRoute()
const ui = useUIStore()
const searchInput = ref(null)
const isHomePage = computed(() => route.path === '/')

// Parent drops the rounded corners while maximized | 最大化时由父组件摘掉圆角
const emit = defineEmits(['maximized-change'])

const isMaximized = ref(false)
watch(isMaximized, (value) => emit('maximized-change', value))
let appWindow = null
let unlistenResize = null
let syncTimer = null

// onResized fires continuously while drag-resizing, so debounce the IPC query
// 拖拽缩放时 onResized 会高频触发，去抖后再查询最大化状态
const scheduleSync = () => {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    try {
      isMaximized.value = await appWindow.isMaximized()
    } catch (err) {
      console.warn('[TitleBar] isMaximized query failed:', err)
    }
  }, 80)
}

onMounted(async () => {
  window.addEventListener('keydown', handleSearchShortcut)
  if (!isTauri) return
  try {
    appWindow = getCurrentWindow()
    isMaximized.value = await appWindow.isMaximized()
    unlistenResize = await appWindow.onResized(scheduleSync)
  } catch (err) {
    console.warn('[TitleBar] Tauri window API not available:', err)
    appWindow = null
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleSearchShortcut)
  clearTimeout(syncTimer)
  if (unlistenResize) {
    unlistenResize()
    unlistenResize = null
  }
})

const run = (action) => async () => {
  if (!appWindow) return
  try {
    await appWindow[action]()
  } catch (err) {
    console.warn(`[TitleBar] ${action} failed:`, err)
  }
}

const minimize = run('minimize')
const toggleMaximize = run('toggleMaximize')
const close = run('close')

const handleSearchShortcut = async (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && isHomePage.value) {
    event.preventDefault()
    await nextTick()
    searchInput.value?.focus()
  }
}
</script>

<template>
  <div v-if="isTauri" class="title-bar" data-tauri-drag-region>
    <span class="title-bar__label" data-tauri-drag-region>
      <img class="title-bar__logo" src="/logo.png" alt="Ling Canvas" />
      <span>Ling Canvas</span>
    </span>

    <label v-if="isHomePage" class="title-bar__search">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
        <path d="m16.4 16.4 4.1 4.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input
        ref="searchInput"
        :value="ui.searchQuery"
        type="search"
        placeholder="搜索画布、素材、模板..."
        @input="ui.setSearchQuery($event.target.value)"
      />
      <kbd>Ctrl + K</kbd>
    </label>

    <div class="title-bar__controls">
      <button class="title-bar__btn" title="最小化" @click="minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="1" y="4.5" width="8" height="1" fill="currentColor" />
        </svg>
      </button>

      <button
        class="title-bar__btn"
        :title="isMaximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect
            v-if="isMaximized"
            x="1.5" y="2.5" width="6" height="6"
            fill="none" stroke="currentColor" stroke-width="1"
          />
          <g v-else fill="none" stroke="currentColor" stroke-width="1">
            <rect x="1" y="3" width="6" height="6" />
            <path d="M3 3V1h6v6H7" />
          </g>
        </svg>
      </button>

      <button class="title-bar__btn title-bar__btn--close" title="关闭" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M1 1l8 8M9 1l-8 8"
            fill="none" stroke="currentColor" stroke-width="1.2"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 标题栏容器 | Title bar container */
.title-bar {
  @apply relative flex h-[48px] shrink-0 items-center justify-between select-none
    border-b border-gray-100 bg-white px-5 dark:border-gray-800 dark:bg-[#121212];
}

/* 标题文字 | Title label */
.title-bar__label {
  @apply flex items-center gap-2 text-[14px] font-semibold tracking-wide
    text-gray-700 dark:text-gray-200;
}

.title-bar__logo {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.title-bar__controls {
  @apply flex items-center gap-1;
}

.title-bar__search {
  @apply absolute left-1/2 top-1/2 flex h-10 w-[430px] -translate-x-1/2 -translate-y-1/2
    items-center gap-3 rounded-full border border-gray-200 bg-white px-4 text-gray-400
    shadow-[0_5px_20px_rgba(31,41,55,0.08)] transition-all dark:border-gray-700 dark:bg-[#1d1d1d];
  -webkit-app-region: no-drag;
}

.title-bar__search:focus-within {
  @apply border-blue-300 text-blue-500 ring-4 ring-blue-50 dark:border-blue-600 dark:ring-blue-950/40;
}

.title-bar__search input {
  @apply min-w-0 flex-1 select-text bg-transparent text-[13px] text-gray-700 outline-none
    placeholder:text-gray-400 dark:text-gray-200 dark:placeholder:text-gray-500;
}

.title-bar__search input::-webkit-search-cancel-button {
  display: none;
}

.title-bar__search kbd {
  @apply whitespace-nowrap rounded-md bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-400
    dark:bg-gray-800 dark:text-gray-500;
}

/* 窗口控制按钮 | Window control buttons */
.title-bar__btn {
  @apply flex h-7 w-9 items-center justify-center rounded-md
    text-gray-500 transition-colors duration-150
    hover:bg-gray-200/70 dark:text-gray-400 dark:hover:bg-gray-700/60;
}

/* 关闭按钮悬停用警示色 | Close button uses danger colour on hover */
.title-bar__btn--close {
  @apply hover:bg-red-500 hover:text-white dark:hover:bg-red-600 dark:hover:text-white;
}

@media (max-width: 1050px) {
  .title-bar__search {
    width: 340px;
  }
}
</style>
