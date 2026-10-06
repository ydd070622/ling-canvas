self.onmessage = async ({ data: { id, url } }) => {
  let bitmap
  try {
    const blob = await (await fetch(url)).blob()
    bitmap = await createImageBitmap(blob)
    const width = bitmap.width, height = bitmap.height
    const scale = Math.min(1, 768 / Math.max(width, height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const preview = await canvas.convertToBlob({ type: 'image/webp', quality: .85 })
    self.postMessage({ id, result: { blob: preview, width, height } })
  } catch { self.postMessage({ id, result: null }) }
  finally { bitmap?.close() }
}
