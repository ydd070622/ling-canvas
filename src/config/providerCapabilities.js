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
/** @typedef {'json'|'multipart'|'chat'|'gemini'} UpstreamProtocol */

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

// ============================================================================
// 出图参数的表达方式（渠道级）
//
// 现实情况：部分聚合站对 Gemini 系图像模型**完全无视** `image_config`。实测
// linkapi.pro（2026-09-17）：aspect_ratio 写 1:1 / 9:16 / 16:9，带不带
// image_size，返回的永远是同一张 1408x768。同一批提示词里写明比例则三组对照
// 全部照做：1:1 → 1024x1024、9:16 → 768x1376、16:9 → 1376x768。
//
// **注意别把这条读成"参数没用"。** 上面那组对照只证明了 `image_config` 这一种
// 写法没用 —— 各家中转站对尺寸参数**没有统一约定**，有的认嵌套的 image_config，
// 有的认扁平字段，有的只认 OpenAI 生图端点那套 size + quality。同一个站对
// `image_config` 无视、却照做同内容的 `size`/`quality`，是完全可能的（用户实测：
// 另一个画布接 linkapi 能正常选尺寸）。
//
// 所以 utils/upstreamRequest.js 的 buildImageSizeFields 一次把所有写法都发出去，
// 三种协议（chat / 生图 json / 图生图 multipart）共用同一份，谁认哪种就用哪种。
// 这里的 `ratioInPrompt` 只是**最后一道保险**：连参数都吞的站，至少让比例能从
// 正文里读出来。清晰度没有这个退路 —— 它是推理配置不是画面语义，写进提示词改变
// 不了像素数，只能靠参数字段送达。
//
// 只作用于 chat 协议 —— 走图片端点的模型（imagen 等）本来就认 size，不该被改写提示词。
//
// 全屏查看器左下角会显示真实像素尺寸，用于判断这条渠道到底给不给 4K。
// ============================================================================

/**
 * 已知「只认提示词、不认 image_config」的渠道，按 Base URL 主机名匹配。
 *
 * 刻意匹配 **实际生效的 Base URL** 而不是渠道 id：内置渠道的 Base URL 是可以
 * 被用户改指向的（本项目里就是内置 openai 渠道被指到了 linkapi.pro），
 * 此时 id 仍叫 openai、providerConfig.defaultBaseUrl 还是火宝，
 * 只有 upstream.baseUrl 才反映真正打的是哪家。
 */
// 两个 LinkAPI 域名共用协议适配，避免切换地址后丢失比例与清晰度配置。
const LINKAPI_HOSTS = ['linkapi.pro', 'linkapi.ai']
const RATIO_IN_PROMPT_HOSTS = LINKAPI_HOSTS

/**
 * 该渠道是否需要把比例写进提示词。
 * 渠道配置里显式写 `ratioInPrompt: true / false` 可覆盖，无需改这里。
 *
 * @param {Object} providerConfig
 * @param {string} [baseUrl] 本次请求实际使用的 Base URL（upstream.baseUrl）
 * @returns {boolean}
 */
export const prefersRatioInPrompt = (providerConfig, baseUrl = '') => {
  if (providerConfig?.ratioInPrompt === true) return true
  if (providerConfig?.ratioInPrompt === false) return false
  const target = String(baseUrl || providerConfig?.defaultBaseUrl || '').toLowerCase()
  if (!target) return false
  return RATIO_IN_PROMPT_HOSTS.some(host => target.includes(host))
}

// ============================================================================
// 生图 / 改图端点的参数广播开关
//
// 实测 linkapi.pro（2026-09-20）：`/v1/images/edits` 对**不认识的参数名直接 400**，
// 而且炸的是整个请求，不是静默丢掉那一个字段：
//
//   {"error":{"message":"Provider API error: Unknown parameter: 'aspect_ratio'.",
//             "type":"invalid_request_error","param":"aspect_ratio",
//             "code":"unknown_parameter"}}
//
// 这直接推翻了「一次把各种写法全发出去，谁认哪种就用哪种」在生图端点上的适用性 ——
// 那条策略只在 **chat** 协议上成立（chat 容忍未知字段，实测同一次塞 6 个也 200）。
// 生图端点是照着 OpenAI 的 schema 校验的，多一个键就是 400。
//
// **所以默认是「不广播」**：走生图/改图端点只发标准字段
// （model / prompt / n / size / quality）。尺寸控制本来就靠 `size` ——
// 实测 linkapi 精确照做 `size:"1024x1536"`，不需要旁门写法。
//
// 为什么默认值是这个方向：OpenAI 兼容**站照着 schema 校验才是常态**，
// 容忍未知字段反而是异类。按「记录哪些站严格」组织，名单会一直长；
// 按「记录哪些站宽松」组织，名单几乎永远是空的。而写错这一侧的代价是不对称的 ——
// 猜宽了整批请求 400（用户看到的是一次都出不来图），猜窄了只是少一种没人用的写法。
//
// 少数真的要广播的站，渠道配置里写 `broadcastImageParams: true`。
// ============================================================================

/**
 * 已知「能容忍未知参数」的渠道，按实际生效的 Base URL 主机名匹配。
 * 默认空列表 —— 没有实测过的站一律按严格处理。
 */
const EXTRA_IMAGE_PARAM_HOSTS = []

/**
 * 该渠道的生图/改图端点是否能收下标准字段之外的写法。
 * 渠道配置里写 `broadcastImageParams: true / false` 可覆盖。
 *
 * @param {Object} providerConfig
 * @param {string} [baseUrl] 本次请求实际使用的 Base URL（upstream.baseUrl）
 * @returns {boolean} false = 只发标准字段（默认）
 */
export const allowsExtraImageParams = (providerConfig, baseUrl = '') => {
  if (providerConfig?.broadcastImageParams === true) return true
  if (providerConfig?.broadcastImageParams === false) return false
  const target = String(baseUrl || providerConfig?.defaultBaseUrl || '').toLowerCase()
  if (!target) return false
  return EXTRA_IMAGE_PARAM_HOSTS.some(host => target.includes(host))
}

// ============================================================================
// 原生 Gemini 协议（唯一一条「尺寸参数真被认」的路）
//
// 实测 linkapi.pro（2026-09-20，gemini-3.1-flash-image，同一句提示词、同一个模型）：
//
//   /v1/chat/completions + 全套尺寸字段（snake 嵌套 / 扁平 / quality / 原生驼峰）
//       → 返回 1408x768，candidatesTokenCount=1120（1K 档价码）
//   /v1beta/models/{model}:generateContent + generationConfig.imageConfig
//       → 返回 **3584x4800**，candidatesTokenCount=2520（4K 档价码）
//
// 区别不在字段写法，在**路由**。OpenAI 兼容那条路是「翻译成 Gemini 格式」的一层，
// 翻译时把尺寸整个丢了；原生路由没有这层，参数直达模型。
//
// 线索取自价格表接口 `/api/pricing` 里每个模型的 `supported_endpoint_types`：
// gemini 系图片模型是 `["gemini","openai"]` —— **第一项就是原生协议**。
// gpt-image 系是 `["image-generation","openai","Generate image","Edit image"]`，
// 它们本来就走生图端点、`size` 也认，不需要这条路。
//
// 所以只对 gemini 系、并且只在**确认支持原生路由的渠道**上启用（见下）。
// 对面没有这条路时由 api/image.js 退回 chat，行为与改动前完全一致。
// ============================================================================

/** 原生路由的路径模板。`{model}` 由调用方替换。 */
export const GEMINI_NATIVE_PATH = '/v1beta/models/{model}:generateContent'

/**
 * 确认支持原生 Gemini 路由的渠道，按实际生效的 Base URL 主机名匹配。
 * 没实测过的站不猜 —— 猜错只是白跑一次请求，但会在每次生成前多一次无效往返。
 * 其他渠道想用，在渠道配置里写 `geminiNative: true` 即可。
 */
const GEMINI_NATIVE_HOSTS = LINKAPI_HOSTS

/**
 * 这次请求是否该走原生 Gemini 路由。
 *
 * @param {Object} providerConfig
 * @param {string} [baseUrl] 本次请求实际使用的 Base URL（upstream.baseUrl）
 * @param {string} [modelKey]
 * @returns {boolean}
 */
export const prefersGeminiNativeImage = (providerConfig, baseUrl = '', modelKey = '') => {
  const isGeminiImage = prefersChatProtocolForImage(modelKey)
  if (!isGeminiImage) return false
  if (providerConfig?.geminiNative === true) return true
  if (providerConfig?.geminiNative === false) return false
  const target = String(baseUrl || providerConfig?.defaultBaseUrl || '').toLowerCase()
  if (!target) return false
  return GEMINI_NATIVE_HOSTS.some(host => target.includes(host))
}

/**
 * 上游是否在说「这条原生路由我不认」，用于退回 chat 重试。
 *
 * 只认路径级的 404/405，以及文案明确的 400/501。**刻意不认 401/403/429/5xx**：
 * 前者是鉴权、后者是限流或上游故障，那些情况下退回 chat 只会把真正的错误盖掉，
 * 让用户看到一个莫名其妙的第二错误。
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isGeminiNativeUnavailableError = error => {
  const status = Number(error?.status || 0)
  if (status === 404 || status === 405) return true
  if (status !== 400 && status !== 501) return false
  const message = String(error?.message || error || '')
  return /not found|unsupported|not support|invalid|unknown|不支持|无此|不存在/i.test(message)
}

// ============================================================================
// 清晰度档位（1K/2K/4K）是否送得进去
//
// 实测 linkapi.pro（2026-09-20，gemini-3.1-flash-image 走 chat 端点）：
// 把当时已知的**所有**写法一次全发出去，上游照样只回 1K 档 ——
//
//   image_config.image_size（下划线嵌套）  → 吞
//   扁平 image_size / resolution          → 吞
//   quality: "4k"                         → 吞
//   原生驼峰 generationConfig.imageConfig → 吞
//   扁平 / 原生驼峰 aspect_ratio           → 吞（默认出 1408x768）
//   /images/generations 端点              → 直接 500「only imagen models are supported」
//
// 判据是响应里的 `candidatesTokenCount`：始终 1120，正好是 1K 档的价码
// （4K 应是 2520）。也就是**它按 1K 生成、按 1K 计费**，用户选 4K 是白选。
//
// **但这是 chat 这条路的毛病，不是这个站的毛病。** 同上原生路由（上面那一节）
// 返回的就是 3584x4800 —— 换路由即可。所以现在只有「走 chat 且没有原生路由可退」
// 时才锁档位；正常情况下 1K/2K/4K 都是真的。
//
// 只吞「走 chat 出图的 gemini 系」的档位：同站其他模型（gpt-image 等）走生图
// 端点，size 是认的，不该被连坐。渠道也可用 supportsImageSize: true/false 覆盖。
// ============================================================================

/** 已知「走 chat 时收下档位却不透传」的渠道，按实际生效的 Base URL 主机名匹配。 */
const IMAGE_SIZE_DROPPING_HOSTS = LINKAPI_HOSTS

/**
 * 该渠道 + 该模型能否真正指定清晰度档位。
 *
 * @param {Object} providerConfig
 * @param {string} [baseUrl] 本次请求实际使用的 Base URL（upstream.baseUrl）
 * @param {string} [modelKey]
 * @returns {boolean} false = 档位送不进去，调用方应把选项收敛到实际上游会出的那一档
 */
export const supportsImageTier = (providerConfig, baseUrl = '', modelKey = '') => {
  if (providerConfig?.supportsImageSize === true) return true
  if (providerConfig?.supportsImageSize === false) return false
  const target = String(baseUrl || providerConfig?.defaultBaseUrl || '').toLowerCase()
  if (!target) return true
  if (!IMAGE_SIZE_DROPPING_HOSTS.some(host => target.includes(host))) return true
  // 这条主机上「走 chat 的 gemini 系」会吞档位 —— 但它同时支持原生路由，而那条路认档位。
  // 只要这次请求走的是原生路由，2K/4K 就是真拿得到的，不必锁。
  // 只有原生路由被渠道显式关掉（geminiNative: false）时才退回锁档位。
  return prefersGeminiNativeImage(providerConfig, baseUrl, modelKey)
    || !prefersChatProtocolForImage(modelKey)
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

// ============================================================================
// 渠道级覆盖（设置界面「高级配置」里手填）
//
// 上面那四个开关都得有个地方能改。而内置渠道（openai / chatfire）**没有**
// customProviders 条目，设置界面能填的只有 name / baseUrl / apiKey ——
// 也就是说「把内置 openai 指向 linkapi」这种最常见的用法，一个开关都设不了，
// 只能改代码加 host 名单。这里把覆盖收敛成一份白名单 + 一个合并函数，
// 让设置界面、探测脚本、判定逻辑三处对齐同一套键名。
//
// 白名单是刻意的：写错一个键（`gemini_native` 而不是 `geminiNative`）不会报任何错，
// 只会在某次出图时静默按旧行为走 —— 那种 bug 找起来最贵。所以设置界面要拿
// findUnknownOverrideKeys 把多余键挡在保存之前。
// ============================================================================

/** 「高级配置」允许填的键 → 说明。报错时用它给用户列合法值。 */
export const PROVIDER_OVERRIDE_KEYS = Object.freeze({
  geminiNative: '布尔。支持原生 Gemini 路由 /v1beta/models/{model}:generateContent',
  broadcastImageParams: '布尔。生图/改图端点允许发未知参数（默认只发标准字段）',
  ratioInPrompt: '布尔。chat 出图时把画面比例写进提示词正文',
  supportsImageSize: '布尔。清晰度档位 1K/2K/4K 能真正送达上游',
  endpoints: '对象。覆盖各能力端点路径，如 { "image": "/v1/images/generations" }',
  protocols: '对象。覆盖各能力上行协议，如 { "image-edit": "chat" }',
  imageEditImageField: '字符串。图生图的参考图字段名（默认 image，少数站只认 image[]）'
})

/**
 * 覆盖里有没有白名单之外的键。
 * @param {Object} override
 * @returns {string[]} 不认识的键名
 */
export const findUnknownOverrideKeys = override => (
  Object.keys(override || {}).filter(
    key => !Object.prototype.hasOwnProperty.call(PROVIDER_OVERRIDE_KEYS, key)
  )
)

/**
 * 把渠道级覆盖合并到渠道配置上。
 *
 * endpoints / protocols 逐项深合并 —— 它们是「按能力逐项覆盖」的字典，
 * 浅合并会把没提到的那几项整块抹掉：用户只想改 image 端点，结果 chat 端点没了。
 *
 * @param {Object} config    渠道配置（内置 PROVIDERS[x] 或 customProviders[x]）
 * @param {Object} [override] 用户在「高级配置」里填的覆盖
 * @returns {Object}
 */
export const mergeProviderOverride = (config, override) => {
  if (!override || typeof override !== 'object') return config
  if (!config || typeof config !== 'object') return override
  const merged = { ...config, ...override }
  for (const key of ['endpoints', 'protocols']) {
    if (config[key] || override[key]) merged[key] = { ...config[key], ...override[key] }
  }
  return merged
}
