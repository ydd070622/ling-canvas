/**
 * IndexedDB image store | IndexedDB 图片存取
 * Persists node images (data URLs) outside localStorage quota | 把节点图片持久化到 IndexedDB，绕开 localStorage 容量限制
 */
import { blobToDataUrl } from '../utils/imageThumb'

const DB_NAME = 'ling-canvas-images'
const STORE_NAME = 'images'

const isTauriRuntime = () => (
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
)

const invokeTauri = async (command, args = {}) => {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

const openDB = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME)
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

export const saveImage = async (key, dataUrl) => {
  if (isTauriRuntime()) {
    await invokeTauri('save_canvas_media', { key, dataUrl })
    return
  }
  const blob = await (await fetch(dataUrl)).blob()
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const loadImage = async (key) => {
  if (isTauriRuntime()) {
    const dataUrl = await invokeTauri('load_canvas_media', { key })
    if (dataUrl) return dataUrl

    // One-time compatibility path for pictures saved by pre-file-storage builds.
    const legacyBlob = await loadBrowserImage(key).catch(() => null)
    if (legacyBlob) {
      const legacyDataUrl = await blobToDataUrl(legacyBlob)
      await saveImage(key, legacyDataUrl)
      return legacyDataUrl
    }
    return null
  }
  return loadBrowserImage(key)
}

const loadBrowserImage = async (key) => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

/**
 * 与 loadImage 同源，但**保证**返回 data URL 字符串。
 *
 * `loadImage` 的返回类型依平台而异：Tauri 下是 data URL 字符串，浏览器下是 Blob。
 * 需要把值直接交给 `<img src>` 或写进文档时用这个，免得每个调用方各自判断一遍。
 *
 * @returns {Promise<string|null>}
 */
export const loadImageAsDataUrl = async (key) => {
  const media = await loadImage(key)
  if (!media) return null
  if (typeof media === 'string') return media
  try {
    return await blobToDataUrl(media)
  } catch {
    return null
  }
}

export const listImageKeys = async (prefix = '') => {
  if (isTauriRuntime()) {
    const separator = prefix.indexOf(':')
    const projectId = separator >= 0 ? prefix.slice(0, separator) : prefix
    const fileKeys = await invokeTauri('list_canvas_media_keys', { projectId })
    const legacyKeys = await listBrowserImageKeys(prefix).catch(() => [])
    return [...new Set([...fileKeys, ...legacyKeys])].filter(key => String(key).startsWith(prefix))
  }
  return listBrowserImageKeys(prefix)
}

const listBrowserImageKeys = async (prefix = '') => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys()
    request.onsuccess = () => resolve((request.result || []).filter(key => String(key).startsWith(prefix)))
    request.onerror = () => reject(request.error)
  })
}

export const deleteImage = async (key) => {
  if (isTauriRuntime()) {
    await invokeTauri('delete_canvas_media', { key })
    await deleteBrowserImage(key).catch(() => {})
    return
  }
  return deleteBrowserImage(key)
}

const deleteBrowserImage = async (key) => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
