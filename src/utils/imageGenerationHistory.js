/** Keep successful batches separate from the current gallery. */
export function appendImageGeneration(data, urls, now = Date.now(), batchId = null) {
  const history = Array.isArray(data.imageHistory) ? [...data.imageHistory] : []
  if (!history.length && data.url && !data.assetRef) {
    history.push({ id: `legacy-${now}`, createdAt: data.updatedAt || now, urls: data.galleryUrls?.length ? [...data.galleryUrls] : [data.url] })
  }
  if (urls.length) {
    const existing = batchId && history.find(batch => batch.id === batchId)
    if(existing) existing.urls = [...new Set([...existing.urls, ...urls])]
    else history.push({ id: batchId || `batch-${now}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now, urls: [...urls] })
  }
  return history
}
