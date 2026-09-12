/**
 * 素材库服务 | Asset library service
 *
 * 前端与本地素材库之间**唯一的 Tauri 缝**：三个命令的包装、缩略图生成与缓存、
 * 以及「相对路径 → 可渲染 URL」的解析，全部收在这里。
 *
 * 引用式的关键约定：素材字节只在内存里过一遍，**绝不写进 localStorage 或
 * IndexedDB**。落盘的只有 `relativePath` 这一个字符串。将来若改用 Tauri 的
 * asset 协议（convertFileSrc），只需要改 resolveAssetUrl 一处。
 */
import {
  ASSET_THUMB_CONCURRENCY,
  ASSET_THUMB_MAX_EDGE,
  ASSET_THUMB_QUALITY,
  ASSET_THUMB_URL_LIMIT,
  ASSET_THUMB_VERSION
} from '../config/assets'
import { idbGet, idbPut } from '../stores/idb'

const THUMB_DB = 'ling-canvas-asset-thumbs'
const THUMB_STORE = 'thumbs'

export const isTauriRuntime = () => (
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
)

/** Tauri invoke 按需加载，Web 环境下不引入该依赖。 */
const invokeTauri = async (command, args) => {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

const call = async (command, args) => {
  if (!isTauriRuntime()) {
    throw new Error('素材库需要在桌面端运行')
  }
  try {
    return await invokeTauri(command, args)
  } catch (error) {
    // Rust 侧的错误是字符串（Result<T, String>），统一收敛成 Error
    throw new Error(typeof error === 'string' ? error : (error?.message || '素材库调用失败'))
  }
}

/** 扫描素材库，返回全部图片的元数据（不含字节） */
export const listAssetLibrary = () => call('list_asset_library', {})

/** 批量检查素材是否还在，用于画布加载时一次性判定几十个引用 */
export const statAssetFiles = relativePaths => call('stat_asset_files', { relativePaths })

/** 读取单个素材的字节 */
export const readAssetFile = relativePath => call('read_asset_file', { relativePath })

export const base64ToBlob = (dataBase64, contentType) => {
  const binary = atob(String(dataBase64 || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: contentType || 'application/octet-stream' })
}

/**
 * 相对路径 → 浏览器可直接显示的 URL。
 * 每次调用新建 objectURL，调用方负责决定生命周期（画布节点长期持有，缩略图走 LRU）。
 */
export const resolveAssetUrl = async (relativePath) => {
  const payload = await readAssetFile(relativePath)
  return URL.createObjectURL(base64ToBlob(payload.dataBase64, payload.contentType))
}

/** 并发闸门：把一批任务压到 concurrency 个并行 */
export const runLimited = async (items, concurrency, worker) => {
  const queue = [...items]
  const size = Math.max(1, Math.min(concurrency, queue.length))
  const runners = Array.from({ length: size }, async () => {
    while (queue.length) {
      const item = queue.shift()
      await worker(item)
    }
  })
  await Promise.all(runners)
}

/**
 * 生成缩略图。必须先解码才能拿到源尺寸，所以是「全尺寸解码 → 缩放绘制」——
 * 这是整个素材库最大的一处内存开销，调用方务必用 runLimited 压住并发。
 */
const makeThumbBlob = async (relativePath) => {
  const payload = await readAssetFile(relativePath)
  let bitmap
  try {
    bitmap = await createImageBitmap(base64ToBlob(payload.dataBase64, payload.contentType))
  } catch {
    // 损坏文件 / 浏览器不认的格式（例如某些 svg）：记下失败，不要反复重试
    return { failed: true }
  }

  const scale = Math.min(1, ASSET_THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  // webp 带 alpha 时避免黑底
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  return { blob: await canvas.convertToBlob({ type: 'image/webp', quality: ASSET_THUMB_QUALITY }) }
}

const isSameSource = (cached, entry) => (
  cached?.version === ASSET_THUMB_VERSION
  && cached?.sourceMtimeMs === entry.modifiedMs
  && cached?.sourceByteLength === entry.byteLength
)

/**
 * 取缩略图 Blob。
 *
 * 命中条件是「版本 + 修改时间 + 文件大小」三者一致——只看路径的话，源文件被
 * 替换后会一直显示旧图。已知解不开的文件也会被缓存（failed 标记），避免反复重试。
 */
export const loadAssetThumb = async (entry) => {
  let cached = null
  try {
    cached = await idbGet(THUMB_DB, THUMB_STORE, entry.relativePath)
  } catch {
    cached = null
  }
  if (isSameSource(cached, entry)) {
    return cached.failed ? null : (cached.blob || null)
  }

  const result = await makeThumbBlob(entry.relativePath)
  try {
    await idbPut(THUMB_DB, THUMB_STORE, entry.relativePath, {
      blob: result.blob || null,
      failed: !!result.failed,
      version: ASSET_THUMB_VERSION,
      sourceMtimeMs: entry.modifiedMs,
      sourceByteLength: entry.byteLength
    })
  } catch {
    // 缓存写失败不该影响本次渲染
  }
  return result.blob || null
}

/**
 * 缩略图 blob URL 的 LRU。
 *
 * 这是项目里第一处 revokeObjectURL —— 全项目其他位置都是只建不撤，
 * 但缩略图是可重建的缓存且数量级差得远（几百张），必须回收。
 * 上限 300 对首屏几十个可见瓦片留了足够余量，不会撤到正在显示的 URL。
 */
const thumbUrls = new Map()

export const acquireThumbUrl = async (entry) => {
  const key = entry.relativePath
  const hit = thumbUrls.get(key)
  if (hit) {
    // 重新插入以刷新 LRU 顺序
    thumbUrls.delete(key)
    thumbUrls.set(key, hit)
    return hit
  }

  const blob = await loadAssetThumb(entry)
  if (!blob) return ''

  const url = URL.createObjectURL(blob)
  thumbUrls.set(key, url)
  while (thumbUrls.size > ASSET_THUMB_URL_LIMIT) {
    const oldest = thumbUrls.keys().next().value
    URL.revokeObjectURL(thumbUrls.get(oldest))
    thumbUrls.delete(oldest)
  }
  return url
}

export { ASSET_THUMB_CONCURRENCY }
