import { ref } from 'vue'
import { fetchBytes } from '../utils/downloadMedia'
import { projects } from './projects'
export const localFolders = ref([])
export async function localCall(command, args = {}) {
  if (!window.__TAURI_INTERNALS__) throw new Error('本地空间需要在桌面端运行')
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke(command, args) } catch (e) { throw new Error(String(e?.message || e)) }
}
export async function loadLocalFolders() { localFolders.value = await localCall('local_folders'); return localFolders.value }
export async function connectLocalFolder() { const folder = await localCall('connect_local_folder'); if (folder) await loadLocalFolders(); return folder }
export const requestLocalSave = (urls, label = '图片') => window.dispatchEvent(new CustomEvent('ling-save-local', { detail: { urls: urls.filter(Boolean), label } }))
export async function saveImagesToFolder(urls, destination, label = '图片') {
  const paths = [], failures = []
  for (const [index, url] of urls.entries()) {
    try {
      const { bytes, contentType } = await fetchBytes(url)
      const ext = ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' })[contentType?.split(';')[0]] || 'png'
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
      const name = String(label).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) || '图片'
      paths.push(await localCall('save_local_image', { id: destination.id, relative: destination.relative || '', fileName: `${name}-${Date.now()}-${index + 1}.${ext}`, dataBase64: btoa(binary) }))
    } catch (e) { failures.push({ url, error: e.message }) }
  }
  return { paths, failures }
}
export async function autoSaveNodeImages(projectId, urls, label) {
  const destination = projects.value.find(p => p.id === projectId)?.canvasData?.localOutput
  if (!destination?.auto || !destination.id) return
  const { failures } = await saveImagesToFolder(urls, destination, label)
  if (failures.length) {
    window.$message?.warning(`有 ${failures.length} 张图片未保存到本地文件夹：${failures[0].error}。图片仍保留在画布，可重新保存。`)
    requestLocalSave(failures.map(f => f.url), label)
  }
}
