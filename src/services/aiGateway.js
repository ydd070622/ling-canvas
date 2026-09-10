/**
 * 本地 AI 网关 | Local AI gateway
 *
 * 对应 CanvasMind 服务端 `server/ai-gateway` 的职责，但运行在本地渲染进程：
 *   CanvasMind:  前端 → 同源 /api/ai/request → 服务端网关 → 厂商（密钥在服务端）
 *   本项目:       前端 → services/aiGateway → Rust http_request → 厂商（密钥在本地）
 *
 * 这样既保留了「前端不认识厂商细节、只描述能力」的分层，又不需要为桌面端
 * 额外部署后端服务；同时借 Rust 通道绕开 WebView 的 CORS 限制。
 *
 * 本文件不认识任何具体厂商，只做：解析端点 → 组装请求 → 转发 → 归一化错误。
 */

import { getEndpointStrategy, resolveProviderEndpointRule, DEFAULT_ENDPOINT_PATHS } from '@/config/providerCapabilities'

const normalizeStringValue = value => String(value ?? '').trim()

const isTauriRuntime = () => (
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
)

const invokeTauri = async (command, args) => {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

const createAbortError = () => {
  const error = new Error('已取消生成')
  error.name = 'AbortError'
  return error
}

/**
 * 拼接 baseUrl 与端点路径。
 * 容忍三种常见配置：base 带 /v1、base 不带 /v1、路径带或不带前导斜杠；
 * 并避免出现 /v1/v1/... 这类重复段。
 */
export const joinUrl = (baseUrl, path) => {
  const base = normalizeStringValue(baseUrl).replace(/\/+$/, '')
  let suffix = normalizeStringValue(path)
  if (!suffix) return base
  if (!suffix.startsWith('/')) suffix = `/${suffix}`
  if (/\/v1$/i.test(base) && /^\/v1\//i.test(suffix)) {
    suffix = suffix.replace(/^\/v1/i, '')
  }
  return `${base}${suffix}`
}

/**
 * 解析某能力的端点路径，支持 `{taskId}` 占位符。
 * @param {Object} providerConfig
 * @param {string} endpointType
 * @param {{taskId?: string}} [params]
 */
export const resolveEndpointPath = (providerConfig, endpointType, params = {}) => {
  const field = getEndpointStrategy(endpointType).endpointField
  const configured = normalizeStringValue(providerConfig?.endpoints?.[field])
  const template = configured || DEFAULT_ENDPOINT_PATHS[field] || ''
  const taskId = normalizeStringValue(params?.taskId)
  if (!template.includes('{taskId}')) {
    // 渠道没给占位符时，退化成 `${template}/{taskId}`，避免查询打到列表接口
    return taskId ? joinUrl(template, encodeURIComponent(taskId)) : template
  }
  return template.replace('{taskId}', encodeURIComponent(taskId))
}

/** 组装鉴权头。空 Key 不发送 Authorization，避免上游把 `Bearer ` 判为非法凭证。 */
export const buildAuthHeaders = apiKey => {
  const key = normalizeStringValue(apiKey)
  return key ? { Authorization: `Bearer ${key}` } : {}
}

/**
 * 应用渠道自带的请求适配器（把画布字段翻译成该厂商的字段名）。
 * 与 model store 的 adaptRequest 等价，但作用于「按请求解析出的渠道」，
 * 不受全局 currentProvider 影响。
 */
export const adaptRequestFor = (providerConfig, type, params) => {
  const adapter = providerConfig?.requestAdapter?.[type]
  return typeof adapter === 'function' ? adapter(params) : params
}

/** 从上游错误响应里尽量挖出可读文案。 */
export const describeUpstreamError = (status, json, text) => {
  const candidates = [
    json?.error?.message,
    json?.error,
    json?.message,
    json?.msg,
    json?.detail,
    typeof json?.error === 'string' ? json.error : '',
    text
  ]
  const detail = candidates
    .map(normalizeStringValue)
    .find(value => value && value !== '[object Object]')
  const head = status ? `HTTP ${status}` : '请求失败'
  if (!detail) return head
  return `${head}: ${detail.slice(0, 400)}`
}

/**
 * 唯一的出网入口。
 * 桌面端走 Rust `http_request`（无 CORS、支持 multipart）；浏览器环境回退 fetch。
 *
 * @returns {Promise<{ok:boolean,status:number,body:string,contentType:string}>}
 */
export const callUpstream = async ({
  url,
  method = 'POST',
  headers = {},
  json,
  fields,
  files,
  timeoutMs,
  signal
} = {}) => {
  const hasMultipart = (Array.isArray(fields) && fields.length > 0)
    || (Array.isArray(files) && files.length > 0)

  if (isTauriRuntime()) {
    if (signal?.aborted) throw createAbortError()
    const requestId = signal
      ? `http-${Date.now()}-${Math.random().toString(36).slice(2)}`
      : undefined
    const handleAbort = () => {
      if (requestId) invokeTauri('cancel_http_request', { requestId }).catch(() => {})
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
    let result
    try {
      result = await invokeTauri('http_request', {
        args: {
          url,
          method,
          headers,
          timeoutMs: timeoutMs || undefined,
          json: hasMultipart ? undefined : json,
          fields: hasMultipart ? (fields || []) : [],
          files: hasMultipart ? (files || []) : [],
          requestId
        }
      })
    } catch (error) {
      if (signal?.aborted) throw createAbortError()
      // Tauri 命令失败时 rejection 可能是字符串，统一成 Error 以保证 err.message 可用
      throw new Error(typeof error === 'string' ? error : (error?.message || '请求上游失败'))
    } finally {
      signal?.removeEventListener('abort', handleAbort)
    }
    return {
      ok: Boolean(result?.ok),
      status: Number(result?.status || 0),
      body: String(result?.body ?? ''),
      contentType: String(result?.contentType ?? '')
    }
  }

  // 浏览器 / 开发环境回退：受厂商 CORS 策略约束，必要时由 vite 代理承接
  const init = { method: method.toUpperCase(), headers: { ...headers }, signal }
  if (hasMultipart) {
    const form = new FormData()
    ;(fields || []).forEach(field => form.append(field.name, field.value))
    ;(files || []).forEach(file => {
      const binary = atob(file.dataBase64 || '')
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      form.append(file.name, new Blob([bytes], { type: file.mime }), file.fileName)
    })
    init.body = form
  } else if (json !== undefined && method.toUpperCase() !== 'GET') {
    // 必须写在 init.headers 上：init 已经复制了 headers，改原对象不会生效
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(json)
  }

  const response = await fetch(url, init)
  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get('content-type') || ''
  }
}

/** 尝试把响应体解析为 JSON，失败时保留原文。 */
export const parseResponseBody = response => {
  const text = String(response?.body ?? '')
  if (!text.trim()) return { json: null, text: '' }
  try {
    return { json: JSON.parse(text), text }
  } catch {
    return { json: null, text }
  }
}

/**
 * 发起一次上游生成请求（api 层的统一入口）。
 *
 * @param {Object} options
 * @param {Object} options.providerConfig 渠道配置（endpoints / protocols / requestAdapter）
 * @param {string} options.apiKey         该渠道的 Key
 * @param {string} [options.baseUrl]      渠道 Base URL，缺省用 providerConfig.defaultBaseUrl
 * @param {string} options.endpointType   chat | image | image-edit | video | video-query
 * @param {Object} [options.json]         JSON 请求体
 * @param {Array}  [options.fields]       multipart 文本字段
 * @param {Array}  [options.files]        multipart 文件字段
 * @param {string} [options.taskId]       用于 {taskId} 占位符
 * @param {string} [options.requestPath]  显式覆盖端点路径（渠道配置之外的特例）
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {Object} [options.headers]
 * @returns {Promise<{ok:boolean,status:number,json:any,text:string,url:string,endpointType:string,protocol:string}>}
 */
export const requestUpstream = async ({
  providerConfig,
  apiKey,
  baseUrl,
  endpointType,
  json,
  fields,
  files,
  taskId,
  requestPath,
  timeoutMs,
  signal,
  headers: extraHeaders
} = {}) => {
  const { protocol, method } = resolveProviderEndpointRule(providerConfig, endpointType)
  const effectiveBase = normalizeStringValue(baseUrl) || normalizeStringValue(providerConfig?.defaultBaseUrl)
  if (!effectiveBase) throw new Error('未配置接口地址，请到设置中填写该渠道的 Base URL')

  const path = normalizeStringValue(requestPath)
    || resolveEndpointPath(providerConfig, endpointType, { taskId })
  const url = joinUrl(effectiveBase, path)
  const hasMultipart = Array.isArray(files) && files.length > 0

  const headers = { ...buildAuthHeaders(apiKey), ...(extraHeaders || {}) }

  const response = await callUpstream({
    url,
    method,
    headers,
    json: hasMultipart ? undefined : json,
    fields: hasMultipart ? fields : undefined,
    files: hasMultipart ? files : undefined,
    timeoutMs,
    signal
  })

  const { json: parsed, text } = parseResponseBody(response)

  if (!response.ok) {
    const error = new Error(describeUpstreamError(response.status, parsed, text))
    error.status = response.status
    error.responseBody = parsed ?? text
    throw error
  }

  return {
    ok: true,
    status: response.status,
    json: parsed,
    text,
    url,
    endpointType,
    protocol
  }
}
