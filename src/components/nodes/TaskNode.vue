<template>
  <!-- AI 任务节点 | Generation entry
       把"生成"这件动作从内容节点上抽出来单独成卡：上游连进来的是素材，下游连出去的
       是产物。没有下游时按张数自动建输出节点，这样「描述一句话 → 出一组图」是一条
       连线都不用画的。

       内容态只留一段提示词（半透明块），展开后是表头 + 提示词 + 运行行。
       参数（产出类型 / 模型 / 比例 / 张数）都在底部 composer。 -->
  <NodeFrame
    :node-id="id"
    tone="task"
    :title="data.label || 'AI 任务'"
    :focused="focused"
    :multi="multi"
    :inbound-count="inboundCount"
    :status-text="statusText"
    :status-class="statusClass"
    :notices="notices"
    :failed="!!data.error"
    :fail-text="data.error || ''"
    editable
    @edit="focusComposer"
    @remove="remove"
    @duplicate="duplicateAndRefresh"
    @notice-action="handleNoticeAction"
  >
    <template #body>
      <div class="flow-task">
        <div class="flow-task-prompt">{{ data.prompt || '描述你希望 AI 如何处理上游内容…' }}</div>
      </div>
    </template>
  </NodeFrame>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NodeFrame } from './base'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useFocusExpanded, useMultiSelected } from '../../composables/useFocusMode'
import { useNodeRunBridge } from '../../composables/useNodeRunBridge'
import { useImageGeneration, useVideoGeneration, useChat } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import {
  nodes, edges, addNode, addEdge, updateNode, editNode, editField,
  dropOrphanRefs, duplicateNode, removeNode,
  startBatchOperation, endBatchOperation
} from '../../stores/canvas'
import { INPUT_HANDLE, OUTPUT_HANDLE, NODE_DEFINITIONS } from '../../config/nodeRegistry'
import { makeToken, refKey } from '../../utils/promptRefs'
import { buildNodeNotices } from '../../utils/nodeNotices'
import { normalizeRatioKey, findSizeByRatio, ratioDisplay } from '../../utils/ratio'
import { resolveImageTierOptions } from '../../utils/imageTiers'
import { isLikelyTextModel, enrichModelError } from '../../composables/useModelGuard'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const { refs, candidates, buildPrompt, check, referenceImages, firstFrame, lastFrame, inboundCount } = useNodeRefs(props.id)

const focused = useFocusExpanded(props.id)
const multi = useMultiSelected(props.id)

const modelStore = useModelStore()
const { loading: imageLoading, progress: imageProgress, generate: generateImage, stop: stopImage } = useImageGeneration()
const { loading: videoLoading, generate: generateVideo } = useVideoGeneration()
const { loading: chatLoading, send: sendChat } = useChat()

const generating = ref(false)
const busy = computed(() => generating.value || imageLoading.value || videoLoading.value || chatLoading.value)

/** 产出类型：图片 / 视频 / 文本 */
const targetType = computed(() => props.data?.targetType || 'image')
const targetLabel = computed(() => NODE_DEFINITIONS[targetType.value]?.label || '图片')

/* ------------------------------------------------------------ 模型与渠道 */
const modelKind = computed(() => (targetType.value === 'image' ? 'IMAGE' : targetType.value === 'video' ? 'VIDEO' : 'CHAT'))
const modelSelectOptions = computed(() => {
  if (targetType.value === 'image') return modelStore.groupedImageModelOptions || []
  if (targetType.value === 'video') return modelStore.groupedVideoModelOptions || []
  return modelStore.groupedChatModelOptions || []
})
const selectedModel = computed(() => {
  const options = modelSelectOptions.value
  const configuredKeys = new Set(options.map(option => option.value))
  if (configuredKeys.has(props.data?.model)) return props.data.model
  const fallback = targetType.value === 'image'
    ? modelStore.selectedImageModel
    : targetType.value === 'video' ? modelStore.selectedVideoModel : modelStore.selectedChatModel
  if (configuredKeys.has(fallback)) return fallback
  return options[0]?.value || ''
})
const selectedModelOption = computed(() => modelSelectOptions.value.find(o => o.value === selectedModel.value
  && o.sourceProvider === props.data?.sourceProvider) || modelSelectOptions.value.find(o => o.value === selectedModel.value))
const providerId = computed(() => (
  modelStore.resolveModelSourceProvider(selectedModel.value, modelKind.value, props.data?.sourceProvider)
  || selectedModelOption.value?.sourceProvider
  || ''
))
const providerLabel = computed(() => (
  providerId.value ? (modelStore.getProviderConfigById(providerId.value)?.label || providerId.value) : ''
))
const hasProviderKey = computed(() => Boolean(providerId.value) && Boolean(modelStore.getApiKeyByProvider(providerId.value)))
const currentModel = computed(() => targetType.value === 'video'
  ? modelStore.getVideoModel?.(selectedModel.value, providerId.value)
  : modelStore.getImageModel?.(selectedModel.value, providerId.value))

watch(selectedModel, (value) => {
  if (value && (props.data?.model || '') !== value) updateNode(props.id, { model: value })
}, { immediate: true })

/* ---------------------------------------------------------------- 尺寸 */
const resolutionOptions = computed(() => {
  const upstream = modelStore.resolveUpstreamContext(providerId.value)
  return resolveImageTierOptions({
    model: currentModel.value,
    modelKey: selectedModel.value,
    providerConfig: upstream.providerConfig,
    baseUrl: upstream.baseUrl
  }).map(value => ({ value, label: value }))
})
const selectedResolution = computed(() => {
  const available = resolutionOptions.value.map(item => item.value)
  const saved = String(props.data?.resolution || '').toUpperCase()
  return available.includes(saved) ? saved : (available[0] || '')
})
watch(selectedResolution, (value) => {
  if (value && props.data?.resolution !== value) updateNode(props.id, { resolution: value })
}, { immediate: true })

const selectedRatio = computed(() => {
  if (props.data?.size) return normalizeRatioKey(props.data.size)
  if (props.data?.ratio) return String(props.data.ratio)
  return 'auto'
})
const selectedRatioLabel = computed(() => (
  selectedRatio.value === 'auto' ? '自适应' : ratioDisplay(selectedRatio.value, { keepColon: true })))
/* ------------------------------------------------------------ 状态与提示 */
const statusText = computed(() => {
  if (busy.value) {
    // 图片任务要多张时是并发 N 次请求，进度比「生成中…」有意义
    return imageProgress.total > 1 ? `生成中 ${imageProgress.done}/${imageProgress.total}` : '生成中…'
  }
  if (props.data?.error) return '失败'
  return inboundCount.value ? '已就绪' : '未接入'
})
const statusClass = computed(() => {
  if (busy.value) return 'is-busy'
  if (props.data?.error) return 'is-fail'
  return inboundCount.value ? 'is-ok' : ''
})

const runStatus = computed(() => {
  if (busy.value) return '生成中…'
  if (props.data?.error) return '上次失败'
  return inboundCount.value ? `已接入 ${inboundCount.value} 个上游` : '未接入上游'
})

const notices = computed(() => buildNodeNotices(props.data))

/* ------------------------------------------------------------------ 编辑 */
/** 工具栏上的「编辑」：让底部的输入框接管这个节点的提示词 */
const focusComposer = () => {
  window.dispatchEvent(new CustomEvent('ling-canvas:focus-composer', { detail: { nodeId: props.id } }))
}

const handleNoticeAction = (act) => {
  if (act === 'update-run') handleSend()
  else if (act === 'drop-orphans') dropOrphanRefs(props.id)
  else if (act === 'run-anyway') handleSend(true)
}


/* ------------------------------------------------------------------ 生成 */
/** 本任务的下游输出节点，按连入顺序；只有类型对得上的才算 */
const outputTargets = () => edges.value
  .filter(edge => edge.source === props.id)
  .sort((a, b) => (Number(a.data?.order) || 0) - (Number(b.data?.order) || 0))
  .map(edge => nodes.value.find(node => node.id === edge.target))
  .filter(node => node && node.type === targetType.value)

/** 没有下游就自己建：与 composer「一句话出一组图」是同一套行为（图片只要 1 个出口，见 handleSend） */
const ensureOutputs = (count) => {
  let existing = outputTargets()
  if (existing.length) return existing

  const node = nodes.value.find(item => item.id === props.id)
  const width = node?.measured?.width || 320
  startBatchOperation()
  existing = Array.from({ length: count }, (_, index) => {
    const id = addNode(targetType.value, {
      x: (node?.position?.x || 0) + width + 110,
      y: (node?.position?.y || 0) + index * 300
    }, { label: targetLabel.value })
    addEdge({
      source: props.id,
      target: id,
      sourceHandle: OUTPUT_HANDLE,
      targetHandle: INPUT_HANDLE,
      type: 'flowEdge',
      data: { order: index + 1 }
    })
    return nodes.value.find(item => item.id === id)
  }).filter(Boolean)
  endBatchOperation()
  return existing
}

const cancelGeneration = () => {
  stopImage()
  generating.value = false
  updateNode(props.id, { loading: false, error: '' })
}

/** 把产出逐个写进下游输出节点；结果数与落点数对不上时明确提示，不静默丢弃 */
const writeResults = (outputs, results, partialFailure = '') => {
  if (targetType.value === 'image') {
    writeImageResults(outputs, results, partialFailure)
    return
  }

  startBatchOperation()
  results.forEach((item, index) => {
    const target = outputs[index]
    if (!target) return
    if (item.text !== undefined) {
      updateNode(target.id, { content: item.text, loading: false, updatedAt: Date.now() })
    } else {
      updateNode(target.id, {
        url: item.url, loading: false, updatedAt: Date.now()
      })
    }
  })
  endBatchOperation()

  // 一个输出节点只接一个结果，多了没地方放 —— 但必须让用户知道，而不是悄悄扔掉
  if (results.length > outputs.length) {
    window.$message?.warning(`回来 ${results.length} 个结果，只有 ${outputs.length} 个输出节点，多出的没写入`)
  } else if (results.length < outputs.length && results.length) {
    window.$message?.warning(`回来 ${results.length} 个结果，有 ${outputs.length - results.length} 个输出节点没拿到内容`)
  }
}

/**
 * 图片落点。
 *
 * 一次出多张时**全进同一张卡的画廊**（一张卡装 N 张，与在画布上直接生成图片一致），
 * 所以图片默认只有一个下游。只有当用户自己连了多个图片节点时才退回「一个对一个」——
 * 那是他显式表达的「这几张要分开」，不该被一张卡吞掉。
 */
const writeImageResults = (outputs, results, partialFailure) => {
  const urls = results.map(item => item.url).filter(Boolean)
  startBatchOperation()
  if (outputs.length <= 1) {
    const target = outputs[0]
    if (target) {
      // galleryUrls 一并覆盖：上次多、这次少时旧的残余必须清掉，否则画廊里会留着上一批
      updateNode(target.id, {
        url: urls[0], galleryUrls: urls, mainImageIndex: 0, loading: false, updatedAt: Date.now()
      })
    }
  } else {
    outputs.forEach((target, index) => {
      const item = results[index]
      if (!target || !item) return
      updateNode(target.id, {
        url: item.url, galleryUrls: [], mainImageIndex: 0, loading: false, updatedAt: Date.now()
      })
    })
  }
  endBatchOperation()

  // 少回来几张必须说清原因 —— 只说「少了一张」等于没说
  const requested = Number(props.data?.count || 1)
  if (outputs.length <= 1 && requested > 1 && urls.length < requested) {
    window.$message?.warning(
      `要了 ${requested} 张，成功回来 ${urls.length} 张`
      + (partialFailure ? `。失败原因：${partialFailure}` : '')
    )
  }
}

const requireProvider = () => {
  if (!selectedModel.value) {
    window.$message?.warning(`请先前往设置，在模型配置中启用${targetLabel.value}模型`)
    return false
  }
  if (!providerId.value) {
    window.$message?.warning('该模型未绑定供应商，请在设置中重新启用这个模型')
    return false
  }
  if (!hasProviderKey.value) {
    window.$message?.warning(`请先在设置中为「${providerLabel.value}」配置 API Key`)
    return false
  }
  if (isLikelyTextModel(selectedModel.value) && targetType.value !== 'text') {
    window.$message?.warning(`「${selectedModel.value}」是文本模型，不能生成${targetLabel.value}`)
    return false
  }
  return true
}

const handleSend = async (force = false) => {
  if (busy.value) return

  const result = check()
  if (!result.ok) {
    updateNode(props.id, { error: result.message, errorKind: 'preflight', errorCode: result.code || '' })
    window.$message?.error(result.message)
    return
  }
  updateNode(props.id, { warn: null })

  if (!requireProvider()) return

  const count = Number(props.data?.count || 1)
  // 图片：一次出的多张全进同一张卡的画廊，所以只要一个下游输出节点。
  // 文本/视频一次就一个结果，本来就按张数建。
  const targets = ensureOutputs(targetType.value === 'image' ? 1 : count)
  const outputs = targets.length ? targets : [null]

  generating.value = true
  updateNode(props.id, { loading: true, error: '' })
  try {
    const prompt = buildPrompt()

    if (targetType.value === 'text') {
      const answer = await sendChat(prompt, true, { providerId: providerId.value })
      if (!answer) throw new Error('接口未返回文本')
      writeResults(outputs, [{ text: answer }])
    } else if (targetType.value === 'video') {
      const modelConfig = modelStore.getVideoModel(selectedModel.value)
      const output = await generateVideo({
        model: selectedModel.value,
        prompt,
        ratio: props.data?.ratio || '3:4',
        dur: Number(props.data?.duration || modelConfig?.defaultParams?.duration || 5),
        resolution: props.data?.resolution || modelConfig?.defaultResolution,
        first_frame_image: firstFrame.value || undefined,
        last_frame_image: lastFrame.value || undefined
      }, { providerId: providerId.value })
      if (!output?.url) throw new Error('接口未返回视频地址')
      writeResults(outputs, [{ url: output.url }])
    } else {
      // 扇出时部分请求失败，原因得留到最后那条提示里一起说 —— 只说「少了一张」等于没说
      let partialFailure = ''
      const generated = await generateImage({
        model: selectedModel.value,
        prompt,
        size: props.data?.size || (props.data?.ratio
          ? findSizeByRatio(currentModel.value?.sizes || [], props.data.ratio) || props.data.ratio
          : ''),
        resolution: selectedResolution.value,
        n: Math.max(count, outputs.length),
        image: referenceImages.value
      }, {
        providerId: providerId.value,
        onPartialFailure: (errors) => {
          partialFailure = errors.map(error => error?.message || String(error)).join('；')
        }
      })
      const results = (Array.isArray(generated) ? generated : []).filter(item => item?.url)
      if (!results.length) throw new Error('接口未返回图片地址')
      writeResults(outputs, results, partialFailure)
    }

    updateNode(props.id, { loading: false, updatedAt: Date.now() })
  } catch (err) {
    updateNode(props.id, { loading: false, error: err.message || '生成失败', errorKind: '' })
    window.$message?.error(enrichModelError(err, selectedModel.value, providerLabel.value))
  } finally {
    generating.value = false
  }
}

// 生成按钮在底部 composer 上，通过窗口事件桥驱动本任务的生成 / 取消
useNodeRunBridge(props.id, { run: () => handleSend(), cancel: cancelGeneration })

const duplicateAndRefresh = () => { duplicateNode(props.id) }
const remove = () => { removeNode(props.id)}

watch(
  () => props.data?.autoExecute,
  (shouldExecute) => {
    if (!shouldExecute) return
    updateNode(props.id, { autoExecute: false })
    handleSend()
  },
  { immediate: true }
)
</script>
