/**
 * Main entry point | 主入口
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { initProjectsStore } from './stores/projects'
import './style.css'
import './styles/flow-nodes.css'

const app = createApp(App)
const pinia = createPinia()

/* ---------------------------------------------------------------- 全局异常浮层
   打包后的 Tauri webview 没有 devtools，渲染期抛出的异常只会静默消失，
   表现就是「节点凭空不见、还点不中」。这里把异常原文糊到屏幕底部，
   截个图就能定位。正常运行时它不出现、无额外开销。 */
const showFatal = (text) => {
  let el = document.getElementById('__fatal')
  if (!el) {
    el = document.createElement('pre')
    el.id = '__fatal'
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:46vh;overflow:auto;'
      + 'margin:0;padding:12px 16px;background:#7f1d1d;color:#fff;z-index:99999;'
      + 'white-space:pre-wrap;font:12px/1.55 ui-monospace,Consolas,monospace'
    document.body.appendChild(el)
  }
  el.textContent += `${text}\n\n`
}
app.config.errorHandler = (err, instance, info) => {
  showFatal(`[Vue ${info}]\n${err?.stack || err?.message || String(err)}`)
}
window.addEventListener('error', event => {
  // Browser layout delivery notice, not a failed render or uncaught exception.
  if (!event.error && /^ResizeObserver loop (completed with undelivered notifications\.|limit exceeded)$/.test(event.message || '')) return
  showFatal(`[window]\n${event.error?.stack || event.message}`)
})
window.addEventListener('unhandledrejection', event => (
  showFatal(`[promise]\n${event.reason?.stack || String(event.reason)}`)
))

app.use(pinia)
app.use(router)
// Project persistence is asynchronous (Tauri files / IndexedDB). Do not mount
// routes until migration and initial loading finish, otherwise a canvas route
// could treat the still-empty store as a new document and overwrite it.
const bootstrap = async () => {
  await initProjectsStore()
  app.mount('#app')
}
bootstrap().catch(error => showFatal(`[bootstrap]\n${error?.stack || error?.message || String(error)}`))
