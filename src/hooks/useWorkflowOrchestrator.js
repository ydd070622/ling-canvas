import { ref, watch } from 'vue'
import { streamChatCompletions } from '@/api'
import { addEdge, addNode, nodes, startBatchOperation, endBatchOperation, updateNode } from '@/stores/canvas'
import { getConnectionSemantics } from '@/config/nodeRegistry'

const WORKFLOW_TYPES = Object.freeze({
  TEXT_TO_IMAGE: 'text_to_image',
  TEXT_TO_IMAGE_TO_VIDEO: 'text_to_image_to_video',
  STORYBOARD: 'storyboard',
  MULTI_ANGLE_STORYBOARD: 'multi_angle_storyboard',
  PICTURE_BOOK: 'picture_book'
})

const MULTI_ANGLE_PROMPTS = Object.freeze({
  front: { label: '正视图', prompt: value => `${value}\n正面视角，角色设定图，保持身份、服装与比例一致。` },
  side: { label: '侧视图', prompt: value => `${value}\n侧面视角，角色设定图，保持身份、服装与比例一致。` },
  back: { label: '后视图', prompt: value => `${value}\n背面视角，角色设定图，保持身份、服装与比例一致。` },
  top: { label: '俯视图', prompt: value => `${value}\n俯视视角，角色设定图，保持身份、服装与比例一致。` }
})

const INTENT_ANALYSIS_PROMPT = `你是 AI 创作画布的工作流规划器。仅返回 JSON，不要 Markdown。
支持 workflow_type: text_to_image, text_to_image_to_video, storyboard, multi_angle_storyboard, picture_book。
返回可能字段：image_prompt、video_prompt、character、shots、multi_angle、picture_book、description。
shots 为 [{title,prompt}]。当信息不足时选择 text_to_image，并保留用户原意。`

const createFlowEdge = (source, target, sourceType, targetType, targetHandle = 'left', order = 1) => {
  const semantics = getConnectionSemantics(sourceType, targetType, targetHandle)
  if (!semantics) throw new Error(`不支持的工作流连接：${sourceType} → ${targetType}.${targetHandle}`)
  return addEdge({
    source,
    target,
    sourceHandle: 'right',
    targetHandle,
    type: 'flowEdge',
    data: { ...semantics, order }
  })
}

export const useWorkflowOrchestrator = () => {
  const isAnalyzing = ref(false)
  const isExecuting = ref(false)
  const currentStep = ref(0)
  const totalSteps = ref(0)
  const executionLog = ref([])
  const activeWatchers = new Set()

  const addLog = (type, message) => {
    executionLog.value.push({ type, message, timestamp: Date.now() })
  }

  const clearWatchers = () => {
    activeWatchers.forEach(stop => stop())
    activeWatchers.clear()
  }

  const waitForNodeReady = (nodeId, timeoutMs = 5 * 60 * 1000) => new Promise((resolve, reject) => {
    let stop = null
    const finish = (callback, value) => {
      clearTimeout(timeout)
      if (stop) {
        stop()
        activeWatchers.delete(stop)
      }
      callback(value)
    }
    const inspect = node => {
      if (node?.data?.error) {
        finish(reject, new Error(node.data.error))
        return true
      }
      if (node?.data?.url && !node.data.loading) {
        finish(resolve, node)
        return true
      }
      return false
    }
    const timeout = setTimeout(() => finish(reject, new Error('节点执行超时')), timeoutMs)
    if (inspect(nodes.value.find(node => node.id === nodeId))) return
    stop = watch(() => nodes.value.find(node => node.id === nodeId), inspect, { deep: true })
    activeWatchers.add(stop)
  })

  const analyzeIntent = async userInput => {
    isAnalyzing.value = true
    try {
      let response = ''
      for await (const chunk of streamChatCompletions({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: INTENT_ANALYSIS_PROMPT },
          { role: 'user', content: userInput }
        ]
      })) response += chunk
      const json = response.match(/\{[\s\S]*\}/)?.[0]
      return json ? JSON.parse(json) : { workflow_type: WORKFLOW_TYPES.TEXT_TO_IMAGE, image_prompt: userInput }
    } catch (error) {
      addLog('error', `意图分析失败：${error.message}`)
      return { workflow_type: WORKFLOW_TYPES.TEXT_TO_IMAGE, image_prompt: userInput }
    } finally {
      isAnalyzing.value = false
    }
  }

  const createTextToImageWorkflow = (prompt, position) => {
    startBatchOperation()
    const textNodeId = addNode('text', position, { label: '图片提示词', content: prompt })
    const imageNodeId = addNode('image', { x: position.x + 460, y: position.y }, {
      label: '图片',
      autoExecute: true
    })
    createFlowEdge(textNodeId, imageNodeId, 'text', 'image')
    endBatchOperation()
    addLog('success', '已创建文生图工作流')
    return { textNodeId, imageNodeId }
  }

  const createTextToImageToVideoWorkflow = async (imagePrompt, videoPrompt, position) => {
    startBatchOperation()
    const imageTextId = addNode('text', position, { label: '图片提示词', content: imagePrompt })
    const imageNodeId = addNode('image', { x: position.x + 460, y: position.y }, { label: '图片', autoExecute: true })
    const videoTextId = addNode('text', { x: position.x + 460, y: position.y + 340 }, { label: '视频描述', content: videoPrompt })
    const videoNodeId = addNode('video', { x: position.x + 980, y: position.y }, { label: '视频' })
    createFlowEdge(imageTextId, imageNodeId, 'text', 'image')
    createFlowEdge(imageNodeId, videoNodeId, 'image', 'video', 'first-frame')
    createFlowEdge(videoTextId, videoNodeId, 'text', 'video', 'prompt')
    endBatchOperation()

    await waitForNodeReady(imageNodeId)
    updateNode(videoNodeId, { autoExecute: true })
    addLog('success', '图片已完成，开始生成视频')
    return { imageTextId, imageNodeId, videoTextId, videoNodeId }
  }

  const createStoryboardWorkflow = async (character, shots = [], position) => {
    const characterDescription = character?.description || character?.name || '主角角色设定'
    startBatchOperation()
    const characterTextId = addNode('text', position, { label: '角色设定', content: characterDescription })
    const characterImageId = addNode('image', { x: position.x + 460, y: position.y }, { label: '角色参考图', autoExecute: true })
    createFlowEdge(characterTextId, characterImageId, 'text', 'image')
    endBatchOperation()
    await waitForNodeReady(characterImageId)

    const createdShots = []
    shots.forEach((shot, index) => {
      const y = position.y + (index + 1) * 360
      startBatchOperation()
      const textId = addNode('text', { x: position.x, y }, { label: `分镜${index + 1}：${shot.title || ''}`, content: shot.prompt || '' })
      const imageId = addNode('image', { x: position.x + 460, y }, { label: `分镜${index + 1}`, autoExecute: true })
      createFlowEdge(textId, imageId, 'text', 'image')
      createFlowEdge(characterImageId, imageId, 'image', 'image', 'left', 2)
      endBatchOperation()
      createdShots.push({ textId, imageId })
    })
    return { characterTextId, characterImageId, shots: createdShots }
  }

  const createMultiAngleStoryboard = (description, position) => {
    startBatchOperation()
    const sourceImageId = addNode('image', position, { label: '主角色图（请上传）' })
    const angles = Object.entries(MULTI_ANGLE_PROMPTS).map(([key, config], index) => {
      const y = position.y + index * 350
      const textId = addNode('text', { x: position.x + 500, y }, { label: `${config.label}提示词`, content: config.prompt(description) })
      const imageId = addNode('image', { x: position.x + 960, y }, { label: config.label })
      createFlowEdge(textId, imageId, 'text', 'image')
      createFlowEdge(sourceImageId, imageId, 'image', 'image', 'left', 2)
      return { key, textId, imageId }
    })
    endBatchOperation()
    addLog('info', '请上传主角色图，然后在各角度图片节点中生成')
    return { sourceImageId, angles }
  }

  const createPictureBookWorkflow = async (pictureBook = {}, position) => {
    const character = pictureBook.character || {}
    const result = await createStoryboardWorkflow(character, (pictureBook.pages || []).map(page => ({
      title: `第${page.page_number || ''}页`,
      prompt: page.illustration_prompt || page.story_text || ''
    })), position)
    result.title = pictureBook.title
    return result
  }

  const executeWorkflow = async (params, position) => {
    isExecuting.value = true
    executionLog.value = []
    currentStep.value = 1
    totalSteps.value = 1
    clearWatchers()
    try {
      switch (params.workflow_type) {
        case WORKFLOW_TYPES.TEXT_TO_IMAGE_TO_VIDEO:
          return await createTextToImageToVideoWorkflow(params.image_prompt, params.video_prompt, position)
        case WORKFLOW_TYPES.STORYBOARD:
          return await createStoryboardWorkflow(params.character, params.shots, position)
        case WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD:
          return createMultiAngleStoryboard(params.multi_angle?.character_description || params.image_prompt || '', position)
        case WORKFLOW_TYPES.PICTURE_BOOK:
          return await createPictureBookWorkflow(params.picture_book, position)
        default:
          return createTextToImageWorkflow(params.image_prompt || '', position)
      }
    } finally {
      isExecuting.value = false
      clearWatchers()
    }
  }

  const reset = () => {
    isAnalyzing.value = false
    isExecuting.value = false
    currentStep.value = 0
    totalSteps.value = 0
    executionLog.value = []
    clearWatchers()
  }

  return {
    isAnalyzing,
    isExecuting,
    currentStep,
    totalSteps,
    executionLog,
    analyzeIntent,
    executeWorkflow,
    createTextToImageWorkflow,
    createMultiAngleStoryboard,
    reset,
    WORKFLOW_TYPES,
    MULTI_ANGLE_PROMPTS
  }
}

export default useWorkflowOrchestrator
