export const normalizedRect = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y)
})

export const pixelCrop = (rect, width, height) => {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)))
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)))
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(rect.width * width))),
    height: Math.max(1, Math.min(height - y, Math.round(rect.height * height))) }
}

export const fitCropRatio = (rect, ratio, width, height) => {
  if (!ratio) return rect
  const normalizedRatio = ratio * height / width
  let w = rect.width, h = rect.height
  if (w / h > normalizedRatio) w = h * normalizedRatio
  else h = w / normalizedRatio
  return { x: rect.x + (rect.width - w) / 2, y: rect.y + (rect.height - h) / 2, width: w, height: h }
}
