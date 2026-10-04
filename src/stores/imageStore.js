/**
 * IndexedDB image store | IndexedDB 图片存取
 * Persists node images (data URLs) outside localStorage quota | 把节点图片持久化到 IndexedDB，绕开 localStorage 容量限制
 */
import { blobToDataUrl, makeThumbDataUrl } from '../utils/imageThumb'
import { createMediaCache } from '../utils/mediaCache'
const mediaCache = createMediaCache()
export const peekImage = key => mediaCache.peek(key)
export const imagePreviewKey = key => `${key}:__preview__`
let previewQueue = Promise.resolve()
const queuePreview = (key, dataUrl) => {
  if (!String(dataUrl).startsWith('data:image/') || key.endsWith('__thumb__') || key.endsWith('__preview__')) return
  previewQueue = previewQueue.catch(() => {}).then(async () => {
    if (peekImage(key) !== dataUrl) return
    const result = await makeThumbDataUrl(dataUrl, { maxEdge: 768 })
    if (result && peekImage(key) === dataUrl) await saveImage(imagePreviewKey(key), result.dataUrl)
  }).catch(error => console.warn('Image preview generation failed:', error))
}

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
  mediaCache.put(key, dataUrl)
  if (isTauriRuntime()) {
    await invokeTauri('save_canvas_media', { key, dataUrl })
    queuePreview(key, dataUrl)
    return
  }
  const blob = await (await fetch(dataUrl)).blob()
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  queuePreview(key, dataUrl)
}

export const loadImage = key => mediaCache.load(key, () => readImage(key)).then(value => {
  if (!peekImage(imagePreviewKey(key))) queuePreview(key, value)
  return value
})
const readImage = async (key) => {
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
  mediaCache.remove(key)
  if (!key.endsWith('__preview__') && !key.endsWith('__thumb__')) {
    await deleteImage(imagePreviewKey(key))
  }
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
