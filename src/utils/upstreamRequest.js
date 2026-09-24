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
import { normalizeRatioKey } from './ratio'
import { GEMINI_NATIVE_PATH } from '@/config/providerCapabilities'

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
    let response
    try {
      response = await fetch(text)
    } catch (error) {
      // fetch **抛错**（而不是返回非 2xx）在这条路上只有两种可能：
      // ① CSP 的 connect-src 拦了 blob:；② 这个地址已经被 revoke。
      // 浏览器只给一句 "Failed to fetch"，看不出是哪种、也看不出是参考图的问题，
      // 所以这里必须自己补上上下文。
      //
      // 注意 `img-src` 与 `connect-src` 是两条独立的指令：<img src="blob:...">
      // 能显示、不代表 fetch 拿得到。调用方<探活>用的是 <img>，所以探活通过
      // 而这里失败是可能的组合，别把两者当成同一件事。
      const detail = error?.message || String(error)
      throw new Error(`参考图读取失败：blob 地址取不到字节（CSP 拦截或链接已失效）— ${detail}`)
    }
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
 * 尺寸参数 → 各家读得懂的那几种写法 | Size params in every dialect
 *
 * **背景：这一层没有统一标准。** 中转站要把 OpenAI 兼容格式翻成 Gemini 原生格式
 * （`generationConfig.imageConfig`），而这层翻译各家写法不同、还都是抄来抄去：
 *
 * | 写法 | 长什么样 | 谁认 |
 * |---|---|---|
 * | 嵌套 | `image_config: { aspect_ratio, image_size }` | 火宝等 |
 * | 扁平 | `aspect_ratio` / `image_size` 直接放顶层 | LiteLLM 系（为兼容保留） |
 * | 生图端点那套 | `size`（比例）+ `quality`（1k/2k/4k） | OpenAI 兼容生图层 |
 * | 分辨率 | `resolution: "4K"` | reAPI 等 |
 *
 * 我们的处境是**没法在运行时判断对面认哪种**。所以一次全发：每家只读自己认识的
 * 那个，多出来的字段一律忽略。
 *
 * 这不是预防性设计，是踩出来的 —— linkapi 对 `image_config` 完全无视，我们被
 * `prefersChatProtocolForImage` 强制走 chat 协议、又只发了这一个字段，于是选了
 * 4K 静默降级成 1K（896x1200）。而别人的画布接同一个站能选尺寸，说明它读的是
 * 另外那几种写法。
 *
 * 三条硬约束（都踩过）：
 * 1. **比例必须是 `3:4` 冒号写法**。`3x4` 解析不出比例，会被归一到 1:1 ——
 *    而本项目的 banana 尺寸表存的偏偏就是 `3x4` 这种键
 * 2. **K 必须大写**（`4K`），小写会被拒
 * 3. **不能只给像素尺寸**：Gemini 不支持任意像素，只有「比例 + 档位」两个自由度。
 *    给 `3584x4800` 和给「3:4 + 4K」是同一件事，但后者处处认
 */

/** 清晰度档位 → `quality` 该写的值。数字档位不含糊，且 2K 在 OpenAI 原生的
 *  quality 里没有对应值（只有 standard/hd），拿 hd 去表达 2K 更容易撞上
 *  「hd = 最高档」的实现。 */
const QUALITY_BY_TIER = { '1K': '1k', '2K': '2k', '4K': '4k' }

/** OpenAI 生图端点认的 quality 取值。档位映射出来的 `4k` 不在其中。 */
const STRICT_QUALITY_VALUES = ['low', 'medium', 'high', 'auto', 'standard', 'hd']

/**
 * 这个尺寸值是「比例 key」还是「真实像素」。
 * 比例 key 用的是小整数（banana 尺寸表最大到 16），像素尺寸最小也在千位，
 * 所以 32 这条线能干净地把两者分开。
 */
const isRatioKey = value => {
  const match = String(value || '').trim().match(/^(\d+)[x×:](\d+)$/)
  return !!match && Number(match[1]) <= 32 && Number(match[2]) <= 32
}

/**
 * `size` 字段本身该写什么。
 *
 * 小整数比例（banana 的 `3x4`）→ 冒号写法，否则中转站解析不出比例会掉回 1:1；
 * 真实像素（seedream 的 `2560x1440`、OpenAI 原生的 `1024x1024`）→ 原样保留，
 * 那些端点就是按像素读的，换成比例反而废掉。
 */
export const normalizeSizeForUpstream = value => {
  const text = normalizeStringValue(value)
  if (!text) return ''
  return isRatioKey(text) ? normalizeRatioKey(text, { fallback: text }) : text
}

/**
 * 比例 + 档位 → 各家可能读的平铺字段。
 * 不含 `image_config`（那是嵌套形状，由 chat 协议单独成形）。
 *
 * @param {Object} input
 * @param {string} [input.size]
 * @param {string} [input.resolution]
 * @returns {Object|null} 两者都缺时返回 null
 */
export const buildImageSizeFields = ({ size, resolution } = {}) => {
  const ratio = size ? normalizeRatioKey(size, { fallback: '' }) : ''
  const tier = normalizeStringValue(resolution).toUpperCase()
  if (!ratio && !tier) return null

  const fields = {}
  if (ratio) {
    fields.aspect_ratio = ratio
    // 生图端点那套要的直接就是比例。刻意不传像素：`size: "3584x4800"` 会被
    // 拿去反推比例，推不出标准比例时直接掉回 1:1，比不传还糟
    fields.size = ratio
  }
  if (tier) {
    fields.image_size = tier
    fields.resolution = tier
    fields.quality = QUALITY_BY_TIER[tier] || tier.toLowerCase()
  }
  return fields
}

/**
 * 原生 Gemini 路由的路径：模型名在 URL 里，不在请求体里。
 *
 * @param {string} model
 * @returns {string}
 */
export const buildGeminiNativePath = model => (
  GEMINI_NATIVE_PATH.replace('{model}', encodeURIComponent(normalizeStringValue(model)))
)

/**
 * 原生 Gemini 请求体 | Native generateContent body
 *
 * **这是唯一一条尺寸参数真被认的路**（取证见 config/providerCapabilities 的
 * 「原生 Gemini 协议」一节：同一模型同一提示词，chat 回 1408x768、原生回 3584x4800）。
 *
 * 形状与 OpenAI 兼容完全无关 —— 全部驼峰、层级化：
 *
 *   { contents: [{ role: 'user', parts: [{ text }, { inlineData: {...} }] }],
 *     generationConfig: { imageConfig: { aspectRatio, imageSize } } }
 *
 * 两条硬约束：
 *
 * 1. **参考图必须给 inlineData（裸 base64），原生协议不接受图片 URL。**
 *    所以 http(s) 链接也要先取回字节 —— 不能走 `toTransportableReferenceImage`
 *    那条「外链原样保留」的捷径。
 * 2. **不要顺手把 snake_case 那套也塞进来。** 这条路是有 schema 的，
 *    chat 那条可以乱塞多种写法赌对面认识，这条不行 —— 多出来的键没有「会被忽略」
 *    的保证。档位只有一个正确写法：`generationConfig.imageConfig.imageSize`。
 *
 * @param {Object} input
 * @param {string} input.model
 * @param {string} [input.prompt]
 * @param {string[]} [input.images]
 * @param {string} [input.size]        比例，如 '3:4'
 * @param {string} [input.resolution]  档位，如 '4K'
 * @returns {Promise<Object>}
 */
export const buildGeminiImageRequest = async ({ model, prompt, images, size, resolution } = {}) => {
  const parts = []
  const text = normalizeStringValue(prompt)
  if (text) parts.push({ text })

  for (const imageValue of normalizeReferenceImageList(images)) {
    const { dataBase64, mime } = await readReferenceImageBytes(imageValue)
    if (!dataBase64) throw new Error('参考图内容为空')
    parts.push({ inlineData: { mimeType: mime || 'image/png', data: dataBase64 } })
  }

  // 原生协议的 contents 不能为空，也不接受空 part
  if (!parts.length) throw new Error('原生 Gemini 请求至少需要提示词或参考图')

  const imageConfig = {}
  const ratio = size ? normalizeRatioKey(size, { fallback: '' }) : ''
  const tier = normalizeStringValue(resolution).toUpperCase()
  if (ratio) imageConfig.aspectRatio = ratio
  if (tier) imageConfig.imageSize = tier

  const body = { contents: [{ role: 'user', parts }] }
  if (Object.keys(imageConfig).length) body.generationConfig = { imageConfig }
  return body
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
 * @param {boolean} [input.strict] 该渠道是否评判参数名（true 时只发标准字段）
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

  const sizeFields = buildImageSizeFields({ size, resolution })
  if (size) fields.push({ name: 'size', value: normalizeSizeForUpstream(size) })
  // 档位比调用方给的 quality 更具体（那是画布里的默认风格值），有档位就听档位的。
  // 但评判参数名的渠道只认 OpenAI 那套 quality 取值（low/medium/high/auto/standard/hd），
  // 我们的档位映射出来的 '4k' 不在其中 —— 与其赌它不校验取值，不如不发：
  // 生图端点的尺寸本来就由 `size` 决定，quality 只影响保真度。
  const qualityValue = input.strict
    ? (STRICT_QUALITY_VALUES.includes(String(quality).toLowerCase()) ? quality : '')
    : (sizeFields?.quality || quality)
  if (qualityValue) fields.push({ name: 'quality', value: qualityValue })
  // 剩下的扁平写法（aspect_ratio / image_size / resolution）只在对面不评判参数名时补发。
  // 评判参数的渠道会因为这些多出来的键**整个请求 400**（linkapi 实测），
  // 而尺寸控制本来就靠上面那个标准字段 `size`，不需要它们。
  if (sizeFields && !input.strict) {
    Object.entries(sizeFields).forEach(([name, value]) => {
      if (name === 'size' || name === 'quality') return
      fields.push({ name, value })
    })
  }

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
 *
 * @param {boolean} [strict] 该渠道是否评判参数名 —— true 时只保留标准字段，
 *   不补发 aspect_ratio / image_size / resolution（见上面 multipart 的说明）。
 */
export const normalizeImageGenerationRequestBody = ({ requestBody = {}, modelKey = '', strict = false } = {}) => {
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

  // `size` 里的小整数比例（banana 的 `3x4`）要改写成 `3:4`，真实像素原样保留 ——
  // 这条路上跑的模型比 chat 协议杂，不能一律按比例处理
  if (body.size) body.size = normalizeSizeForUpstream(body.size)
  // 再补一套扁平字段：Gemini 系模型被迫落到生图端点时，档位得有个地方表达。
  // 评判参数名的渠道上必须跳过 —— 多一个未知键就是 400（linkapi 实测）。
  // 注意 `resolution` 还在 `...payload` 里，不能只「不补发」，得主动摘掉。
  if (strict) {
    for (const key of ['aspect_ratio', 'image_size', 'resolution']) delete body[key]
  } else {
    const sizeFields = buildImageSizeFields({ size: body.size, resolution: body.resolution })
    if (sizeFields) {
      if (sizeFields.aspect_ratio && !body.aspect_ratio) body.aspect_ratio = sizeFields.aspect_ratio
      if (sizeFields.image_size && !body.image_size) body.image_size = sizeFields.image_size
      if (sizeFields.resolution) body.resolution = sizeFields.resolution
    }
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
