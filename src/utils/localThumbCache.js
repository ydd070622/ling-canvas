import { localCall } from '../stores/localSpace'
import { canvasPreview } from './canvasPreview'

let database, queue = Promise.resolve()
const pending = new Map()
function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('ling-local-thumbnails', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('thumbnails', { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return database
}
async function stored(key) {
  const database = await db()
  return new Promise((resolve, reject) => {
    const request = database.transaction('thumbnails').objectStore('thumbnails').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function save(record) {
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('thumbnails', 'readwrite')
    transaction.objectStore('thumbnails').put(record)
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
  })
}
export function localThumbnail(props) {
  const key = JSON.stringify([props.folderId, props.relative, props.folder])
  const version = `${props.modifiedAt || 0}:${props.byteLength || 0}`
  const token = key + version + (props.cacheVersion || 0)
  if (pending.has(token)) return pending.get(token)
  const task = (async () => {
    const cached = await stored(key).catch(() => null)
    if (!props.cacheVersion && cached?.version === version) return cached.blob
    // Queue original reads too, so a visible grid cannot flood IPC with large originals.
    const work = queue.then(async () => {
      const data = await localCall(props.folder ? 'read_local_folder_cover' : 'read_local_image', { id: props.folderId, relative: props.relative })
      if (!data) return null
      const preview = await canvasPreview(data)
      const blob = preview?.blob || await (await fetch(data)).blob()
      await save({ key, version, blob }).catch(() => {})
      return blob
    })
    queue = work.catch(() => {})
    return work
  })()
  pending.set(token, task)
  task.finally(() => pending.delete(token)).catch(() => {})
  return task
}
