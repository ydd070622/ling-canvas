/**
 * Chat API | 对话 API
 *
 * 走本地网关（services/aiGateway）。桌面端由 Rust 通道转发，因此天然绕开 CORS。
 *
 * 修复点：原实现从 `localStorage.getItem('apiKey')` 读 Key，而设置页只写
 * `api-keys-by-provider`，导致对话/意图分析始终带着空 Bearer 请求 401。
 * 现在统一由 model store 解析「按渠道的 Key」。
 *
 * 流式说明：Tauri 通道当前是「整包返回」，因此桌面端退化为一次性产出完整内容；
 * 调用方（如工作流意图分析）本来就是累加全部 chunk，接口契约不变。
 */

import {
  requestUpstream,
  buildAuthHeaders,
  joinUrl,
  resolveEndpointPath
} from '@/services/aiGateway'
import { useModelStore } from '@/stores/pinia'

const CHAT_TIMEOUT_MS = 180_000

/** 从对话响应里取出正文，兼容 string / 数组分片 / 各家包装。 */
export const collectChatContent = json => {
  if (!json) return ''
  const choice = json?.choices?.[0]
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : (part?.text || '')))
      .join('')
  }
  const fallbacks = [json.content, json.message?.content, json.output_text, json.data?.content, json.result?.content]
  return fallbacks.map(value => (typeof value === 'string' ? value : '')).find(Boolean) || ''
}

/**
 * 解析本次请求要用的渠道上下文。
 * 优先使用显式传入的 upstream；否则按当前渠道从 model store 解析。
 */
const resolveChatContext = (options = {}) => {
  if (options.upstream?.providerConfig) return options.upstream
  try {
    const modelStore = useModelStore()
    const context = modelStore.resolveUpstreamContext(options.providerId)
    return options.apiKey ? { ...context, apiKey: options.apiKey } : context
  } catch (error) {
    // Pinia 尚未初始化：交给网关抛出可读错误，而不是静默用空 Key 发请求
    return {
      providerId: options.providerId || '',
      providerConfig: null,
      apiKey: options.apiKey || '',
      baseUrl: options.baseUrl || ''
    }
  }
}

const isTauriRuntime = () => (
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
)

/** 非流式对话补全 */
export const chatCompletions = async (data = {}, options = {}) => {
  const upstream = resolveChatContext(options)
  const response = await requestUpstream({
    ...upstream,
    endpointType: 'chat',
    requestPath: options.requestPath,
    json: { ...data, stream: false },
    signal: options.signal,
    timeoutMs: options.timeoutMs || CHAT_TIMEOUT_MS
  })
  return response.json
}

/**
 * 流式对话补全（async generator）。
 *
 * 浏览器/开发环境走真正的 SSE；桌面端经 Rust 通道整包返回后一次性产出，
 * 对调用方保持相同契约。
 */
export const streamChatCompletions = async function* (data = {}, signal, options = {}) {
  const upstream = resolveChatContext(options)

  if (isTauriRuntime()) {
    const payload = { ...data, stream: false }
    const response = await requestUpstream({
      ...upstream,
      endpointType: 'chat',
      requestPath: options.requestPath,
      json: payload,
      signal,
      timeoutMs: options.timeoutMs || CHAT_TIMEOUT_MS
    })
    const content = collectChatContent(response.json)
    if (content) yield content
    return
  }

  const base = String(options.baseUrl || upstream.baseUrl || '').trim()
  const path = String(options.endpoint || resolveEndpointPath(upstream.providerConfig, 'chat'))
  const response = await fetch(joinUrl(base, path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(upstream.apiKey)
    },
    body: JSON.stringify({ ...data, stream: true }),
    signal
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`对话请求失败 (HTTP ${response.status})${text ? `: ${text.slice(0, 200)}` : ''}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        const parsed = JSON.parse(payload)
        const content = collectChatContent({ choices: [{ delta: parsed.choices?.[0]?.delta }] })
        if (content) yield content
      } catch (error) {
        // 忽略非 JSON 的分片
      }
    }
  }
}
