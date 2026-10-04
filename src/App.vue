<script setup>
/**
 * Root App component | 根组件
 * Provides naive-ui config, global layout with sidebar, and router view
 */
import { computed, defineComponent, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme, useMessage } from 'naive-ui'
import { isDark } from './stores/theme'
import AppSidebar from './components/layout/AppSidebar.vue'
import TitleBar from './components/layout/TitleBar.vue'

const route = useRoute()

// Tauri v2 injects this only inside the webview | 仅在 Tauri webview 内注入
const isTauri = '__TAURI_INTERNALS__' in window

// Rounded frame is dropped while the window is maximized | 最大化时摘掉圆角外框
const isMaximized = ref(false)

// 判断当前是否在画布页面 | Check if current route is canvas page
const isCanvasPage = computed(() => route.path.startsWith('/canvas'))

// Bridge naive-ui message API onto window.$message | 把 message 实例桥接到 window.$message 供全局调用
const MessageBridge = defineComponent({
  setup() {
    window.$message = useMessage()
    return () => null
  }
})

// Naive UI theme based on dark mode | 基于深色模式的 Naive UI 主题
const theme = computed(() => isDark.value ? darkTheme : null)

// Global theme overrides | 全局主题覆盖
const themeOverrides = computed(() => ({
  common: {
    primaryColor: isDark.value ? '#e5e5e5' : '#292929',
    primaryColorHover: isDark.value ? '#ffffff' : '#404040',
    primaryColorPressed: isDark.value ? '#cccccc' : '#161616',
    primaryColorSuppl: isDark.value ? '#ffffff' : '#404040',
    textColorBase: isDark.value ? '#ededed' : '#242424',
    borderColor: isDark.value ? '#383838' : '#e2e2e2',
    bodyColor: isDark.value ? '#202020' : '#ffffff',
    borderRadius: '12px',
    borderRadiusSmall: '8px'
  },
  Dialog: {
    borderRadius: '16px',
    padding: '24px'
  },
  Modal: {
    borderRadius: '16px',
    padding: '24px'
  },
  Card: {
    borderRadius: '16px',
    padding: '24px'
  },
  Button: {
    borderRadiusMedium: '10px',
    borderRadiusSmall: '8px',
    borderRadiusLarge: '12px',
    textColorPrimary: isDark.value ? '#202020' : '#ffffff',
    textColorHoverPrimary: isDark.value ? '#202020' : '#ffffff',
    textColorPressedPrimary: isDark.value ? '#202020' : '#ffffff',
    heightMedium: '36px',
    paddingMedium: '0 16px'
  },
  Switch: { buttonColor: isDark.value ? '#202020' : '#ffffff' },
  Checkbox: { checkMarkColor: isDark.value ? '#202020' : '#ffffff' },
  Input: {
    borderRadius: '10px',
    heightMedium: '36px'
  }
}))
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <MessageBridge />
      <n-dialog-provider>
        <!-- 圆角外壳：窗口本身透明，外框由这一层画出 | Rounded shell drawn over the transparent window -->
        <div class="app-layout" :class="{ 'app-rounded': isTauri && !isMaximized }">
          <TitleBar @maximized-change="isMaximized = $event" />

          <!-- 画布页面：无侧边栏 | Canvas page: no sidebar -->
          <div v-if="isCanvasPage" class="min-h-0 flex-1 overflow-hidden">
            <router-view />
          </div>
          <!-- 其他页面：侧边栏 + 内容区 | Other pages: sidebar + content -->
          <div v-else class="flex min-h-0 flex-1 overflow-hidden">
            <AppSidebar />
            <main class="flex-1 overflow-auto bg-white dark:bg-[#1a1a1a]">
              <router-view />
            </main>
          </div>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
/* Global app styles handled in style.css */
</style>
