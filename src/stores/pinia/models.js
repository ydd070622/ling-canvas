/**
 * Pinia Store: Model Config | 模型配置 Store
 * 管理模型配置、渠道切换和模型选择
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  CHAT_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL
} from '@/config/models'
import { PROVIDERS, getProviderList, getDefaultProvider, getProviderConfig, getDefaultBaseUrl } from '@/config/providers'
import { mergeProviderOverride } from '@/config/providerCapabilities'

// 存储键名
const STORAGE_KEYS = {
  PROVIDER: 'api-provider',
  CUSTOM_CHAT_MODELS: 'custom-chat-models',
  CUSTOM_IMAGE_MODELS: 'custom-image-models',
  CUSTOM_VIDEO_MODELS: 'custom-video-models',
  SELECTED_CHAT_MODEL: 'selected-chat-model',
  SELECTED_IMAGE_MODEL: 'selected-image-model',
  SELECTED_VIDEO_MODEL: 'selected-video-model',
  CUSTOM_CHAT_MODELS_BY_PROVIDER: 'custom-chat-models-by-provider',
  CUSTOM_IMAGE_MODELS_BY_PROVIDER: 'custom-image-models-by-provider',
  CUSTOM_VIDEO_MODELS_BY_PROVIDER: 'custom-video-models-by-provider',
  API_KEYS_BY_PROVIDER: 'api-keys-by-provider',
  BASE_URLS_BY_PROVIDER: 'base-urls-by-provider',
  CUSTOM_PROVIDERS: 'custom-api-providers',
  PROVIDER_ALIASES: 'api-provider-aliases',
  PROVIDER_ORDER: 'api-provider-order',
  HIDDEN_PROVIDERS: 'api-hidden-providers',
  PROVIDER_OVERRIDES: 'api-provider-overrides'
}

/**
 * Get stored value from localStorage
 */
const getStored = (key, defaultValue = '') => {
  try {
    return localStorage.getItem(key) || defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Set stored value to localStorage
 */
const setStored = (key, value) => {
  try {
    if (value) {
      localStorage.setItem(key, value)
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}

/**
 * Remove stored value from localStorage
 */
const removeStored = (key) => {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/**
 * Get stored JSON value from localStorage
 */
const getStoredJson = (key, defaultValue = []) => {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Set stored JSON value to localStorage
 */
const setStoredJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

/**
 * 检查模型是否支持指定渠�?
 */
const isModelSupported = (model, provider) => {
  if (!model.provider) {
    return true
  }
  return model.provider.includes(provider)
}

export const useModelStore = defineStore('model', () => {
  // ============ Provider 状�?| Provider State ============

  const customProviders = ref(getStoredJson(STORAGE_KEYS.CUSTOM_PROVIDERS, {}))
  const providerAliases = ref(getStoredJson(STORAGE_KEYS.PROVIDER_ALIASES, {}))
  const providerOrder = ref(getStoredJson(STORAGE_KEYS.PROVIDER_ORDER, []))
  const hiddenProviders = ref(getStoredJson(STORAGE_KEYS.HIDDEN_PROVIDERS, []))
  // 渠道级能力覆盖（设置界面「高级配置」）。**单独存一份而不是写进渠道对象** ——
  // 内置渠道（openai / chatfire）不在 customProviders 里，没有对象可写。
  const providerOverrides = ref(getStoredJson(STORAGE_KEYS.PROVIDER_OVERRIDES, {}))

  // 当前选中的渠�?
  const currentProvider = ref(getStored(STORAGE_KEYS.PROVIDER) || getDefaultProvider())

  // 渠道列表
  const providerList = computed(() => {
    const hidden = new Set(hiddenProviders.value)
    const providers = [
      ...getProviderList()
        .filter(provider => !hidden.has(provider.key))
        .map(provider => ({
        ...provider,
        label: providerAliases.value[provider.key] || provider.label
      })),
      ...Object.entries(customProviders.value).map(([key, provider]) => ({
        key,
        label: providerAliases.value[key] || provider.label || key,
        isCustom: true
      }))
    ]
    const order = new Map(providerOrder.value.map((key, index) => [key, index]))
    return providers.sort((a, b) => {
      const aOrder = order.has(a.key) ? order.get(a.key) : Number.MAX_SAFE_INTEGER
      const bOrder = order.has(b.key) ? order.get(b.key) : Number.MAX_SAFE_INTEGER
      return aOrder - bOrder
    })
  })

  // 当前渠道配置（渠道对象 + 用户手填的能力覆盖）
  const providerConfig = computed(() => mergeProviderOverride(
    customProviders.value[currentProvider.value] || getProviderConfig(currentProvider.value),
    providerOverrides.value[currentProvider.value]
  ))

  // 当前渠道标签
  const providerLabel = computed(() => providerList.value.find(provider => provider.key === currentProvider.value)?.label || providerConfig.value.label || currentProvider.value)

  // 设置当前渠道
  const setProvider = (provider) => {
    if (PROVIDERS[provider] || customProviders.value[provider]) {
      currentProvider.value = provider
      setStored(STORAGE_KEYS.PROVIDER, provider)
    }
  }

  const addCustomProvider = (label) => {
    const name = String(label || '').trim()
    if (!name) return null
    const baseKey = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || 'provider'
    let key = `custom-${baseKey}`
    let index = 2
    while (PROVIDERS[key] || customProviders.value[key]) key = `custom-${baseKey}-${index++}`
    customProviders.value[key] = {
      label: name,
      defaultBaseUrl: '',
      endpoints: {
        chat: '/v1/chat/completions',
        image: '/v1/images/generations',
        imageEdit: '/v1/images/edits',
        video: '/v1/videos',
        videoQuery: '/v1/videos/{taskId}'
      }
    }
    return key
  }

  const updateCustomProvider = (key, data = {}) => {
    if (!customProviders.value[key]) return false
    customProviders.value[key] = { ...customProviders.value[key], ...data }
    return true
  }

  const updateProviderLabel = (key, label) => {
    const name = String(label || '').trim()
    if (!key || !name) return false
    providerAliases.value[key] = name
    if (customProviders.value[key]) {
      customProviders.value[key] = { ...customProviders.value[key], label: name }
    }
    return true
  }

  const reorderProviders = (sourceKey, targetKey) => {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return false
    const keys = providerList.value.map(provider => provider.key)
    const sourceIndex = keys.indexOf(sourceKey)
    const targetIndex = keys.indexOf(targetKey)
    if (sourceIndex < 0 || targetIndex < 0) return false
    const [moved] = keys.splice(sourceIndex, 1)
    keys.splice(targetIndex, 0, moved)
    providerOrder.value = keys
    return true
  }

  const removeCustomProvider = (key) => {
    if (!customProviders.value[key]) return false
    delete customProviders.value[key]
    delete apiKeysByProvider.value[key]
    delete baseUrlsByProvider.value[key]
    delete providerOverrides.value[key]
    if (currentProvider.value === key) setProvider(getDefaultProvider())
    return true
  }

  // 统一删除供应商（支持内置和自定义）
  const removeProvider = (key) => {
    // 清除 API 配置
    delete apiKeysByProvider.value[key]
    delete baseUrlsByProvider.value[key]
    delete providerOverrides.value[key]
    if (customProviders.value[key]) {
      // 自定义供应商：直接删除
      delete customProviders.value[key]
    } else {
      // 内置供应商：加入隐藏列表
      if (!hiddenProviders.value.includes(key)) {
        hiddenProviders.value.push(key)
      }
    }
    if (currentProvider.value === key) setProvider(getDefaultProvider())
  }

  // 清除渠道配置
  const clearProvider = () => {
    currentProvider.value = getDefaultProvider()
    removeStored(STORAGE_KEYS.PROVIDER)
  }

  // 适配请求参数
  const adaptRequest = (type, params) => {
    const config = providerConfig.value
    if (config.requestAdapter && config.requestAdapter[type]) {
      return config.requestAdapter[type](params)
    }
    return params
  }

  // 适配响应数据
  const adaptResponse = (type, response) => {
    const config = providerConfig.value
    if (config.responseAdapter && config.responseAdapter[type]) {
      return config.responseAdapter[type](response)
    }
    return response
  }

  // ============ Custom Models 状�?| Custom Models State ============

  // 全局自定义模型（不区分渠道）
  const customChatModels = ref(getStoredJson(STORAGE_KEYS.CUSTOM_CHAT_MODELS, []))
  const customImageModels = ref(getStoredJson(STORAGE_KEYS.CUSTOM_IMAGE_MODELS, []))
  const customVideoModels = ref(getStoredJson(STORAGE_KEYS.CUSTOM_VIDEO_MODELS, []))

  // 按渠道存储的自定义模�?| 结构: { 'openai': [{key, label}], 'chatfire': [{key, label}] }
  const customChatModelsByProvider = ref(getStoredJson(STORAGE_KEYS.CUSTOM_CHAT_MODELS_BY_PROVIDER, {}))
  const customImageModelsByProvider = ref(getStoredJson(STORAGE_KEYS.CUSTOM_IMAGE_MODELS_BY_PROVIDER, {}))
  const customVideoModelsByProvider = ref(getStoredJson(STORAGE_KEYS.CUSTOM_VIDEO_MODELS_BY_PROVIDER, {}))

  // 选中的模�?
  const selectedChatModel = ref(getStored(STORAGE_KEYS.SELECTED_CHAT_MODEL, DEFAULT_CHAT_MODEL))
  const selectedImageModel = ref(getStored(STORAGE_KEYS.SELECTED_IMAGE_MODEL, DEFAULT_IMAGE_MODEL))
  const selectedVideoModel = ref(getStored(STORAGE_KEYS.SELECTED_VIDEO_MODEL, DEFAULT_VIDEO_MODEL))

  // 按渠道存储的 API 配置
  const apiKeysByProvider = ref(getStoredJson(STORAGE_KEYS.API_KEYS_BY_PROVIDER, {}))
  const baseUrlsByProvider = ref(getStoredJson(STORAGE_KEYS.BASE_URLS_BY_PROVIDER, {}))

  // 当前渠道�?API Key �?Base URL
  const currentApiKey = computed(() => apiKeysByProvider.value[currentProvider.value] || '')
  const currentBaseUrl = computed(() => baseUrlsByProvider.value[currentProvider.value] || providerConfig.value.defaultBaseUrl || getDefaultBaseUrl(currentProvider.value))

  // 设置指定渠道�?API Key
  const setApiKeyByProvider = (provider, apiKey) => {
    apiKeysByProvider.value[provider] = apiKey
  }

  // 设置指定渠道�?Base URL
  const setBaseUrlByProvider = (provider, baseUrl) => {
    baseUrlsByProvider.value[provider] = baseUrl
  }

  // 清除指定渠道�?API 配置
  const clearApiConfigByProvider = (provider) => {
    delete apiKeysByProvider.value[provider]
    delete baseUrlsByProvider.value[provider]
  }

  // ============ 按渠道 ID 解析（不依赖「当前渠道」全局态） ============
  //
  // 画布上不同节点可能选了不同渠道的模型，因此生成请求必须按帧自带
  // providerId；下面这组 helper 是节点 → 本地网关(services/aiGateway) 的桥梁。

  /**
   * 按渠道 ID 取配置。
   * 未知 ID 返回 null —— 不回退到默认渠道，否则会把请求错发到别的厂商
   * （并带上不属于该厂商的 Key），错误信息也会完全指错方向。
   */
  const getProviderConfigById = (providerId) => {
    if (!providerId) return null
    const base = customProviders.value[providerId] || PROVIDERS[providerId]
    if (!base) return null
    return mergeProviderOverride(base, providerOverrides.value[providerId])
  }

  /**
   * 写入渠道级能力覆盖（设置界面「高级配置」）。
   * 传空对象等于清掉这个渠道的覆盖，让它回到内置默认行为。
   */
  const setProviderOverrides = (providerId, override = {}) => {
    if (!providerId) return false
    const next = { ...providerOverrides.value }
    if (Object.keys(override).length) next[providerId] = override
    else delete next[providerId]
    providerOverrides.value = next
    return true
  }

  const getApiKeyByProvider = (providerId) => apiKeysByProvider.value[providerId] || ''

  const getBaseUrlByProvider = (providerId) => (
    baseUrlsByProvider.value[providerId]
    || customProviders.value[providerId]?.defaultBaseUrl
    || PROVIDERS[providerId]?.defaultBaseUrl
    || ''
  )

  /**
   * 一次性拿到发起一次上游请求所需的渠道上下文。
   * @param {string} [providerId] 缺省回退到当前渠道
   */
  const resolveUpstreamContext = (providerId) => {
    const id = providerId || currentProvider.value
    const config = getProviderConfigById(id)
    return {
      providerId: id,
      providerConfig: config,
      apiKey: getApiKeyByProvider(id),
      baseUrl: getBaseUrlByProvider(id) || config?.defaultBaseUrl || '',
      providerLabel: providerAliases.value[id] || config?.label || id
    }
  }

  // ============ Computed: All Models (built-in + custom + by provider) ============

  // Provider-specific entries also hold the user's display-name overrides.
  // Preserve built-in metadata while allowing the provider entry to win.
  const mergeModelsByKey = models => {
    const merged = new Map()
    models.forEach(model => {
      merged.set(model.key, { ...(merged.get(model.key) || {}), ...model })
    })
    return [...merged.values()]
  }

  // 空元数据（启用内置模型时存储的条目只有 key/label）不覆盖内置定义
  // | Empty metadata must not shadow built-in sizes/defaultParams
  const stripEmptyMeta = (m) => {
    const out = { ...m }
    if (Array.isArray(out.sizes) && out.sizes.length === 0) delete out.sizes
    if (Array.isArray(out.ratios) && out.ratios.length === 0) delete out.ratios
    if (Array.isArray(out.durs) && out.durs.length === 0) delete out.durs
    if (!out.defaultParams || Object.keys(out.defaultParams).length === 0) delete out.defaultParams
    if (Array.isArray(out.resolutions) && out.resolutions.length === 0) delete out.resolutions
    return out
  }

  const allChatModels = computed(() => mergeModelsByKey([
    ...CHAT_MODELS.map(m => ({ ...m, isCustom: false })),
    ...customChatModels.value.map(m => ({
      label: m.label || m.key,
      key: m.key,
      isCustom: true
    })),
    // 添加当前渠道的自定义模型
    ...(customChatModelsByProvider.value[currentProvider.value] || []).map(m => ({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      provider: [currentProvider.value]
    }))
  ]))

  const allImageModels = computed(() => mergeModelsByKey([
    ...IMAGE_MODELS.map(m => ({ ...m, isCustom: false })),
    ...customImageModels.value.map(m => stripEmptyMeta({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      sizes: [],
      defaultParams: { quality: 'standard', style: 'vivid' }
    })),
    // 添加当前渠道的自定义模型
    ...(customImageModelsByProvider.value[currentProvider.value] || []).map(m => stripEmptyMeta({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      sizes: [],
      defaultParams: { quality: 'standard', style: 'vivid' },
      provider: [currentProvider.value]
    }))
  ]))

  const allVideoModels = computed(() => mergeModelsByKey([
    ...VIDEO_MODELS.map(m => ({ ...m, isCustom: false })),
    ...customVideoModels.value.map(m => stripEmptyMeta({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      ratios: [],
      durs: [],
      defaultParams: { ratio: '16:9', duration: 5 }
    })),
    // 添加当前渠道的自定义模型
    ...(customVideoModelsByProvider.value[currentProvider.value] || []).map(m => stripEmptyMeta({
      label: m.label || m.key,
      key: m.key,
      isCustom: true,
      ratios: [],
      durs: [],
      defaultParams: { ratio: '16:9', duration: 5 },
      provider: [currentProvider.value]
    }))
  ]))

  // ============ Computed: Available Models (filtered by provider) ============

  // Only switched-on models are exposed to selectors. Models are collected
  // across providers; the current provider wins if the same model ID exists in
  // more than one provider.
  const buildEnabledModels = (modelsByProvider, builtIns, globalCustom = [], defaults = {}) => {
    const baseModels = new Map([
      ...builtIns.map(model => [model.key, model]),
      ...globalCustom.map(model => [model.key, model])
    ])
    const providers = Object.keys(modelsByProvider || {}).sort((a, b) =>
      Number(b === currentProvider.value) - Number(a === currentProvider.value)
    )
    const enabled = new Map()
    providers.forEach(provider => {
      ;(modelsByProvider[provider] || []).forEach(model => {
        if (enabled.has(model.key)) return
        enabled.set(model.key, {
          ...defaults,
          ...(baseModels.get(model.key) || {}),
          key: model.key,
          label: model.label || model.key,
          isCustom: true,
          provider: [provider],
          sourceProvider: provider
        })
      })
    })
    return [...enabled.values()]
  }

  // 已配置 Key 的渠道集合
  const providersWithKey = computed(() => new Set(
    Object.entries(apiKeysByProvider.value)
      .filter(([, key]) => String(key || '').trim())
      .map(([key]) => key)
  ))

  /**
   * 兜底：设置里一个模型都没启用、但某渠道已配好 Key 时，让该渠道的内置模型
   * 自动进入可选列表。
   *
   * 为什么需要：`available*Models` 原本只收录「用户手动启用过」的模型，于是
   * 全新安装的画布下拉恒为空，节点里点发送只会看到「请先前往设置配置模型」，
   * 生图链路根本走不到发请求那一步。
   *
   * 一旦用户手动启用过任何模型，设置页结果即为准，本兜底自动失效。
   */
  const withAutoFallback = (enabled, builtIns, defaults = {}) => {
    if (enabled.length) return enabled
    const keys = providersWithKey.value
    if (!keys.size) return enabled
    return builtIns
      .filter(model => (model.provider || []).some(provider => keys.has(provider)))
      .map(model => ({
        ...defaults,
        ...model,
        isCustom: false,
        sourceProvider: (model.provider || []).find(provider => keys.has(provider))
      }))
  }

  const availableChatModels = computed(() => withAutoFallback(
    buildEnabledModels(
      customChatModelsByProvider.value,
      CHAT_MODELS,
      customChatModels.value
    ),
    CHAT_MODELS
  ))

  const availableImageModels = computed(() => withAutoFallback(
    buildEnabledModels(
      customImageModelsByProvider.value,
      IMAGE_MODELS,
      customImageModels.value,
      { sizes: [], defaultParams: { quality: 'standard', style: 'vivid' } }
    ),
    IMAGE_MODELS,
    { sizes: [], defaultParams: { quality: 'standard', style: 'vivid' } }
  ))

  const availableVideoModels = computed(() => withAutoFallback(
    buildEnabledModels(
      customVideoModelsByProvider.value,
      VIDEO_MODELS,
      customVideoModels.value,
      {
        ratios: ['16x9', '9:16', '1:1'],
        durs: [{ label: '5秒', key: 5 }, { label: '10秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5 }
      }
    ),
    VIDEO_MODELS,
    {
      ratios: ['16x9', '9:16', '1:1'],
      durs: [{ label: '5秒', key: 5 }, { label: '10秒', key: 10 }],
      defaultParams: { ratio: '16:9', duration: 5 }
    }
  ))

  // ============ Computed: Model Options for UI (all models, not filtered by provider) ============

  // 返回适合 n-dropdown 使用的选项格式（全部模型，不按渠道过滤�?
  const allImageModelOptions = computed(() =>
    availableImageModels.value.map(m => ({
      label: m.label,
      key: m.key,
      sourceProvider: m.sourceProvider
    }))
  )

  const allVideoModelOptions = computed(() =>
    availableVideoModels.value.map(m => ({
      label: m.label,
      key: m.key,
      sourceProvider: m.sourceProvider
    }))
  )

  const allChatModelOptions = computed(() =>
    availableChatModels.value.map(m => ({
      label: m.label,
      key: m.key,
      sourceProvider: m.sourceProvider
    }))
  )

  // ============ Computed: Grouped Model Options (by provider) ============

  // 供应商 key → 显示名（别名优先）
  const providerLabelMap = computed(() => {
    const map = {}
    providerList.value.forEach(p => { map[p.key] = p.label })
    return map
  })

  // 转成 FlowSelect 分组格式：{ value, label, group, sourceProvider }
  //
  // sourceProvider 必须一并带出：节点判定「本次请求属于哪个渠道」靠的就是它，
  // 只把它用来算 group 会让节点拿不到渠道，从而误报「该模型未绑定供应商」。
  const toGroupedOptions = (items) => items.map(m => ({
    value: m.key,
    label: m.label,
    group: (m.sourceProvider && (providerLabelMap.value[m.sourceProvider] || m.sourceProvider)) || '',
    sourceProvider: m.sourceProvider || ''
  }))

  // 按供应商分组的模型选项（节点下拉用）
  const groupedChatModelOptions = computed(() => toGroupedOptions(allChatModelOptions.value))
  const groupedImageModelOptions = computed(() => toGroupedOptions(allImageModelOptions.value))
  const groupedVideoModelOptions = computed(() => toGroupedOptions(allVideoModelOptions.value))

  /**
   * 按模型 key 反查它所属的渠道。
   *
   * 节点解析「本次请求走哪个渠道」的权威来源。刻意不依赖下拉选项对象：
   * 选项是给 UI 用的形状（value/label/group），曾经因为它没带 sourceProvider
   * 导致节点误判「模型未绑定供应商」。
   *
   * @param {string} modelKey
   * @param {'IMAGE'|'VIDEO'|'CHAT'} [category]
   */
  const resolveModelSourceProvider = (modelKey, category = 'IMAGE') => {
    const key = String(modelKey || '').trim()
    if (!key) return ''
    const pool = category === 'VIDEO'
      ? availableVideoModels.value
      : (category === 'CHAT' ? availableChatModels.value : availableImageModels.value)
    return pool.find(model => model.key === key)?.sourceProvider || ''
  }

  // ============ Computed: Model Options for UI (filtered by provider - deprecated, use all* instead) ============

  // 返回适合 n-dropdown 使用的选项格式
  const imageModelOptions = computed(() =>
    availableImageModels.value.map(m => ({
      label: m.label,
      key: m.key
    }))
  )

  const videoModelOptions = computed(() =>
    availableVideoModels.value.map(m => ({
      label: m.label,
      key: m.key
    }))
  )

  const chatModelOptions = computed(() =>
    availableChatModels.value.map(m => ({
      label: m.label,
      key: m.key
    }))
  )

  // ============ Methods: Add/Remove Custom Models ============

  const addCustomChatModel = (modelKey, label = '') => {
    if (!modelKey || customChatModels.value.some(m => m.key === modelKey)) return false
    customChatModels.value.push({ key: modelKey, label: label || modelKey })
    return true
  }

  const addCustomImageModel = (modelKey, label = '') => {
    if (!modelKey || customImageModels.value.some(m => m.key === modelKey)) return false
    customImageModels.value.push({ key: modelKey, label: label || modelKey })
    return true
  }

  const addCustomVideoModel = (modelKey, label = '') => {
    if (!modelKey || customVideoModels.value.some(m => m.key === modelKey)) return false
    customVideoModels.value.push({ key: modelKey, label: label || modelKey })
    return true
  }

  const removeCustomChatModel = (modelKey) => {
    const idx = customChatModels.value.findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customChatModels.value.splice(idx, 1)
      if (selectedChatModel.value === modelKey) {
        selectedChatModel.value = DEFAULT_CHAT_MODEL
      }
      return true
    }
    return false
  }

  const removeCustomImageModel = (modelKey) => {
    const idx = customImageModels.value.findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customImageModels.value.splice(idx, 1)
      if (selectedImageModel.value === modelKey) {
        selectedImageModel.value = DEFAULT_IMAGE_MODEL
      }
      return true
    }
    return false
  }

  const removeCustomVideoModel = (modelKey) => {
    const idx = customVideoModels.value.findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customVideoModels.value.splice(idx, 1)
      if (selectedVideoModel.value === modelKey) {
        selectedVideoModel.value = DEFAULT_VIDEO_MODEL
      }
      return true
    }
    return false
  }

  // ============ Methods: Get Model Config ============

  const getChatModel = (key) => allChatModels.value.find(m => m.key === key)
  const getImageModel = (key) => allImageModels.value.find(m => m.key === key)
  const getVideoModel = (key) => allVideoModels.value.find(m => m.key === key)

  // ============ Methods: Get API Endpoints ============

  // 获取图片端点
  const getImageEndpoint = () => {
    const endpoint = providerConfig.value.endpoints?.image || '/images/generations'
    return `${currentBaseUrl.value}${endpoint}`
  }

  // 获取视频生成端点
  const getVideoEndpoint = () => {
    const endpoint = providerConfig.value.endpoints?.video || '/videos'
    return `${currentBaseUrl.value}${endpoint}`
  }

  // 获取视频任务查询端点
  const getVideoTaskEndpoint = () => {
    const config = providerConfig.value
    // 优先使用 videoQuery 端点，支�?{taskId} 占位符替�?
    let endpoint = config.endpoints?.videoQuery || config.endpoints?.video || '/videos'
    return `${currentBaseUrl.value}${endpoint}`
  }

  // 获取聊天端点（支持参考图片）
  const getChatEndpoint = () => {
    const endpoint = providerConfig.value?.endpoints?.chat || '/chat/completions'
    return `${currentBaseUrl.value}${endpoint}`
  }

  // ============ Methods: Get Models By Provider (for ApiSettings) ============

  const getModelsByProvider = (provider) => {
    const chat = [
      ...CHAT_MODELS.filter(m => isModelSupported(m, provider)).map(m => ({ ...m, isCustom: false })),
      ...(customChatModelsByProvider.value[provider] || []).map(m => ({
        label: m.label || m.key,
        key: m.key,
        isCustom: true,
        provider: [provider]
      }))
    ]
    const image = [
      ...IMAGE_MODELS.filter(m => isModelSupported(m, provider)).map(m => ({ ...m, isCustom: false })),
      ...(customImageModelsByProvider.value[provider] || []).map(m => ({
        label: m.label || m.key,
        key: m.key,
        isCustom: true,
        sizes: [],
        defaultParams: { quality: 'standard', style: 'vivid' },
        provider: [provider]
      }))
    ]
    const video = [
      ...VIDEO_MODELS.filter(m => isModelSupported(m, provider)).map(m => ({ ...m, isCustom: false })),
      ...(customVideoModelsByProvider.value[provider] || []).map(m => ({
        label: m.label || m.key,
        key: m.key,
        isCustom: true,
        ratios: ['16x9', '9:16', '1:1'],
        durs: [{ label: '5秒', key: 5 }, { label: '10秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5 },
        provider: [provider]
      }))
    ]
    return { chat, image, video }
  }

  // ============ Methods: Add/Remove Custom Models By Provider ============

  const addCustomChatModelByProvider = (modelKey, provider, label = '') => {
    if (!modelKey) return false
    if (!customChatModelsByProvider.value[provider]) {
      customChatModelsByProvider.value[provider] = []
    }
    const existing = customChatModelsByProvider.value[provider].find(m => m.key === modelKey)
    if (existing) {
      existing.label = label?.trim() || modelKey
      return true
    }
    customChatModelsByProvider.value[provider].push({ key: modelKey, label: label || modelKey })
    return true
  }

  const addCustomImageModelByProvider = (modelKey, provider, label = '') => {
    if (!modelKey) return false
    if (!customImageModelsByProvider.value[provider]) {
      customImageModelsByProvider.value[provider] = []
    }
    const existing = customImageModelsByProvider.value[provider].find(m => m.key === modelKey)
    if (existing) {
      existing.label = label?.trim() || modelKey
      return true
    }
    customImageModelsByProvider.value[provider].push({ key: modelKey, label: label || modelKey })
    return true
  }

  const addCustomVideoModelByProvider = (modelKey, provider, label = '') => {
    if (!modelKey) return false
    if (!customVideoModelsByProvider.value[provider]) {
      customVideoModelsByProvider.value[provider] = []
    }
    const existing = customVideoModelsByProvider.value[provider].find(m => m.key === modelKey)
    if (existing) {
      existing.label = label?.trim() || modelKey
      return true
    }
    customVideoModelsByProvider.value[provider].push({ key: modelKey, label: label || modelKey })
    return true
  }

  const removeCustomChatModelByProvider = (modelKey, provider) => {
    if (!customChatModelsByProvider.value[provider]) return false
    const idx = customChatModelsByProvider.value[provider].findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customChatModelsByProvider.value[provider].splice(idx, 1)
      return true
    }
    return false
  }

  const removeCustomImageModelByProvider = (modelKey, provider) => {
    if (!customImageModelsByProvider.value[provider]) return false
    const idx = customImageModelsByProvider.value[provider].findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customImageModelsByProvider.value[provider].splice(idx, 1)
      return true
    }
    return false
  }

  const removeCustomVideoModelByProvider = (modelKey, provider) => {
    if (!customVideoModelsByProvider.value[provider]) return false
    const idx = customVideoModelsByProvider.value[provider].findIndex(m => m.key === modelKey)
    if (idx > -1) {
      customVideoModelsByProvider.value[provider].splice(idx, 1)
      return true
    }
    return false
  }

  // 清除所有自定义模型
  const clearCustomModels = () => {
    customChatModels.value = []
    customImageModels.value = []
    customVideoModels.value = []
    selectedChatModel.value = DEFAULT_CHAT_MODEL
    selectedImageModel.value = DEFAULT_IMAGE_MODEL
    selectedVideoModel.value = DEFAULT_VIDEO_MODEL
  }

  // ============ Watch & Persist ============

  // 监听并持久化自定义模�?
  watch(customChatModels, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_CHAT_MODELS, val), { deep: true })
  watch(customImageModels, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_IMAGE_MODELS, val), { deep: true })
  watch(customVideoModels, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_VIDEO_MODELS, val), { deep: true })

  // 监听并持久化按渠道的自定义模�?
  watch(customChatModelsByProvider, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_CHAT_MODELS_BY_PROVIDER, val), { deep: true })
  watch(customImageModelsByProvider, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_IMAGE_MODELS_BY_PROVIDER, val), { deep: true })
  watch(customVideoModelsByProvider, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_VIDEO_MODELS_BY_PROVIDER, val), { deep: true })

  // 监听并持久化选中的模�?
  watch(selectedChatModel, (val) => setStored(STORAGE_KEYS.SELECTED_CHAT_MODEL, val))
  watch(selectedImageModel, (val) => setStored(STORAGE_KEYS.SELECTED_IMAGE_MODEL, val))
  watch(selectedVideoModel, (val) => setStored(STORAGE_KEYS.SELECTED_VIDEO_MODEL, val))

  // 监听并持久化 API 配置
  watch(apiKeysByProvider, (val) => setStoredJson(STORAGE_KEYS.API_KEYS_BY_PROVIDER, val), { deep: true })
  watch(baseUrlsByProvider, (val) => setStoredJson(STORAGE_KEYS.BASE_URLS_BY_PROVIDER, val), { deep: true })
  watch(customProviders, (val) => setStoredJson(STORAGE_KEYS.CUSTOM_PROVIDERS, val), { deep: true })
  watch(providerAliases, (val) => setStoredJson(STORAGE_KEYS.PROVIDER_ALIASES, val), { deep: true })
  watch(providerOrder, (val) => setStoredJson(STORAGE_KEYS.PROVIDER_ORDER, val), { deep: true })
  watch(hiddenProviders, (val) => setStoredJson(STORAGE_KEYS.HIDDEN_PROVIDERS, val), { deep: true })
  watch(providerOverrides, (val) => setStoredJson(STORAGE_KEYS.PROVIDER_OVERRIDES, val), { deep: true })

  return {
    // Provider
    currentProvider,
    providerList,
    providerConfig,
    providerLabel,
    setProvider,
    clearProvider,
    customProviders,
    providerAliases,
    providerOrder,
    providerOverrides,
    setProviderOverrides,
    addCustomProvider,
    updateCustomProvider,
    updateProviderLabel,
    reorderProviders,
    removeCustomProvider,
    removeProvider,
    adaptRequest,
    adaptResponse,

    // All models (built-in + custom)
    allChatModels,
    allImageModels,
    allVideoModels,

    // Available models filtered by provider
    availableChatModels,
    availableImageModels,
    availableVideoModels,

    // Model options for UI (dropdown format)
    imageModelOptions,
    videoModelOptions,
    chatModelOptions,

    // All model options (not filtered by provider)
    allImageModelOptions,
    allVideoModelOptions,
    allChatModelOptions,

    // Grouped model options (by provider, for flow node dropdowns)
    groupedChatModelOptions,
    groupedImageModelOptions,
    groupedVideoModelOptions,
    providerLabelMap,

    // Selected models
    selectedChatModel,
    selectedImageModel,
    selectedVideoModel,

    // Custom models
    customChatModels,
    customImageModels,
    customVideoModels,

    // Custom models by provider
    customChatModelsByProvider,
    customImageModelsByProvider,
    customVideoModelsByProvider,

    // Add/Remove methods
    addCustomChatModel,
    addCustomImageModel,
    addCustomVideoModel,
    removeCustomChatModel,
    removeCustomImageModel,
    removeCustomVideoModel,

    // Add/Remove by provider methods
    addCustomChatModelByProvider,
    addCustomImageModelByProvider,
    addCustomVideoModelByProvider,
    removeCustomChatModelByProvider,
    removeCustomImageModelByProvider,
    removeCustomVideoModelByProvider,

    // Get model
    getChatModel,
    getImageModel,
    getVideoModel,

    // Get API endpoints
    getImageEndpoint,
    getVideoEndpoint,
    getVideoTaskEndpoint,
    getChatEndpoint,

    // Get models by provider (for ApiSettings)
    getModelsByProvider,

    // Clear all custom models
    clearCustomModels,

    // API Config by provider
    currentApiKey,
    currentBaseUrl,
    apiKeysByProvider,
    baseUrlsByProvider,
    setApiKeyByProvider,
    setBaseUrlByProvider,
    clearApiConfigByProvider,

    // 按渠道 ID 解析（每请求自带 provider 用）
    getProviderConfigById,
    getApiKeyByProvider,
    getBaseUrlByProvider,
    resolveUpstreamContext,

    // 按模型反查渠道（节点判定请求归属）
    resolveModelSourceProvider
  }
})
