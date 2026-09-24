import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { readFileSync } from 'node:fs'

// 版本号兜底值，供 useAppVersion 在纯浏览器（pnpm dev）下使用。
// 读 package.json 而不是写死，免得发版时忘了同步这一处
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    proxy: {
      '/v1': {
        target: 'https://api.chatfire.site',
        changeOrigin: true
      }
    }
  }
})
