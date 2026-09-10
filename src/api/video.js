/**
 * Video API | 视频生成 API
 *
 * 视频是异步任务：先创建（video），再按 taskId 轮询查询（video-query）。
 * 查询端点路径由渠道配置的 `videoQuery` 决定，支持 `{taskId}` 占位符；
 * 未配置占位符时由网关退化为 `${path}/{taskId}`，避免查到列表接口。
 */

import { requestUpstream } from '@/services/aiGateway'
import { collectVideoTask, collectVideoTaskCreation, VIDEO_TASK_STATUS } from '@/utils/resultParser'

const CREATE_TIMEOUT_MS = 120_000
const QUERY_TIMEOUT_MS = 30_000

/**
 * 创建视频任务。
 * @param {Object} payload 已按渠道适配过的请求体
 * @param {Object} options { upstream, signal, timeoutMs }
 * @returns {Promise<{taskId:string, url:string}>}
 */
export const createVideoTask = async (payload = {}, options = {}) => {
  const { upstream, signal, timeoutMs = CREATE_TIMEOUT_MS } = options
  if (!upstream?.providerConfig) throw new Error('缺少渠道配置，请先到设置中配置供应商')

  const response = await requestUpstream({
    ...upstream,
    endpointType: 'video',
    json: payload,
    signal,
    timeoutMs
  })

  const { taskId, url } = collectVideoTaskCreation(response.json)
  if (!taskId && !url) {
    const preview = String(response.text || '').slice(0, 200)
    throw new Error(`未获取到视频任务 ID${preview ? `：${preview}` : ''}`)
  }
  return { taskId, url }
}

/**
 * 查询一次视频任务状态。
 * @returns {Promise<{status:string, url:string, progress:number, taskId:string, error:string}>}
 */
export const getVideoTaskStatus = async (taskId, options = {}) => {
  const { upstream, signal, timeoutMs = QUERY_TIMEOUT_MS } = options
  if (!upstream?.providerConfig) throw new Error('缺少渠道配置，请先到设置中配置供应商')
  if (!taskId) throw new Error('缺少视频任务 ID')

  const response = await requestUpstream({
    ...upstream,
    endpointType: 'video-query',
    taskId,
    signal,
    timeoutMs
  })

  return collectVideoTask(response.json)
}

/**
 * 轮询直到任务成功、失败或超时。
 * @param {string} taskId
 * @param {Object} options { upstream, signal, intervalMs, maxAttempts, onProgress }
 */
export const pollVideoTask = async (taskId, options = {}) => {
  const {
    upstream,
    signal,
    intervalMs = 5_000,
    maxAttempts = 180,
    onProgress
  } = options

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) throw new Error('已取消生成')

    const task = await getVideoTaskStatus(taskId, { upstream, signal })
    onProgress?.(
      attempt,
      task.progress || Math.min(99, Math.round((attempt / maxAttempts) * 100)),
      task
    )

    if (task.status === VIDEO_TASK_STATUS.SUCCEEDED) return task
    if (task.status === VIDEO_TASK_STATUS.FAILED) throw new Error(task.error || '视频生成失败')

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error('视频生成超时')
}
