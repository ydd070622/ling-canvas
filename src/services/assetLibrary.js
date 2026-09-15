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
  ASSET_PREVIEW_URL_LIMIT,
  ASSET_THUMB_CONCURRENCY,
  ASSET_THUMB_MAX_EDGE,
  ASSET_THUMB_QUALITY,
  ASSET_THUMB_URL_LIMIT,
  ASSET_THUMB_VERSION
} from '../config/assets'
import { idbClear, idbGet, idbPut } from '../stores/idb'

const THUMB_DB = 'ling-canvas-asset-thumbs'
const THUMB_STORE = 'thumbs'

/**
 * 换根计数器。任何在途的缩略图任务都在入口捕获它，await 之后比对——
 * 不一致就丢弃结果、且不落库。没有这道闸门，换根前发出的请求 resolve 时
 * 会把旧根同名相对路径的 blob 写回刚清空的缓存。
 */
let thumbEpoch = 0

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

/** 配置的原始根目录（未 canonicalize）。扫描失败时错误态要靠它显示失败路径 */
export const getAssetRoot = () => call('get_asset_root', {})

/** 打开原生目录选择器。用户取消时返回 null，调用方不应做任何副作用 */
export const pickAssetRoot = () => call('pick_asset_root', {})

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
  const epoch = thumbEpoch
  let cached = null
  try {
    cached = await idbGet(THUMB_DB, THUMB_STORE, entry.relativePath)
  } catch {
    cached = null
  }
  if (epoch !== thumbEpoch) return null
  if (isSameSource(cached, entry)) {
    return cached.failed ? null : (cached.blob || null)
  }

  const result = await makeThumbBlob(entry.relativePath)
  // 换根了：结果属于旧库，丢弃且不落库
  if (epoch !== thumbEpoch) return null
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
  const epoch = thumbEpoch
  const key = entry.relativePath
  const hit = thumbUrls.get(key)
  if (hit) {
    // 重新插入以刷新 LRU 顺序
    thumbUrls.delete(key)
    thumbUrls.set(key, hit)
    return hit
  }

  const blob = await loadAssetThumb(entry)
  // 换根了：不要把旧 URL 塞进新库的 LRU
  if (!blob || epoch !== thumbEpoch) return ''

  const url = URL.createObjectURL(blob)
  thumbUrls.set(key, url)
  while (thumbUrls.size > ASSET_THUMB_URL_LIMIT) {
    const oldest = thumbUrls.keys().next().value
    URL.revokeObjectURL(thumbUrls.get(oldest))
    thumbUrls.delete(oldest)
  }
  return url
}

/**
 * 预览大图 blob URL 的 LRU。
 *
 * 与上面的缩略图池**分开**：尺寸语义差一个数量级，共用一个池会让几张原图
 * 挤掉几百张缩略图。上限也小得多——预览是显式动作（点一下眼睛看一张），
 * 要覆盖的只是「反复看同一张」。
 *
 * 与 resolveAssetUrl 的契约差别：**URL 的所有权在这个 LRU，不在调用方**。
 * 调用方不要 revokeObjectURL——那会把缓存里的 URL 撤成死链，
 * 下次点同一张只会得到一张碎图。
 */
const previewUrls = new Map()

export const acquirePreviewUrl = async (relativePath) => {
  const epoch = thumbEpoch
  const key = relativePath
  const hit = previewUrls.get(key)
  if (hit) {
    // 重新插入以刷新 LRU 顺序
    previewUrls.delete(key)
    previewUrls.set(key, hit)
    return hit
  }

  const url = await resolveAssetUrl(key)
  // 换根了：这张属于旧库，撤掉且不缓存
  if (epoch !== thumbEpoch) {
    URL.revokeObjectURL(url)
    return ''
  }

  previewUrls.set(key, url)
  while (previewUrls.size > ASSET_PREVIEW_URL_LIMIT) {
    const oldest = previewUrls.keys().next().value
    URL.revokeObjectURL(previewUrls.get(oldest))
    previewUrls.delete(oldest)
  }
  return url
}

/**
 * 换根时调用：作废全部在途任务、撤掉所有 objectURL、清空 IDB 缩略图库。
 *
 * 顺序要紧：先递增 epoch，让在途任务的结果全部作废，再清 LRU 与 IDB。
 */
export const resetAssetThumbCache = async () => {
  thumbEpoch += 1
  for (const url of thumbUrls.values()) URL.revokeObjectURL(url)
  thumbUrls.clear()
  for (const url of previewUrls.values()) URL.revokeObjectURL(url)
  previewUrls.clear()
  try {
    await idbClear(THUMB_DB, THUMB_STORE)
  } catch {
    // 清缓存失败不该阻断换根；epoch 已经递增，旧图不会再被采用
  }
}

export { ASSET_THUMB_CONCURRENCY }
