/**
 * 上游结果解析 | Upstream result parser
 *
 * 对应 CanvasMind 的 `src/shared/upstream-stream-parser.ts` +
 * `src/api/gateway-sse-strategies.ts` 的职责：把五花八门的厂商响应归一成
 * 画布内部能消费的形状。
 *
 * 设计原则：**宁可多探几层，也不要因为厂商包了一层就判定失败**。
 * 之前画布直接读 `result.data` / `result[0].url`，任何一个厂商换个包装就废。
 */

const normalizeStringValue = value => String(value ?? '').trim()

/** base64 → data URL，便于 <img> 直接渲染 */
export const toDataUrl = (base64, mime = 'image/png') => {
  const value = normalizeStringValue(base64)
  if (!value) return ''
  if (/^data:/i.test(value)) return value
  return `data:${mime || 'image/png'};base64,${value}`
}

/**
 * 深度剥壳：把 {code, data} / {result} / {output} 这类包装逐层揭开，
 * 直到拿到数组或“长得像结果”的对象。
 */
const unwrapLayers = (input, maxDepth = 4) => {
  let current = input
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current
    const nextCandidates = [current.data, current.result, current.output, current.results, current.images, current.payload]
      .filter(candidate => candidate !== undefined && candidate !== null)
    if (!nextCandidates.length) return current
    const next = nextCandidates[0]
    // 已经是图片/视频形态就不再剥
    if (looksLikeMediaEntry(next)) return next
    if (Array.isArray(next)) return next
    if (typeof next === 'object') {
      current = next
      continue
    }
    return current
  }
  return current
}

const looksLikeMediaEntry = value => (
  value && typeof value === 'object' && !Array.isArray(value)
  && (value.url || value.b64_json || value.image_url || value.video_url || value.image || value.video)
)

/** 从单个条目里挖出媒体地址 */
const extractUrlFromEntry = entry => {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object') return ''
  const direct = entry.url || entry.image_url || entry.video_url || entry.video || entry.image || entry.src || entry.link
  if (typeof direct === 'string' && direct) return direct
  if (direct && typeof direct === 'object' && typeof direct.url === 'string') return direct.url
  if (entry.b64_json) return toDataUrl(entry.b64_json)
  if (entry.base64) return toDataUrl(entry.base64)
  return ''
}

/** 从任意文本里抓图片地址：markdown、裸链、data URL 都认 */
const extractUrlsFromText = text => {
  const value = String(text || '')
  if (!value) return []
  const found = new Set()

  // data URL（含 base64 图片）
  const dataMatches = value.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi) || []
  dataMatches.forEach(match => found.add(match.replace(/\s+/g, '')))

  // markdown 图片
  const markdownMatches = value.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/gi) || []
  markdownMatches.forEach(match => {
    const url = match.match(/\((https?:\/\/[^\s)]+)\)/i)?.[1]
    if (url) found.add(url)
  })

  // 裸 http(s) 链接
  const plainMatches = value.match(/https?:\/\/[^\s"'<>)\]]+/gi) || []
  plainMatches.forEach(url => found.add(url.replace(/[.,;]+$/, '')))

  return [...found]
}

/**
 * 从上游响应里收集图片结果。
 * @returns {Array<{url:string, revisedPrompt:string}>}
 */
export const collectImageResults = raw => {
  if (!raw) return []
  const results = []
  const push = (url, revisedPrompt = '') => {
    const value = normalizeStringValue(url)
    if (!value) return
    if (results.some(item => item.url === value)) return
    results.push({ url: value, revisedPrompt: normalizeStringValue(revisedPrompt) })
  }

  const payload = unwrapLayers(raw)

  if (Array.isArray(payload)) {
    payload.forEach(entry => push(extractUrlFromEntry(entry), entry?.revised_prompt || ''))
  } else if (payload && typeof payload === 'object') {
    push(extractUrlFromEntry(payload), payload.revised_prompt || '')

    // chat 协议出图：内容里带 markdown / data URL
    const contents = payload.choices?.map(choice => choice?.message?.content)
      ?? (typeof payload.content === 'string' ? [payload.content] : [])
    contents.filter(Boolean).forEach(content => {
      if (Array.isArray(content)) {
        content.forEach(part => {
          const url = part?.image_url?.url || part?.image_url || part?.url
          if (url) push(url)
          else if (typeof part?.text === 'string') extractUrlsFromText(part.text).forEach(item => push(item))
        })
      } else {
        extractUrlsFromText(content).forEach(item => push(item))
      }
    })
  }

  // 兜底：整包文本里再捞一遍
  if (!results.length) {
    extractUrlsFromText(typeof raw === 'string' ? raw : JSON.stringify(raw)).forEach(item => push(item))
  }

  return results
}

// ============================================================
// 视频任务状态机
// ============================================================

/** 统一状态：pending | succeeded | failed */
export const VIDEO_TASK_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed'
})

const SUCCESS_WORDS = ['success', 'succeeded', 'completed', 'complete', 'finished', 'done', 'ready', 'ok']
const FAILURE_WORDS = ['fail', 'failed', 'failure', 'error', 'cancel', 'canceled', 'cancelled', 'rejected', 'expired']

const classifyStatusText = value => {
  const text = normalizeStringValue(value).toLowerCase()
  if (!text) return ''
  // 短词（如 ok / done）只认完整匹配，避免 "token" 这类词里误命中 "ok"
  const hit = word => (word.length <= 3 ? text === word : text.includes(word))
  if (SUCCESS_WORDS.some(hit)) return VIDEO_TASK_STATUS.SUCCEEDED
  if (FAILURE_WORDS.some(hit)) return VIDEO_TASK_STATUS.FAILED
  return ''
}

/**
 * 归一化视频任务响应。
 *
 * 关键点：**只有状态明确为成功、或确实拿到了视频地址时才算完成**；
 * 之前把「响应里存在 data 字段」当成完成，导致首次轮询就返回空地址。
 *
 * @returns {{status:string, url:string, progress:number, taskId:string, error:string, raw:any}}
 */
export const collectVideoTask = raw => {
  const payload = unwrapLayers(raw) || raw
  const candidates = [payload, raw].filter(Boolean)

  const readField = keys => {
    for (const source of candidates) {
      if (!source || typeof source !== 'object') continue
      for (const key of keys) {
        const value = source[key]
        if (value !== undefined && value !== null && value !== '') return value
      }
    }
    return ''
  }

  const statusText = readField(['status', 'state', 'task_status', 'taskStatus', 'phase'])
  const url = extractUrlFromEntry(payload) || extractUrlFromEntry(raw) || ''
  const errorText = readField([
    'error_message', 'errorMessage', 'fail_reason', 'failReason', 'message', 'msg'
  ])
  const errorObject = readField(['error'])

  let status = classifyStatusText(statusText)
  if (!status) {
    // 状态字段缺失或用了未知词表时，只能靠“有没有拿到视频地址”判断
    status = url ? VIDEO_TASK_STATUS.SUCCEEDED : VIDEO_TASK_STATUS.PENDING
  }
  // 状态说成功但地址还没就绪 → 继续等
  if (status === VIDEO_TASK_STATUS.SUCCEEDED && !url) status = VIDEO_TASK_STATUS.PENDING

  const taskId = normalizeStringValue(
    readField(['task_id', 'taskId', 'id', 'job_id', 'jobId', 'request_id', 'requestId'])
  )

  // 进度：兼容 0-1 与 0-100
  const rawProgress = readField(['progress', 'percent', 'percentage', 'progress_percent'])
  let progress = Number(rawProgress)
  if (!Number.isFinite(progress)) progress = 0
  if (progress > 0 && progress <= 1) progress = progress * 100
  progress = Math.max(0, Math.min(100, Math.round(progress)))
  if (status === VIDEO_TASK_STATUS.SUCCEEDED) progress = 100

  let error = ''
  if (status === VIDEO_TASK_STATUS.FAILED) {
    error = normalizeStringValue(
      typeof errorObject === 'string' ? errorObject : (errorObject?.message || errorText)
    ) || '视频生成失败'
  }

  return { status, url, progress, taskId, error, raw }
}

/** 视频任务创建响应 → 任务 ID 与（可能直接返回的）地址 */
export const collectVideoTaskCreation = raw => {
  const payload = unwrapLayers(raw) || raw
  const directUrl = extractUrlFromEntry(payload) || extractUrlFromEntry(raw)
  const taskId = normalizeStringValue(
    payload?.task_id || payload?.taskId || payload?.id || payload?.job_id || raw?.task_id || raw?.taskId || raw?.id
  )
  return { taskId, url: directUrl }
}
