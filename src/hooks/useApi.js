/**
 * API Hooks | API Hooks
 *
 * 改造要点：所有生成请求都按「本次请求所属的渠道」解析上下文
 * （providerId → providerConfig / apiKey / baseUrl），不再依赖全局
 * `currentProvider`。这样画布上同时存在多个渠道的节点时不会互相串味。
 *
 * 上层节点调用方式：
 *   generate(params, { providerId })   // providerId 取自所选模型的 sourceProvider
 */

import { ref, reactive, onUnmounted } from 'vue'
import { generateImage } from '@/api/image'
import { createVideoTask, pollVideoTask as pollVideoTaskRequest } from '@/api/video'
import { streamChatCompletions } from '@/api/chat'
import { getModelByName } from '@/config/models'
import { adaptRequestFor } from '@/services/aiGateway'
import { toTransportableReferenceImage } from '@/utils/upstreamRequest'
import { useModelStore } from '@/stores/pinia'

/**
 * Base API state hook | 基础 API 状态 Hook
 */
export const useApiState = () => {
  const loading = ref(false)
  const error = ref(null)
  const status = ref('idle')

  const reset = () => {
    loading.value = false
    error.value = null
    status.value = 'idle'
  }

  const setLoading = (isLoading) => {
    loading.value = isLoading
    status.value = isLoading ? 'running' : status.value
  }

  const setError = (err) => {
    error.value = err
    status.value = 'error'
    loading.value = false
  }

  const setSuccess = () => {
    status.value = 'success'
    loading.value = false
    error.value = null
  }

  return { loading, error, status, reset, setLoading, setError, setSuccess }
}

/**
 * 解析本次请求的渠道上下文，并校验可用性。
 * @param {Object} modelStore
 * @param {string} [providerId] 模型所属渠道；缺省回退到当前渠道
 */
const resolveUpstreamOrThrow = (modelStore, providerId) => {
  const upstream = modelStore.resolveUpstreamContext(providerId)
  if (!upstream.providerConfig) {
    throw new Error('未找到该模型所属的供应商配置，请到设置中检查渠道')
  }
  if (!upstream.apiKey) {
    throw new Error(`供应商「${upstream.providerLabel || upstream.providerId}」尚未配置 API Key`)
  }
  return upstream
}

/**
 * Chat composable | 问答组合式函数
 */
export const useChat = (options = {}) => {
  const { loading, error, status, reset, setLoading, setError, setSuccess } = useApiState()
  const modelStore = useModelStore()

  const messages = ref([])
  const currentResponse = ref('')
  let abortController = null

  const send = async (content, stream = true, chatOptions = {}) => {
    setLoading(true)
    currentResponse.value = ''
    abortController = new AbortController()

    try {
      const images = chatOptions.images || options.images || []
      const userContent = images.length > 0
        ? [
            { type: 'text', text: content },
            ...images.map(img => ({ type: 'image_url', image_url: { url: img.url || img } }))
          ]
        : content

      const upstream = resolveUpstreamOrThrow(modelStore, chatOptions.providerId)
      const model = chatOptions.model || options.model || modelStore.selectedChatModel
      const payload = adaptRequestFor(upstream.providerConfig, 'chat', {
        model,
        messages: [
          ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
          ...messages.value,
          { role: 'user', content: userContent }
        ]
      })

      status.value = stream ? 'streaming' : 'running'
      let fullResponse = ''
      for await (const chunk of streamChatCompletions(payload, abortController.signal, { upstream })) {
        fullResponse += chunk
        currentResponse.value = fullResponse
      }

      messages.value.push({ role: 'user', content })
      messages.value.push({ role: 'assistant', content: fullResponse })
      setSuccess()
      return fullResponse
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err)
        throw err
      }
    } finally {
      abortController = null
    }
  }

  const stop = () => {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  const clear = () => {
    messages.value = []
    currentResponse.value = ''
    reset()
  }

  onUnmounted(() => stop())

  return { loading, error, status, messages, currentResponse, send, stop, clear, reset }
}

/**
 * Image generation composable | 图片生成组合式函数
 *
 * 文生图 / 图生图由 api/image 按渠道能力自动分流：
 * 无参考图 → image（JSON），有参考图 → image-edit（multipart）。
 */
export const useImageGeneration = () => {
  const { loading, error, status, reset, setLoading, setError, setSuccess } = useApiState()
  const modelStore = useModelStore()

  const images = ref([])
  const currentImage = ref(null)
  // 扇出出图的进度：要 4 张就是 4 次请求，节点上得让用户看见还差几张
  const progress = reactive({ done: 0, total: 0 })
  let abortController = null
  let generationVersion = 0

  /**
   * @param {Object} params { model, prompt, size, n|count, image }
   * @param {Object} [requestOptions] { providerId, capability, signal, onProgress }
   * @returns {Promise<Array<{url:string, revisedPrompt:string}>>}
   */
  const generate = async (params = {}, requestOptions = {}) => {
    const runVersion = ++generationVersion
    setLoading(true)
    images.value = []
    currentImage.value = null
    progress.done = 0
    progress.total = Math.max(1, Math.floor(Number(params.n || params.count || 1) || 1))
    abortController = requestOptions.signal ? null : new AbortController()

    try {
      const upstream = resolveUpstreamOrThrow(
        modelStore,
        requestOptions.providerId || params.providerId
      )
      const modelConfig = getModelByName(params.model)
      const referenceImages = Array.isArray(params.image)
        ? params.image
        : (params.image ? [params.image] : [])

      const requestData = {
        model: params.model,
        prompt: params.prompt,
        size: params.size !== undefined ? params.size : (modelConfig?.defaultParams?.size || ''),
        resolution: params.resolution || modelConfig?.defaultParams?.resolution || '',
        n: progress.total
      }
      if (referenceImages.length) requestData.image = referenceImages

      // 渠道级字段适配（保留厂商特例），随后由 api/image 归一化并分流协议
      const adapted = adaptRequestFor(upstream.providerConfig, 'image', requestData)

      // 有参考图时若渠道未声明图片能力，仍按 image-edit 走，交给网关用默认端点
      const capability = referenceImages.length ? 'image-edit' : 'image'

      const result = await generateImage({ ...adapted, n: progress.total }, {
        upstream,
        capability,
        signal: requestOptions.signal || abortController?.signal,
        onProgress: (done, total) => {
          progress.done = done
          progress.total = total
          requestOptions.onProgress?.(done, total)
        },
        // 扇出时部分请求失败：结果照收，失败原因交给节点去说
        onPartialFailure: errors => requestOptions.onPartialFailure?.(errors),
        onImage: (items, index) => requestOptions.onImage?.(items, index)
      })

      if (runVersion !== generationVersion) {
        const abortError = new Error('已取消生成')
        abortError.name = 'AbortError'
        throw abortError
      }

      images.value = result
      currentImage.value = result[0] || null
      setSuccess()
      return result
    } catch (err) {
      if (err?.name === 'AbortError') {
        reset()
        throw err
      }
      setError(err)
      throw err
    } finally {
      if (runVersion === generationVersion) abortController = null
    }
  }

  const stop = () => {
    generationVersion += 1
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    progress.done = 0
    progress.total = 0
    reset()
  }

  return { loading, error, status, images, currentImage, progress, generate, stop, reset }
}

/**
 * Video generation composable | 视频生成组合式函数
 *
 * 异步任务模型：创建任务 → 按 taskId 轮询。
 * 完成判定改用统一状态机（utils/resultParser），只在状态成功或拿到视频地址时结束。
 */
export const useVideoGeneration = () => {
  const { loading, error, status, reset, setLoading, setError, setSuccess } = useApiState()
  const modelStore = useModelStore()

  const video = ref(null)
  const taskId = ref(null)
  const progress = reactive({
    attempt: 0,
    maxAttempts: 180,
    percentage: 0
  })

  /**
   * 仅创建视频任务（不轮询）
   * @param {Object} params { model, prompt, first_frame_image, last_frame_image, ratio, dur, resolution }
   * @param {Object} [requestOptions] { providerId }
   * @returns {Promise<{taskId:string|null, url:string}>}
   */
  const createVideoTaskOnly = async (params = {}, requestOptions = {}) => {
    const upstream = resolveUpstreamOrThrow(
      modelStore,
      requestOptions.providerId || params.providerId
    )

    const requestData = {
      model: params.model,
      prompt: params.prompt || ''
    }
    // 首尾帧可能是 blob: / 本地路径（本地上传的图片在项目重载后会变成 blob:），
    // 厂商取不到这种地址，必须在适配前先转成 data URL
    if (params.first_frame_image) {
      requestData.first_frame_image = await toTransportableReferenceImage(params.first_frame_image)
    }
    if (params.last_frame_image) {
      requestData.last_frame_image = await toTransportableReferenceImage(params.last_frame_image)
    }
    if (params.ratio) requestData.size = params.ratio
    if (params.dur) requestData.seconds = params.dur
    if (params.resolution) requestData.resolution = params.resolution

    const adapted = adaptRequestFor(upstream.providerConfig, 'video', requestData)
    return createVideoTask(adapted, { upstream, signal: requestOptions.signal })
  }

  /**
   * 轮询视频任务。
   * 兼容旧签名 pollVideoTask(taskId, onProgress)。
   */
  const pollVideoTask = async (pollTaskId, onProgressOrOptions = {}, legacyOptions = {}) => {
    const options = typeof onProgressOrOptions === 'function'
      ? { ...legacyOptions, onProgress: onProgressOrOptions }
      : onProgressOrOptions

    const upstream = resolveUpstreamOrThrow(modelStore, options.providerId || legacyOptions.providerId)

    return pollVideoTaskRequest(pollTaskId, {
      upstream,
      signal: options.signal,
      intervalMs: options.intervalMs,
      maxAttempts: options.maxAttempts,
      onProgress: (attempt, percentage, task) => {
        progress.attempt = attempt
        progress.percentage = percentage
        options.onProgress?.(attempt, percentage, task)
      }
    })
  }

  /**
   * 生成视频（创建 + 轮询）
   * @returns {Promise<{url:string, progress:number, taskId:string}>}
   */
  const generate = async (params = {}, requestOptions = {}) => {
    setLoading(true)
    video.value = null
    taskId.value = null
    progress.attempt = 0
    progress.percentage = 0

    try {
      const { taskId: newTaskId, url } = await createVideoTaskOnly(params, requestOptions)

      if (url) {
        video.value = { url, progress: 100 }
        setSuccess()
        return video.value
      }

      taskId.value = newTaskId
      status.value = 'polling'

      const result = await pollVideoTask(newTaskId, {
        providerId: requestOptions.providerId || params.providerId,
        signal: requestOptions.signal,
        onProgress: requestOptions.onProgress
      })

      video.value = result
      setSuccess()
      return result
    } catch (err) {
      setError(err)
      throw err
    }
  }

  return {
    loading,
    error,
    status,
    video,
    taskId,
    progress,
    generate,
    reset,
    createVideoTaskOnly,
    pollVideoTask
  }
}

/**
 * Combined API composable | 综合 API 组合式函数
 */
export const useApi = () => {
  const chat = useChat()
  const image = useImageGeneration()
  const videoGen = useVideoGeneration()

  return { chat, image, video: videoGen }
}
