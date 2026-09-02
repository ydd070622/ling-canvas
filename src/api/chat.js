/**
 * Chat API | 对话 API
 */

import { request, getBaseUrl } from '@/utils'

// Detect desktop environment | 检测桌面环境
const isDesktop = () => {
  const ua = navigator.userAgent
  return ua.includes('Tauri') || ua.includes('Electron')
}

// 对话补全
export const chatCompletions = (data) =>
  request({
    url: `/chat/completions`,
    method: 'post',
    data
  })

// 流式对话补全
export const streamChatCompletions = async function* (data, signal, options = {}) {
  const apiKey = localStorage.getItem('apiKey')
  // Desktop: use full API URL; Web: use proxy | 桌面端使用完整 API 地址，Web 端使用代理
  const defaultBaseUrl = isDesktop() ? 'https://api.chatfire.site/v1' : getBaseUrl()
  const baseUrl = options.baseUrl || defaultBaseUrl
  // 使用 options.endpoint 或默认的 /chat/completions
  const endpoint = options.endpoint || '/chat/completions'

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...data, stream: true }),
    signal
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error?.error?.message || error?.message || 'Stream request failed')
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

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return

      try {
        const parsed = JSON.parse(data)
        const content = parsed.choices?.[0]?.delta?.content
        if (content) yield content
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }
}
