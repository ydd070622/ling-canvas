import { ref } from 'vue'
import { idbGet, idbPut } from './idb'
export const generationHistory = ref([])
let ready, queue = Promise.resolve()
export const loadGenerationHistory = () => ready ||= idbGet('ling-generation-history', 'images', 'all').then(items => { generationHistory.value = items || [] }).catch(error => { ready = null; throw error })
export const recordGeneratedImages = (results, metadata = {}) => {
  queue = queue.catch(() => {}).then(async () => {
    await loadGenerationHistory()
    const known = new Set(generationHistory.value.map(item => item.sourceUrl || item.data.url))
    const added = results.filter(item => item?.url && !known.has(item.url)).map(item => ({ id: crypto.randomUUID(), createdAt: Date.now(), data: { url: item.url, label: '生成图片', model: metadata.model || '' } }))
    if (!added.length) return
    const next = [...added, ...generationHistory.value]
    await idbPut('ling-generation-history', 'images', 'all', JSON.parse(JSON.stringify(next)))
    generationHistory.value = next
    // Keep a local copy so supplier links and blob URLs can expire safely.
    for (const item of added) {
      if (item.data.url.startsWith('data:')) continue
      try {
        const { fetchBytes } = await import('../utils/downloadMedia')
        const { bytes, contentType } = await fetchBytes(item.data.url)
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject
          reader.readAsDataURL(new Blob([bytes], { type: contentType || 'image/png' }))
        })
        item.sourceUrl = item.data.url
        item.data.url = dataUrl
      } catch (error) { console.warn('历史图片本地缓存失败，保留原地址', error) }
    }
    await idbPut('ling-generation-history', 'images', 'all', JSON.parse(JSON.stringify(next)))
    generationHistory.value = [...next]
  })
  return queue
}
export const deleteGenerationHistory = ids => {
  queue = queue.catch(() => {}).then(async () => {
    await loadGenerationHistory()
    const next = generationHistory.value.filter(item => !ids.includes(item.id))
    await idbPut('ling-generation-history', 'images', 'all', JSON.parse(JSON.stringify(next)))
    generationHistory.value = next
  })
  return queue
}
