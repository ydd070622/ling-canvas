let worker, workerFailed = false, nextId = 0
const pending = new Map()
const inWorker = url => {
  if (workerFailed || typeof Worker === 'undefined') return Promise.resolve(undefined)
  try {
    if (!worker) {
      worker = new Worker(new URL('./canvasPreview.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }) => { pending.get(data.id)?.(data.result); pending.delete(data.id) }
      worker.onerror = () => {
        workerFailed = true; worker.terminate(); worker = null
        for (const resolve of pending.values()) resolve(undefined)
        pending.clear()
      }
    }
    return new Promise(resolve => { const id = ++nextId; pending.set(id, resolve); worker.postMessage({ id, url }) })
  } catch { workerFailed = true; return Promise.resolve(undefined) }
}
const cache = new Map()
let queue = Promise.resolve()

// Decode only one original at a time; retain a bounded cache of small previews.
export const canvasPreview = url => {
  if (!url || !/^(data:image\/|blob:)/.test(url)) return Promise.resolve(null)
  if (cache.has(url)) return cache.get(url)
  const task = queue.then(async () => {
    const result = await inWorker(url)
    if (result !== undefined) return result
    await new Promise(resolve => { if(typeof requestIdleCallback === 'function') requestIdleCallback(resolve, { timeout: 250 }); else setTimeout(resolve, 24) })
    let bitmap
    try {
      const blob = await (await fetch(url)).blob()
      bitmap = await createImageBitmap(blob)
      const width = bitmap.width, height = bitmap.height
      const scale = Math.min(1, 768 / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const preview = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .85))
      return preview ? { blob: preview, width, height } : null
    } catch { return null }
    finally { bitmap?.close() }
  })
  queue = task.then(() => {})
  cache.set(url, task)
  if (cache.size > 24) cache.delete(cache.keys().next().value)
  return task
}
