export function imageGallerySlots(data = {}) {
  const urls = Array.isArray(data.galleryUrls) ? data.galleryUrls : []
  if (data.loading) {
    const count = Math.max(1, Math.floor(Number(data.generationCount ?? data.count) || 1))
    return Array.from({ length: count }, (_, index) => ({ url: data.generationUrls?.[index] || '', index, pending: !data.generationUrls?.[index] }))
  }
  if (urls.length > 1) {
    const main = Math.min(Math.max(Number(data.mainImageIndex) || 0, 0), urls.length - 1)
    return [main, ...urls.map((_, index) => index).filter(index => index !== main)]
      .filter(index => urls[index]).map(index => ({ url: urls[index], index }))
  }
  return data.url ? [{ url: data.url, index: -1 }] : []
}
