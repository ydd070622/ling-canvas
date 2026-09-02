<script setup>
/**
 * Root App component | 根组件
 * Provides naive-ui config, global layout with sidebar, and router view
 */
import { computed, defineComponent } from 'vue'
import { useRoute } from 'vue-router'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme, useMessage } from 'naive-ui'
import { isDark } from './stores/theme'
import AppSidebar from './components/layout/AppSidebar.vue'

const route = useRoute()

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
const themeOverrides = {
  common: {
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
    heightMedium: '36px',
    paddingMedium: '0 16px'
  },
  Input: {
    borderRadius: '10px',
    heightMedium: '36px'
  }
}
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <MessageBridge />
      <n-dialog-provider>
        <!-- 画布页面：全屏显示，无侧边栏 | Canvas page: fullscreen, no sidebar -->
        <router-view v-if="isCanvasPage" />
        <!-- 其他页面：侧边栏 + 内容区 | Other pages: sidebar + content -->
        <div v-else class="flex h-screen w-screen overflow-hidden">
          <AppSidebar />
          <main class="flex-1 overflow-auto bg-white dark:bg-gray-900">
            <router-view />
          </main>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
/* Global app styles handled in style.css */
</style>
