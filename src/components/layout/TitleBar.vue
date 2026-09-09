<script setup>
/**
 * Custom title bar | 自绘标题栏
 * Frameless window has no native chrome, so minimize/maximize/close and
 * drag-to-move are drawn here. Hidden entirely when running in a plain browser.
 */
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Tauri v2 injects this only inside the webview | 仅在 Tauri webview 内注入
const isTauri = '__TAURI_INTERNALS__' in window

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
</script>

<template>
  <div v-if="isTauri" class="title-bar" data-tauri-drag-region>
    <span class="title-bar__label" data-tauri-drag-region>
      <img class="title-bar__logo" src="/logo.png" alt="Ling Canvas" />
      <span>Ling Canvas</span>
    </span>

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
  @apply flex h-9 shrink-0 items-center justify-between select-none
    border-b border-transparent bg-transparent px-3;
}

/* 标题文字 | Title label */
.title-bar__label {
  @apply flex items-center gap-2 text-[13px] font-medium tracking-wide
    text-gray-500 dark:text-gray-400;
}

.title-bar__logo {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.title-bar__controls {
  @apply flex items-center gap-1;
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
</style>
