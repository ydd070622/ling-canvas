/**
 * Image API | 图片生成 API
 *
 * 上行协议由渠道配置决定（见 config/providerCapabilities.js）：
 *   json      → /images/generations   文生图（无参考图）
 *   multipart → /images/edits         图生图/改图，参考图作为文件上传
 *   chat      → /chat/completions     部分厂商只能走对话协议出图（多模态消息）
 *   gemini    → /v1beta/models/{model}:generateContent
 *                                     Gemini 原生协议。gemini 系图片模型优先走这条：
 *                                     chat 那条路会把尺寸参数全吞（选 4K 拿 1K），
 *                                     原生这条路认 imageConfig.imageSize。
 *
 * 所有请求经 services/aiGateway 转发（桌面端走 Rust 通道以绕开 CORS）。
 */

import { requestUpstream } from '@/services/aiGateway'
import {
  resolveProviderEndpointRule,
  prefersChatProtocolForImage,
  prefersGeminiNativeImage,
  prefersRatioInPrompt,
  allowsExtraImageParams,
  isUnsupportedImageModelError,
  isGeminiNativeUnavailableError
} from '@/config/providerCapabilities'
import {
  buildGeminiImageRequest,
  buildGeminiNativePath,
  buildImageEditMultipart,
  buildImageSizeFields,
  normalizeImageGenerationRequestBody,
  normalizeReferenceImageList,
  toTransportableReferenceImage
} from '@/utils/upstreamRequest'
import { collectImageResults } from '@/utils/resultParser'
import { normalizeRatioKey, approximateRatio, ratioValue, COMMON_RATIOS } from '@/utils/ratio'

/** 文生图/图生图首包可能等待数分钟（尤其 4K 模型） */
const IMAGE_TIMEOUT_MS = 300_000

/**
 * 参考图 → 厂商能直接取用的字符串形式。
 * blob: / file: / asset: / 裸磁盘路径都必须转成 data URL，
 * 否则把本地地址丢给厂商等于什么都没给。
 */
const toTransportableImages = async images => {
  if (!images.length) return []
  const list = await Promise.all(images.map(toTransportableReferenceImage))
  return list.filter(Boolean)
}

/**
 * 比例 → 一句画面指令。
 * 只在渠道不认 image_config（prefersRatioInPrompt）时使用，见该函数的说明。
 * 像素尺寸先归一到常用比例：'1088x1920' 约分后是 17:30，模型听不懂，
 * 要拍回 9:16 这种它认识的写法。
 */
const buildRatioDirective = (size) => {
  const key = normalizeRatioKey(size, { fallback: '' })
  if (!/^\d+:\d+$/.test(key)) return ''
  const ratio = COMMON_RATIOS.includes(key) ? key : approximateRatio(ratioValue(key))
  const value = ratioValue(ratio)
  const orientation = value === 1 ? '方形' : (value < 1 ? '竖版' : '横版')
  return `画面比例 ${ratio}（${orientation}）`
}

/**
 * 参考图 → chat 协议的多模态消息。
 * 导出是为了让 scripts/probe-relay.mjs 打出的请求体与本函数逐字一致 ——
 * 探测脚本自己手搓一份 body 的话，它证明的只是「我以为客户端发的是这样」。
 */
export const buildChatImageRequest = ({ model, prompt, images, size, resolution, ratioInPrompt }) => {
  const content = []
  // 有些站连参数都吞，比例写进正文是最后一道保险，不覆盖用户写的内容。
  // （清晰度不写：那是推理配置不是画面语义，写进提示词改变不了像素数，写了反而误导）
  const directive = ratioInPrompt ? buildRatioDirective(size) : ''
  const text = [String(prompt || '').trim(), directive].filter(Boolean).join('\n')
  if (text) content.push({ type: 'text', text })
  images.forEach(url => content.push({ type: 'image_url', image_url: { url } }))

  const request = {
    model,
    messages: [{ role: 'user', content: content.length ? content : prompt }]
  }

  const sizeFields = buildImageSizeFields({ size, resolution })
  if (sizeFields) {
    // 嵌套那份单独成形（它是 `{aspect_ratio, image_size}` 这个固定形状），
    // 其余几种是顶层的平铺字段
    request.image_config = {}
    if (sizeFields.aspect_ratio) request.image_config.aspect_ratio = sizeFields.aspect_ratio
    if (sizeFields.image_size) request.image_config.image_size = sizeFields.image_size
    Object.assign(request, sizeFields)
  }
  return request
}

/**
 * 发一次请求，要 1 张图。
 *
 * 张数一律只发 1：上游对 n 的态度太不一致 —— 生图端点认，chat 端点连字段都没有，
 * 模型自己回几张全看心情。所以「要几张」这件事不交给上游，由 generateImage 扇出。
 *
 * @param {Object} payload { model, prompt, size, quality, image }
 * @param {Object} options
 * @param {Object} options.upstream      渠道上下文（modelStore.resolveUpstreamContext 的返回值）
 * @param {string} [options.capability]  强制指定 image | image-edit
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Array<{url:string, revisedPrompt:string}>>}
 */
const requestImagesOnce = async (payload = {}, options = {}) => {
  const { upstream, signal, timeoutMs = IMAGE_TIMEOUT_MS, capability } = options
  if (!upstream?.providerConfig) throw new Error('缺少渠道配置，请先到设置中配置供应商')

  const modelKey = String(payload.model || '').trim()
  if (!modelKey) throw new Error('未选择图片模型')

  const prompt = String(payload.prompt || '').trim()
  const referenceImages = normalizeReferenceImageList(payload.image)
  // 有参考图就走图生图能力；调用方也可显式指定
  const effectiveCapability = capability || (referenceImages.length ? 'image-edit' : 'image')
  // 渠道显式声明过协议就完全听它的，不做任何自动改道
  const explicitOverride = upstream.providerConfig?.protocols?.[effectiveCapability]

  // 生图/改图端点默认只发标准字段 —— 多一个未知键就整个请求 400 才是常态，
  // 想广播多种尺寸写法的渠道要显式开 broadcastImageParams（见 providerCapabilities）
  const strictParams = !allowsExtraImageParams(upstream.providerConfig, upstream.baseUrl)

  let protocol = resolveProviderEndpointRule(upstream.providerConfig, effectiveCapability).protocol
  if (!explicitOverride && prefersGeminiNativeImage(upstream.providerConfig, upstream.baseUrl, modelKey)) {
    // Gemini 系在支持原生路由的渠道上优先走原生 —— 只有这条路认 1K/2K/4K
    protocol = 'gemini'
  } else if (!explicitOverride && prefersChatProtocolForImage(modelKey)) {
    // Gemini / Nano Banana 系：聚合站的图片端点普遍不收这些模型，只能走对话协议
    protocol = 'chat'
  }

  /** 按指定协议发起一次请求 */
  const performRequest = async (useProtocol) => {
    if (useProtocol === 'gemini') {
      return requestUpstream({
        ...upstream,
        // 计费归属图片能力；路径由 requestPath 显式给出（模型名在 URL 里）
        endpointType: 'image',
        requestPath: buildGeminiNativePath(modelKey),
        json: await buildGeminiImageRequest({
          model: modelKey,
          prompt,
          images: referenceImages,
          size: payload.size,
          resolution: payload.resolution
        }),
        signal,
        timeoutMs
      })
    }

    if (useProtocol === 'multipart') {
      const multipart = await buildImageEditMultipart({
        model: modelKey,
        prompt,
        size: payload.size,
        quality: payload.quality,
        resolution: payload.resolution,
        count: 1,
        referenceImages,
        fileNamePrefix: 'ling-canvas-reference',
        // 少数厂商只认 image[] 字段名，可通过渠道配置覆盖
        imageField: upstream.providerConfig?.imageEditImageField,
        strict: strictParams
      })
      return requestUpstream({
        ...upstream,
        endpointType: effectiveCapability,
        fields: multipart.fields,
        files: multipart.files,
        signal,
        timeoutMs
      })
    }

    if (useProtocol === 'chat') {
      return requestUpstream({
        ...upstream,
        endpointType: 'chat',
        json: buildChatImageRequest({
          model: modelKey,
          prompt,
          images: await toTransportableImages(referenceImages),
          size: payload.size,
          resolution: payload.resolution,
          // 渠道连参数都吞时，比例靠提示词再补一道（清晰度补不了，见 buildImageSizeFields）
          ratioInPrompt: prefersRatioInPrompt(upstream.providerConfig, upstream.baseUrl)
        }),
        signal,
        timeoutMs
      })
    }

    const requestBody = normalizeImageGenerationRequestBody({
      requestBody: {
        ...payload,
        n: 1,
        count: 1,
        image: referenceImages.length
          ? await toTransportableImages(referenceImages)
          : undefined
      },
      modelKey,
      strict: strictParams
    })
    return requestUpstream({
      ...upstream,
      endpointType: effectiveCapability,
      json: requestBody,
      signal,
      timeoutMs
    })
  }

  let response
  try {
    response = await performRequest(protocol)
  } catch (error) {
    // 自愈一：原生 Gemini 路由对面不认（404/405，或文案明说不支持）→ 退回 chat。
    // 退回去只是丢掉档位（回到改动前的行为：1K 出图），比整次生成失败好。
    // 鉴权 / 限流 / 上游故障刻意不在这里兜 —— 那些情况下改协议只会掩盖真错误。
    const canRetryGeminiViaChat = protocol === 'gemini'
      && !explicitOverride
      && isGeminiNativeUnavailableError(error)
    // 自愈二：图片端点回「不支持该模型」→ 改走对话协议
    const canRetryImageViaChat = protocol !== 'chat' && protocol !== 'gemini'
      && !explicitOverride
      && isUnsupportedImageModelError(error)
    // 渠道显式指定过协议则不擅自改道（用户的显式选择优先）
    if (!canRetryGeminiViaChat && !canRetryImageViaChat) throw error
    protocol = 'chat'
    response = await performRequest('chat')
  }

  const images = collectImageResults(response.json)
  if (!images.length) {
    const preview = String(response.text || '').slice(0, 200)
    throw new Error(`接口未返回图片地址${preview ? `：${preview}` : ''}`)
  }

  return images
}

/**
 * 生成图片。
 *
 * 要几张由客户端保证：张数 > 1 时并发发同样多次请求（每次都只要 1 张），
 * 再按完成顺序汇报进度、汇总结果。上游的 n 不可信 —— 聚合站的 chat 端点
 * 连 n 字段都没有，实测发 n=4 也只回 2 张，所以这里不指望它。
 *
 * @param {Object} payload { model, prompt, size, quality, n|count, image }
 * @param {Object} options
 * @param {Object} options.upstream      渠道上下文（modelStore.resolveUpstreamContext 的返回值）
 * @param {string} [options.capability]  强制指定 image | image-edit
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @param {(done:number, total:number) => void} [options.onProgress]
 * @param {(errors:Error[]) => void} [options.onPartialFailure] 有成功也有失败时回调，
 *   把失败原因交给调用方 —— 结果保留，但「为什么少了几张」不能没人说
 * @returns {Promise<Array<{url:string, revisedPrompt:string}>>}
 */
export const generateImage = async (payload = {}, options = {}) => {
  const desired = Math.max(1, Math.floor(Number(payload.n ?? payload.count ?? 1) || 1))
  if (desired <= 1) return requestImagesOnce(payload, options)

  const { onProgress } = options
  let done = 0
  onProgress?.(0, desired)

  // 全部同时发，不做并发上限：用户明确要的是「快」，代价是瞬时并发等于张数。
  // finally 而不是 then —— 失败的那次也要算进度，否则界面会永远停在 2/4。
  const settled = await Promise.allSettled(
    Array.from({ length: desired }, () => requestImagesOnce(payload, options)
      .finally(() => { done += 1; onProgress?.(done, desired) }))
  )

  const results = []
  const failures = []
  settled.forEach(item => (item.status === 'fulfilled'
    ? results.push(...item.value)
    : failures.push(item.reason)))

  // 一次请求也可能回多张（chat 协议的模型自己决定张数），多出来的按用户选的数量截断
  const trimmed = results.slice(0, desired)
  if (trimmed.length) {
    // 部分失败：结果照收，但原因绝不能吞 —— 用户看到「少了一张」必须知道为什么，
    // 否则只会以为功能坏了。顺带打到控制台，省得下次还要靠猜。
    if (failures.length) {
      console.warn(`[generateImage] ${failures.length}/${desired} 次请求失败：`, failures)
      options.onPartialFailure?.(failures)
    }
    return trimmed
  }

  // 全失败才算失败。取消要原样抛出去，上层靠 name === 'AbortError' 判断是不是用户取消
  throw failures.find(err => err?.name === 'AbortError') || failures[0] || new Error('图片生成失败')
}
