/**
 * API provider adapter configuration.
 * Users configure the API endpoint and key in the application settings.
 */
const openAICompatibleAdapter = {
  endpoints: {
    chat: '/v1/chat/completions',
    image: '/v1/images/generations',
    video: '/v1/videos',
    videoQuery: '/v1/videos/{taskId}'
  },
  requestAdapter: {
    chat: (params) => ({
      model: params.model,
      messages: params.messages,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.max_tokens !== undefined ? { max_tokens: params.max_tokens } : {}),
      ...(params.stream !== undefined ? { stream: params.stream } : {})
    }),
    image: (params) => ({
      model: params.model,
      prompt: params.prompt,
      ...(params.size ? { size: params.size } : {}),
      ...(params.n ? { n: params.n } : {}),
      ...(params.quality ? { quality: params.quality } : {}),
      ...(params.style ? { style: params.style } : {}),
      ...(params.image ? { image: params.image } : {})
    }),
    video: (params) => ({ ...params })
  },
  responseAdapter: {
    chat: (response) => response.choices?.[0]?.message?.content || response.data?.choices?.[0]?.message?.content || '',
    image: (response) => {
      const data = response.data?.data || response.data || response
      return (Array.isArray(data) ? data : [data]).map(item => ({
        url: item?.url || item?.b64_json || '',
        revisedPrompt: item?.revised_prompt || ''
      }))
    },
    video: (response) => ({
      url: response.data?.url || response.url || response.data?.[0]?.url || '',
      ...response
    })
  }
}

export const PROVIDERS = {
  openai: {
    label: 'OpenAI 兼容接口',
    defaultBaseUrl: '',
    ...openAICompatibleAdapter
  },
  default: 'openai'
}

export const getProviderList = () => Object.entries(PROVIDERS)
  .filter(([key]) => key !== 'default')
  .map(([key, value]) => ({ key, label: value.label }))

export const getDefaultProvider = () => PROVIDERS.default || 'openai'

export const getDefaultBaseUrl = (providerKey) => {
  const config = getProviderConfig(providerKey)
  return config.defaultBaseUrl || ''
}

export const getProviderConfig = (providerKey) => {
  return PROVIDERS[providerKey] || PROVIDERS[PROVIDERS.default]
}
