/**
 * 上游能力端点策略 | Provider endpoint capability strategy
 *
 * 移植自 CanvasMind `src/shared/provider-endpoint-strategy.ts` 的设计：
 * 把「一次生成请求需要哪种能力」与「该能力打到厂商的哪个端点、用什么协议」
 * 收敛到一张注册表里，避免规则散落在多个 if 分支。
 *
 * 与 CanvasMind 的差异：
 *   - 它多一个服务端网关做最终转发，这里由 `services/aiGateway.js` 在本地承担；
 *   - 增加了 `video-query`，因为视频是异步任务，查询是独立能力。
 */

/** @typedef {'chat'|'image'|'image-edit'|'video'|'video-query'} AiEndpointType */
/** @typedef {'CHAT'|'IMAGE'|'VIDEO'} AiModelCategory */
/** @typedef {'json'|'multipart'} UpstreamProtocol */

/**
 * @typedef {Object} ProviderEndpointStrategy
 * @property {AiEndpointType} key
 * @property {AiModelCategory} modelCategory  用于挑选「图片模型 / 视频模型」清单
 * @property {string} endpointField           provider.endpoints 里对应的键名
 * @property {UpstreamProtocol} protocol      默认上行协议
 * @property {'GET'|'POST'} method            默认 HTTP 方法
 * @property {AiEndpointType} chargeable      计费/配额归属（image-edit 算 image）
 */

/** 能力注册表 —— 新增厂商无需改这里，只改渠道配置的 endpoints / protocols。 */
export const PROVIDER_ENDPOINT_STRATEGIES = Object.freeze({
  chat: {
    key: 'chat',
    modelCategory: 'CHAT',
    endpointField: 'chat',
    protocol: 'json',
    method: 'POST',
    chargeable: 'chat'
  },
  image: {
    key: 'image',
    modelCategory: 'IMAGE',
    endpointField: 'image',
    protocol: 'json',
    method: 'POST',
    chargeable: 'image'
  },
  // 图生图/改图：参考图必须作为文件上传，绝大多数 OpenAI 兼容厂商只认 multipart
  'image-edit': {
    key: 'image-edit',
    modelCategory: 'IMAGE',
    endpointField: 'imageEdit',
    protocol: 'multipart',
    method: 'POST',
    chargeable: 'image'
  },
  video: {
    key: 'video',
    modelCategory: 'VIDEO',
    endpointField: 'video',
    protocol: 'json',
    method: 'POST',
    chargeable: 'video'
  },
  'video-query': {
    key: 'video-query',
    modelCategory: 'VIDEO',
    endpointField: 'videoQuery',
    protocol: 'json',
    method: 'GET',
    chargeable: 'video'
  }
})

export const AI_ENDPOINT_TYPES = Object.freeze(Object.keys(PROVIDER_ENDPOINT_STRATEGIES))

/** 各能力的默认端点路径，渠道未显式配置时兜底（OpenAI 兼容约定）。 */
export const DEFAULT_ENDPOINT_PATHS = Object.freeze({
  chat: '/v1/chat/completions',
  image: '/v1/images/generations',
  imageEdit: '/v1/images/edits',
  video: '/v1/videos',
  videoQuery: '/v1/videos/{taskId}'
})

/** @param {unknown} value */
export const isAiEndpointType = value => (
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_ENDPOINT_STRATEGIES, value)
)

/**
 * @param {AiEndpointType} endpointType
 * @returns {ProviderEndpointStrategy}
 */
export const getEndpointStrategy = endpointType => (
  PROVIDER_ENDPOINT_STRATEGIES[endpointType] || PROVIDER_ENDPOINT_STRATEGIES.image
)

/** 该能力对应的模型归类（CHAT / IMAGE / VIDEO）。 */
export const resolveModelCategory = endpointType => getEndpointStrategy(endpointType).modelCategory

/** 该能力落在 provider.endpoints 的哪个键上。 */
export const resolveEndpointField = endpointType => getEndpointStrategy(endpointType).endpointField

/** 该能力默认是否必须走 multipart。 */
export const requiresMultipart = endpointType => getEndpointStrategy(endpointType).protocol === 'multipart'

/**
 * 渠道级覆盖：允许某个渠道把某个能力改成别的协议或方法。
 * 例：某些聚合站的图生图只能走 chat 协议（把参考图塞进 messages），
 * 渠道配置里写 protocols: { 'image-edit': 'chat' } 即可。
 *
 * @param {Object} providerConfig
 * @param {AiEndpointType} endpointType
 * @returns {{strategy: ProviderEndpointStrategy, protocol: string, method: string}}
 */
export const resolveProviderEndpointRule = (providerConfig, endpointType) => {
  const strategy = getEndpointStrategy(endpointType)
  const override = providerConfig?.protocols?.[endpointType]
  // 覆盖值可以是字符串（仅换协议）或对象（同时换协议与方法）
  const protocol = (typeof override === 'string' ? override : override?.protocol) || strategy.protocol
  const method = (typeof override === 'object' && override?.method) || strategy.method
  return { strategy, protocol, method }
}

// ============================================================================
// 出图协议偏好
//
// 现实情况：OpenAI 兼容聚合站的 `/images/generations` 通常只支持 Imagen 一类
// 模型。Gemini / Nano Banana 系图像模型虽然也能出图，但要走 `/chat/completions`
// 的多模态消息（图片在回复内容里返回）。命中这些模型名时默认改走 chat 协议，
// 否则用户会拿到形如「not supported model for image generation, only imagen
// models are supported」的上游报错。
//
// 注意不要命中 `imagen-*`（它恰恰是给 /images/generations 用的），
// 也不要命中 flux / seedream / dall-e / gpt-image 这类正常走图片端点的模型。
// ============================================================================

const CHAT_IMAGE_MODEL_PATTERNS = [
  /gemini[^/]*image/i,
  /nano[-\s_]?banana/i
]

/**
 * 该模型是否应该走 chat 协议出图。
 * @param {string} modelKey
 * @returns {boolean}
 */
export const prefersChatProtocolForImage = modelKey => {
  const key = String(modelKey || '').trim()
  if (!key) return false
  return CHAT_IMAGE_MODEL_PATTERNS.some(pattern => pattern.test(key))
}

/**
 * 上游是否在说「这个端点不支持该模型」。
 *
 * 用于自动改走 chat 协议重试一次：不同聚合站措辞差异很大，这里覆盖常见几种。
 * 刻意不匹配泛化的 5xx，避免把限流/超时也当成协议问题反复重试。
 */
const UNSUPPORTED_MODEL_PATTERNS = [
  /not supported model/i,
  /unsupported model/i,
  /only imagen/i,
  /model .*not (be )?support/i,
  /不支持.{0,6}模型/,
  /模型.{0,6}不支持/
]

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export const isUnsupportedImageModelError = error => {
  const message = String(error?.message || error || '')
  if (!message) return false
  return UNSUPPORTED_MODEL_PATTERNS.some(pattern => pattern.test(message))
}
