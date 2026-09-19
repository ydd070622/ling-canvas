<template>
  <!-- 视频节点：生成模式决定上游素材的语义（首帧 / 尾帧 / 参考），
       不再有多个物理端口 —— 所有上游都接左侧那一个口。 -->
  <NodeFrame
    :node-id="id"
    tone="video"
    :title="data.label || '视频'"
    :focused="focused"
    :multi="multi"
    :card-width="cardWidth"
    :status-text="statusText"
    :status-class="statusClass"
    :notices="notices"
    :failed="!!data.error"
    :fail-text="data.error || ''"
    uploadable
    viewable
    media-kind="video"
    :media-url="data.url || ''"
    @remove="remove"
    @duplicate="duplicateAndRefresh"
    @view="openPreview"
    @upload="triggerFileInput"
    @drop-file="handleDroppedFile"
    @notice-action="handleNoticeAction"
  >
    <template #body>
      <NodeMedia
        tone="video"
        :url="data.url"
        :loading="data.loading || !!data.taskId"
        :loading-text="data.taskId ? `创作中… ${data.progress || 0}%` : '任务创建中…'"
        @upload="triggerFileInput"
        @pick-asset="openAssetPicker"
        @preview="openPreview"
        :ratio="configuredRatio"
        @ratio="onMediaRatio"
      />
    </template>
  </NodeFrame>

  <input ref="fileInputRef" type="file" accept="video/*" style="display: none" @change="handleFileSelect" />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NodeFrame } from './base'
import NodeMedia from './base/NodeMedia.vue'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useFocusExpanded, useMultiSelected } from '../../composables/useFocusMode'
import { useNodeRunBridge } from '../../composables/useNodeRunBridge'
import { openMediaViewer } from '../../composables/useMediaViewer'
import { useVideoGeneration } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import {
  updateNode, editNode, editField, dropOrphanRefs, setNodeMedia,
  duplicateNode, removeNode
} from '../../stores/canvas'
import { makeToken, refKey } from '../../utils/promptRefs'
import { buildNodeNotices } from '../../utils/nodeNotices'
import { cardWidthForRatio, ratioValue } from '../../utils/ratio'
import { isLikelyTextModel, enrichModelError } from '../../composables/useModelGuard'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const {
  refs, candidates, firstFrame, lastFrame, buildPrompt, check, inboundCount
} = useNodeRefs(props.id)

const focused = useFocusExpanded(props.id)
const multi = useMultiSelected(props.id)

/** 同图片节点：有素材按素材，没素材按配置的出图比例 */
const mediaRatio = ref(0)
const configuredRatio = computed(() => (props.data?.ratio ? ratioValue(String(props.data.ratio)) : 0))
const effectiveRatio = computed(() => mediaRatio.value || configuredRatio.value)
const cardWidth = computed(() => cardWidthForRatio(effectiveRatio.value))
const onMediaRatio = (value) => { mediaRatio.value = value }

const fileInputRef = ref(null)
const isPolling = ref(false)
const modelStore = useModelStore()
const { loading: generating, generate, pollVideoTask } = useVideoGeneration()

/* ------------------------------------------------------------ 模型与渠道 */
const modelSelectOptions = computed(() => modelStore.groupedVideoModelOptions || [])
const selectedModel = computed(() => {
  const options = modelSelectOptions.value
  const configuredKeys = new Set(options.map(option => option.value))
  if (configuredKeys.has(props.data?.model)) return props.data.model
  if (configuredKeys.has(modelStore.selectedVideoModel)) return modelStore.selectedVideoModel
  return options[0]?.value || ''
})
const selectedModelOption = computed(() => modelSelectOptions.value.find(o => o.value === selectedModel.value))
const providerId = computed(() => (
  modelStore.resolveModelSourceProvider(selectedModel.value, 'VIDEO')
  || selectedModelOption.value?.sourceProvider
  || ''
))
const providerLabel = computed(() => (
  providerId.value ? (modelStore.getProviderConfigById(providerId.value)?.label || providerId.value) : ''
))
const hasProviderKey = computed(() => Boolean(providerId.value) && Boolean(modelStore.getApiKeyByProvider(providerId.value)))
const currentModel = computed(() =>
  modelStore.availableVideoModels.find(m => m.key === selectedModel.value) || modelStore.getVideoModel(selectedModel.value))
const effectiveModel = computed(() => selectedModel.value)
// 模型写回：卡片的模型/清晰度控件已经撤掉（参数统一在底部 composer），
// 节点仍要记住自己该用哪个模型
watch(selectedModel, (value) => {
  if ((props.data?.model || '') !== value) updateNode(props.id, { model: value })
}, { immediate: true })

/* ---------------------------------------------------------------- 模式
   模式选单已从卡片上撤掉：改由实际连上来的上游推断（见 config/nodeRegistry 的
   inferModeKey）。一图 → 图生视频，两图 → 首尾帧，多图 → 图片参考。 */

/* ------------------------------------------------------------ 状态与提示 */
const statusText = computed(() => {
  if (props.data?.taskId) return `创作中 ${props.data?.progress || 0}%`
  if (generating.value || isPolling.value) return '提交中…'
  if (props.data?.error) return '失败'
  return props.data?.url ? '已就绪' : '待生成'
})
const statusClass = computed(() => {
  if (generating.value || isPolling.value || props.data?.taskId) return 'is-busy'
  if (props.data?.error) return 'is-fail'
  return props.data?.url ? 'is-ok' : ''
})

const notices = computed(() => buildNodeNotices(props.data))

/* ---------------------------------------------------------- 任务续跑 */
const startPolling = async (taskId) => {
  if (isPolling.value) return
  isPolling.value = true
  try {
    const result = await pollVideoTask(taskId, {
      providerId: providerId.value,
      onProgress: (attempt, percentage) => { updateNode(props.id, { progress: percentage, attempt }) }
    })
    updateNode(props.id, { url: result.url, loading: false, progress: 100, taskId: null })
  } catch (err) {
    updateNode(props.id, { loading: false, error: err.message || '生成失败', taskId: null, errorKind: '' })
    window.$message?.error(err.message || '视频生成失败')
  } finally {
    isPolling.value = false
  }
}

watch(() => props.data?.taskId, (taskId) => {
  if (taskId && !props.data?.url && !isPolling.value) startPolling(taskId)
})
onMounted(() => {
  const { taskId, url } = props.data || {}
  if (taskId && !url && !isPolling.value) startPolling(taskId)
})
onBeforeUnmount(() => { isPolling.value = false })

/* ------------------------------------------------------------------ 上传 */
const triggerFileInput = () => fileInputRef.value?.click()
const handleFileSelect = (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (file) handleDroppedFile(file)
}
const handleDroppedFile = (file) => {
  if (!file.type.startsWith('video/')) {
    window.$message?.warning('视频节点只能放视频文件')
    return
  }
  const reader = new FileReader()
  reader.onload = (event) => setNodeMedia(props.id, {
    url: event.target.result,
    base64: event.target.result,
    fileName: file.name.replace(/\.[^.]+$/, '')
  })
  reader.onerror = () => window.$message?.error('视频读取失败')
  reader.readAsDataURL(file)
}
const openAssetPicker = () => window.dispatchEvent(new CustomEvent('ling-canvas:open-asset-picker', { detail: { nodeId: props.id } }))
const openPreview = () => openMediaViewer({ url: props.data.url, kind: 'video', alt: props.data.label })

/* ------------------------------------------------------------------ 生成 */
const handleNoticeAction = (act) => {
  if (act === 'update-run') handleSend()
  else if (act === 'drop-orphans') dropOrphanRefs(props.id)
  else if (act === 'run-anyway') handleSend(true)
}


const cancelGeneration = () => {
  updateNode(props.id, { loading: false, taskId: null, error: '' })
}

const handleSend = async (force = false) => {
  if (generating.value || isPolling.value) return

  const result = check()
  if (!result.ok) {
    updateNode(props.id, { error: result.message, errorKind: 'preflight', errorCode: result.code || '' })
    window.$message?.error(result.message)
    return
  }
  updateNode(props.id, { warn: null })

  if (!effectiveModel.value) {
    window.$message?.warning('请先前往设置，在模型配置中启用视频模型')
    return
  }
  if (!providerId.value) {
    window.$message?.warning('该模型未绑定供应商，请在设置中重新启用这个模型')
    return
  }
  if (!hasProviderKey.value) {
    window.$message?.warning(`请先在设置中为「${providerLabel.value}」配置 API Key`)
    return
  }

  try {
    const model = effectiveModel.value
    if (isLikelyTextModel(model)) {
      const label = modelStore.getChatModel?.(model)?.label || model
      window.$message?.warning(
        `「${label}」是文本模型，不能生成视频。请在设置中把视频模型切换为 Seedance 等，或改选其他供应商`
      )
      return
    }

    updateNode(props.id, { loading: true, error: '', model })
    const modelConfig = currentModel.value || modelStore.getVideoModel(model)
    const output = await generate({
      model,
      prompt: buildPrompt(),
      ratio: props.data?.ratio || '3:4',
      dur: Number(props.data?.duration || modelConfig?.defaultParams?.duration || 5),
      resolution: props.data?.resolution || modelConfig?.defaultResolution,
      // 首尾帧来自「生成模式」决定的槽位语义，不再是写死的端口
      first_frame_image: firstFrame.value || undefined,
      last_frame_image: lastFrame.value || undefined
    }, { providerId: providerId.value })

    if (!output?.url) throw new Error('接口未返回视频地址')
    updateNode(props.id, {
      url: output.url, loading: false, taskId: null, progress: 100, updatedAt: Date.now()
    })
  } catch (err) {
    updateNode(props.id, { loading: false, taskId: null, error: err.message || '视频生成失败', errorKind: '' })
    window.$message?.error(enrichModelError(err, props.data?.model || effectiveModel.value, providerLabel.value))
  }
}

// 生成按钮在底部 composer 上，通过窗口事件桥驱动本节点的生成 / 取消
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
