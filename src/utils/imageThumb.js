/**
 * 图片降采样 | Image downscaling
 *
 * 「字节 → 小图」这一段纯逻辑的唯一出处。
 *
 * **分层边界**（重要，别把下面这些东西搬进来）：
 *
 * - 素材库的 `{failed:true}` 不重试语义、`ASSET_THUMB_VERSION` 版本失效判据、
 *   `thumbEpoch` 换根闸门、`readAssetFile` 的 IPC 异常 —— 全部**留在**
 *   `services/assetLibrary.js`。本模块完全不知道"换根""缓存""素材库"这些概念，
 *   所以它不可能把旧根的结果写回新缓存。
 * - 本模块也**不 import `services/assetLibrary.js`**，方向反过来：那边 import 我。
 *
 * **失败一律返回 `null`，绝不抛**。解码失败（损坏文件、浏览器不认的格式、
 * 把 mp4 喂给 createImageBitmap）是可预期的常态，不是异常。
 */

export const DEFAULT_THUMB_MAX_EDGE = 512
export const DEFAULT_THUMB_QUALITY = 0.72
/** webp 带 alpha 时避免黑底 */
export const DEFAULT_THUMB_BACKGROUND = '#ffffff'

/**
 * Blob → data URL。
 *
 * `save_canvas_media`（`src-tauri/src/lib.rs:330`）**要求 `data:` 前缀**，
 * 裸 base64 串和 blob URL 一律被拒，所以写进 media 存储前必须过这一道。
 */
export const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(reader.error || new Error('无法读取图片数据'))
  reader.readAsDataURL(blob)
})

/**
 * 把 `data:` / `blob:` URL 读成 Blob。
 *
 * 其余协议（尤其 `http(s):`）**返回 `null`** —— 远端图由调用方走"直通"分支，
 * 不在这里偷偷发网络请求。
 *
 * @param {string} url
 * @returns {Promise<Blob|null>}
 */
export const readLocalImageBlob = async (url) => {
  const value = String(url || '')
  try {
    if (value.startsWith('data:')) {
      const response = await fetch(value)
      return await response.blob()
    }
    if (value.startsWith('blob:')) {
      const response = await fetch(value)
      return await response.blob()
    }
  } catch {
    return null
  }
  return null
}

/**
 * 等比缩到 `maxEdge` 以内，编码成 webp。
 *
 * 必须先解码才能拿到源尺寸，所以是「全尺寸解码 → 缩放绘制」——这是整个流程里
 * 最大的一处内存开销（一张 4000×6000 的素材解码后接近 100MB），调用方务必
 * 用串行或限流队列压住并发。
 *
 * 不放大（`Math.min(1, ...)`）：小图缩略图放大只会糊。
 *
 * @param {Blob|ImageBitmap} source
 * @returns {Promise<Blob|null>} 失败返回 null
 */
export const downscaleToWebpBlob = async (source, {
  maxEdge = DEFAULT_THUMB_MAX_EDGE,
  quality = DEFAULT_THUMB_QUALITY,
  background = DEFAULT_THUMB_BACKGROUND
} = {}) => {
  let bitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch {
    // 损坏文件 / 浏览器不认的格式 / 视频容器：可预期的失败，不抛
    return null
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = longest > 0 ? Math.min(1, maxEdge / longest) : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    context.fillStyle = background
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)

    return await canvas.convertToBlob({ type: 'image/webp', quality })
  } catch {
    return null
  } finally {
    // 失败路径也要释放，比"只在成功时 close"更严
    bitmap?.close?.()
  }
}

/**
 * 一步到位：URL → 小图 data URL。
 *
 * @param {string} url 只接受 `data:` / `blob:`，其余返回 null
 * @returns {Promise<{dataUrl:string,width:number,height:number,bytes:number}|null>}
 */
export const makeThumbDataUrl = async (url, options = {}) => {
  const blob = await readLocalImageBlob(url)
  if (!blob) return null

  const thumb = await downscaleToWebpBlob(blob, options)
  if (!thumb) return null

  try {
    const dataUrl = await blobToDataUrl(thumb)
    return {
      dataUrl,
      // data URL 的字节长度（含 `data:image/webp;base64,` 前缀），
      // 与 save_canvas_media 的 300MB 校验口径一致
      bytes: dataUrl.length,
      blob: thumb
    }
  } catch {
    return null
  }
}
