/**
 * 上游请求归一化 | Upstream request normalizer
 *
 * 移植自 CanvasMind `src/shared/upstream-request-normalizer.ts`。
 * 职责：把画布内部的请求描述清洗成厂商能直接消费的形态（JSON 体或 multipart）。
 *
 * 与原版的差异：
 *   - 原版用浏览器 `fetch(imageValue).then(r => r.blob())` 读参考图；
 *     桌面端参考图常是上游外链，会被 CORS 拒绝，这里改为优先走 Rust 通道
 *     （`fetch_binary`）拿字节，浏览器环境自动回退到 fetch。
 */

import { toDataUrl } from './resultParser'

const normalizeStringValue = value => String(value ?? '').trim()

const isTauriRuntime = () => (
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
)

/** Tauri invoke 按需加载，Web 环境下不引入该依赖。 */
const invokeTauri = async (command, args) => {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

/** 从 data URL 或文件路径推断 MIME。 */
export const resolveImageMimeType = value => {
  const dataMatch = String(value || '').match(/^data:([^;,]+)[;,]/i)
  if (dataMatch?.[1]) return dataMatch[1]

  const lower = String(value || '').toLowerCase()
  if (lower.includes('.webp')) return 'image/webp'
  if (lower.includes('.gif')) return 'image/gif'
  if (lower.includes('.bmp')) return 'image/bmp'
  if (lower.includes('.svg')) return 'image/svg+xml'
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

/** MIME → 文件扩展名，用于给上游一个像样的文件名。 */
export const resolveImageFileExtension = mimeType => {
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'image/bmp') return 'bmp'
  if (mimeType === 'image/svg+xml') return 'svg'
  if (mimeType === 'image/jpeg') return 'jpg'
  return 'png'
}

/** 把任意参考图输入归一成去空、去重的字符串数组。 */
export const normalizeReferenceImageList = items => {
  const list = Array.isArray(items) ? items : (items ? [items] : [])
  const seen = new Set()
  return list
    .map(item => (typeof item === 'string' ? normalizeStringValue(item) : normalizeStringValue(item?.url)))
    .filter(value => {
      if (!value || seen.has(value)) return false
      seen.add(value)
      return true
    })
}

/**
 * Blob → 裸 base64（不含 data: 前缀）。
 * 用 arrayBuffer + btoa 而不是 FileReader：既避免浏览器专有 API，
 * 也让这段逻辑能在 Node 侧被同一份验证脚本覆盖。
 */
const blobToBase64 = async blob => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // 分块拼接，避免 String.fromCharCode 参数过多导致栈溢出
  const CHUNK_SIZE = 0x2000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE))
  }
  return btoa(binary)
}

/**
 * 读取一张参考图的字节。
 *
 * 按来源分流（这是图生图最容易翻车的地方）：
 *   data:              → 本地解码
 *   blob:              → 只能在当前 webview 内解析，Rust 取不到
 *   http(s) / 本地文件 → 桌面端交给 Rust（顺带绕开 CORS）
 *
 * @param {string} value
 * @returns {Promise<{dataBase64:string, mime:string}>}
 */
export const readReferenceImageBytes = async value => {
  const text = normalizeStringValue(value)
  if (!text) throw new Error('参考图为空')

  // data URL：直接切出 base64，无需任何网络请求
  const dataMatch = text.match(/^data:([^;,]+)(;base64)?,(.*)$/is)
  if (dataMatch) {
    const mime = dataMatch[1] || 'image/png'
    const payload = dataMatch[3] || ''
    if (dataMatch[2]) return { dataBase64: payload, mime }
    // 非 base64 的 data URL（少见）：按 UTF-8 还原后重新编码
    const decoded = decodeURIComponent(payload)
    return { dataBase64: btoa(unescape(encodeURIComponent(decoded))), mime }
  }

  // blob: 是本作用域内的对象地址，任何后端（Rust / 厂商）都取不到，
  // 必须在 webview 里读完再转 base64。
  if (/^blob:/i.test(text)) {
    const response = await fetch(text)
    if (!response.ok) throw new Error(`参考图读取失败 (${response.status})`)
    const blob = await response.blob()
    return {
      dataBase64: await blobToBase64(blob),
      mime: normalizeStringValue(blob.type) || resolveImageMimeType(text)
    }
  }

  // 桌面端统一走 Rust：外链绕开 CORS，本地文件/asset 协议直接读盘
  if (isTauriRuntime()) {
    let result
    try {
      // 显式传超时，避免依赖 Tauri 对缺省 Option 参数的处理
      result = await invokeTauri('fetch_binary', { url: text, timeoutMs: 60_000 })
    } catch (error) {
      throw new Error(
        typeof error === 'string' ? error : (error?.message || '参考图读取失败')
      )
    }
    const contentType = normalizeStringValue(result?.contentType)
    return {
      dataBase64: String(result?.dataBase64 || ''),
      mime: (contentType.startsWith('image/') ? contentType : '') || resolveImageMimeType(text)
    }
  }

  const response = await fetch(text)
  if (!response.ok) throw new Error(`参考图读取失败 (${response.status})`)
  const blob = await response.blob()
  return {
    dataBase64: await blobToBase64(blob),
    mime: normalizeStringValue(blob.type) || resolveImageMimeType(text)
  }
}

/**
 * 把参考图归一成「厂商能自己取到」的形式。
 *
 * - http(s)：原样保留（厂商可直接下载）
 * - data:  ：原样保留（体量小则可用）
 * - 其余（blob: / file: / asset: / 裸磁盘路径）：转成 data URL。
 *   blob: 是本地的，厂商拿到这个字符串毫无意义；本地路径同理。
 *
 * JSON / chat 协议把图片当字符串传给厂商，因此必须先过这一关；
 * multipart 协议不需要（走 readReferenceImageBytes 的字节）。
 *
 * @param {string} value
 * @returns {Promise<string>}
 */
export const toTransportableReferenceImage = async value => {
  const text = normalizeStringValue(value)
  if (!text) return ''
  if (/^https?:\/\//i.test(text) || /^data:/i.test(text)) return text

  const { dataBase64, mime } = await readReferenceImageBytes(text)
  return toDataUrl(dataBase64, mime)
}

/**
 * 组装图生图（image-edit）的 multipart 载荷。
 *
 * @param {Object} input
 * @param {string} input.model
 * @param {string} [input.prompt]
 * @param {string} [input.size]
 * @param {string} [input.quality]
 * @param {string} [input.resolution]
 * @param {number} [input.count]
 * @param {string[]} [input.referenceImages]
 * @param {string} [input.fileNamePrefix]
 * @param {string} [input.imageField] 参考图字段名，默认 'image'
 * @returns {Promise<{fields:Array<{name:string,value:string}>, files:Array<{name:string,fileName:string,mime:string,dataBase64:string}>}>}
 */
export const buildImageEditMultipart = async (input = {}) => {
  const model = normalizeStringValue(input.model)
  const prompt = normalizeStringValue(input.prompt)
  const size = normalizeStringValue(input.size)
  const quality = normalizeStringValue(input.quality)
  const resolution = normalizeStringValue(input.resolution)
  const referenceImages = normalizeReferenceImageList(input.referenceImages)
  const fileNamePrefix = normalizeStringValue(input.fileNamePrefix) || 'reference-image'
  const imageField = normalizeStringValue(input.imageField) || 'image'

  if (!referenceImages.length) throw new Error('图生图至少需要一张参考图')

  const fields = []
  if (model) fields.push({ name: 'model', value: model })
  if (prompt) fields.push({ name: 'prompt', value: prompt })
  const desiredCount = Math.max(1, Math.floor(Number(input.count) > 0 ? Number(input.count) : 1))
  fields.push({ name: 'n', value: String(desiredCount) })
  if (size) fields.push({ name: 'size', value: size })
  if (quality) fields.push({ name: 'quality', value: quality })
  if (resolution) fields.push({ name: 'resolution', value: resolution })

  const files = []
  for (let index = 0; index < referenceImages.length; index += 1) {
    const imageValue = referenceImages[index]
    const { dataBase64, mime } = await readReferenceImageBytes(imageValue)
    if (!dataBase64) throw new Error('参考图内容为空')
    const extension = resolveImageFileExtension(mime)
    files.push({
      name: imageField,
      fileName: `${fileNamePrefix}-${index + 1}.${extension}`,
      mime,
      dataBase64
    })
  }

  return { fields, files }
}

/**
 * 清洗 JSON 模式的请求体：剥离内部字段、统一 count→n、丢弃空值。
 * 对应 CanvasMind `normalizeImageGenerationRequestBody`。
 */
export const normalizeImageGenerationRequestBody = ({ requestBody = {}, modelKey = '' } = {}) => {
  const body = { ...requestBody, model: normalizeStringValue(modelKey || requestBody.model) }

  const rawN = Number(body.n)
  const rawCount = Number(body.count)
  const desiredCount = Number.isFinite(rawN) && rawN > 0
    ? rawN
    : (Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1)
  body.n = Math.max(1, Math.floor(desiredCount))
  delete body.count
  delete body.providerId
  delete body.referenceImages

  // 约定：下划线前缀是画布内部字段，不透传给上游
  for (const key of Object.keys(body)) {
    if (key.startsWith('_')) delete body[key]
  }

  for (const key of ['prompt', 'size', 'quality', 'style', 'image']) {
    if (key === 'image') continue
    const value = normalizeStringValue(body[key])
    if (value) body[key] = value
    else delete body[key]
  }

  const images = normalizeReferenceImageList(body.image)
  if (images.length) body.image = images
  else delete body.image

  // 上游普遍不接受空字符串，统一清理
  Object.keys(body).forEach(key => {
    if (body[key] === undefined || body[key] === null || body[key] === '') delete body[key]
  })

  return body
}
