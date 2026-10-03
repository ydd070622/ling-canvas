import { fetchBytes } from './downloadMedia'

// Render actual image rectangles, excluding node labels, ports and toolbars.
export const mergeImages = async (items) => {
  const left = Math.min(...items.map(item => item.x))
  const top = Math.min(...items.map(item => item.y))
  const width = Math.max(...items.map(item => item.x + item.width)) - left
  const height = Math.max(...items.map(item => item.y + item.height)) - top
  const decoded = []
  try {
    for (const item of items) {
      const { bytes, contentType } = await fetchBytes(item.url)
      const bitmap = await createImageBitmap(new Blob([bytes], { type: contentType || 'image/png' }))
      decoded.push({ ...item, bitmap })
    }
    const resolution = Math.min(4, ...decoded.map(item => item.bitmap.width / item.width))
    const scale = Math.min(resolution, 8192 / Math.max(width, height), Math.sqrt(32_000_000 / (width * height)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片合并画布')
    context.scale(scale, scale)
    for (const item of decoded.sort((a, b) => a.z - b.z)) {
      context.drawImage(item.bitmap, item.x - left, item.y - top, item.width, item.height)
    }
    return { url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, left, top, layoutHeight: height }
  } finally {
    decoded.forEach(item => item.bitmap.close())
  }
}
