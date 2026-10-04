import { ref } from 'vue'
const KEY = 'ling-canvas-preferences'
let stored = {}
try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch {}
export const preferences = ref({ prewarm: stored.prewarm !== false, zoomOnScroll: stored.zoomOnScroll !== false })
export const setPreference = (key, value) => {
  if (!Object.hasOwn(preferences.value, key)) return
  const next = {...preferences.value, [key]:!!value}
  try { localStorage.setItem(KEY, JSON.stringify(next)); preferences.value = next }
  catch { window.$message?.error('偏好保存失败') }
}
