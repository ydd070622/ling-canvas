/**
 * IndexedDB image store | IndexedDB 图片存取
 * Persists node images (data URLs) outside localStorage quota | 把节点图片持久化到 IndexedDB，绕开 localStorage 容量限制
 */
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

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(reader.error || new Error('无法读取旧版图片数据'))
  reader.readAsDataURL(blob)
})

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
