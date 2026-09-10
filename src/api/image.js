/**
 * Image API | 图片生成 API
 *
 * 上行协议由渠道配置决定（见 config/providerCapabilities.js）：
 *   json      → /images/generations   文生图（无参考图）
 *   multipart → /images/edits         图生图/改图，参考图作为文件上传
 *   chat      → /chat/completions     部分厂商只能走对话协议出图（多模态消息）
 *
 * 所有请求经 services/aiGateway 转发（桌面端走 Rust 通道以绕开 CORS）。
 */

import { requestUpstream } from '@/services/aiGateway'
import {
  resolveProviderEndpointRule,
  prefersChatProtocolForImage,
  isUnsupportedImageModelError
} from '@/config/providerCapabilities'
import {
  buildImageEditMultipart,
  normalizeImageGenerationRequestBody,
  normalizeReferenceImageList,
  toTransportableReferenceImage
} from '@/utils/upstreamRequest'
import { collectImageResults } from '@/utils/resultParser'

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

/** 参考图 → chat 协议的多模态消息 */
const buildChatImageRequest = ({ model, prompt, images }) => {
  const content = []
  if (prompt) content.push({ type: 'text', text: prompt })
  images.forEach(url => content.push({ type: 'image_url', image_url: { url } }))
  return {
    model,
    messages: [{ role: 'user', content: content.length ? content : prompt }]
  }
}

/**
 * 生成图片。
 *
 * @param {Object} payload { model, prompt, size, quality, n|count, image }
 * @param {Object} options
 * @param {Object} options.upstream      渠道上下文（modelStore.resolveUpstreamContext 的返回值）
 * @param {string} [options.capability]  强制指定 image | image-edit
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Array<{url:string, revisedPrompt:string}>>}
 */
export const generateImage = async (payload = {}, options = {}) => {
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

  let protocol = resolveProviderEndpointRule(upstream.providerConfig, effectiveCapability).protocol
  if (!explicitOverride && prefersChatProtocolForImage(modelKey)) {
    // Gemini / Nano Banana 系：聚合站的图片端点普遍不收这些模型，只能走对话协议
    protocol = 'chat'
  }

  /** 按指定协议发起一次请求 */
  const performRequest = async (useProtocol) => {
    if (useProtocol === 'multipart') {
      const multipart = await buildImageEditMultipart({
        model: modelKey,
        prompt,
        size: payload.size,
        quality: payload.quality,
        count: payload.n ?? payload.count,
        referenceImages,
        fileNamePrefix: 'ling-canvas-reference',
        // 少数厂商只认 image[] 字段名，可通过渠道配置覆盖
        imageField: upstream.providerConfig?.imageEditImageField
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
          images: await toTransportableImages(referenceImages)
        }),
        signal,
        timeoutMs
      })
    }

    const requestBody = normalizeImageGenerationRequestBody({
      requestBody: {
        ...payload,
        image: referenceImages.length
          ? await toTransportableImages(referenceImages)
          : undefined
      },
      modelKey
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
    // 自愈：图片端点回「不支持该模型」时改走对话协议重试一次。
    // 渠道显式指定过协议则不擅自改道（用户的显式选择优先）。
    const canRetryViaChat = protocol !== 'chat'
      && !explicitOverride
      && isUnsupportedImageModelError(error)
    if (!canRetryViaChat) throw error
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
