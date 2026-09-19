<template>
  <!-- 图片节点：承载图片 + 生成入口
       内容态只显示图片本身；选中后长出表头与底部一行（类型 + 尺寸 + 生成）。
       参数（模型 / 比例 / 张数）与提示词都在底部 composer，卡片上不放控件。 -->
  <NodeFrame
    :node-id="id"
    tone="image"
    :title="data.label || '图片'"
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
    @remove="remove"
    @duplicate="duplicateAndRefresh"
    @view="openPreview"
    @upload="triggerFileInput"
    @drop-file="handleDroppedFile"
    @notice-action="handleNoticeAction"
  >
    <template #body>
      <NodeMedia
        tone="image"
        :url="data.url"
        :loading="data.loading"
        :alt="data.label"
        @upload="triggerFileInput"
        @pick-asset="openAssetPicker"
        @preview="openPreview"
        :ratio="configuredRatio"
        @ratio="onMediaRatio"
      />
    </template>
  </NodeFrame>

  <input ref="fileInputRef" type="file" accept="image/*" style="display: none" @change="handleFileSelect" />
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NodeFrame } from './base'
import NodeMedia from './base/NodeMedia.vue'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useFocusExpanded, useMultiSelected } from '../../composables/useFocusMode'
import { useNodeRunBridge } from '../../composables/useNodeRunBridge'
import { openMediaViewer } from '../../composables/useMediaViewer'
import { useImageGeneration } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import {
  updateNode, editNode, editField, dropOrphanRefs, setNodeMedia,
  duplicateNode, removeNode
} from '../../stores/canvas'
import { normalizeRatioKey, findSizeByRatio, ratioDisplay } from '../../utils/ratio'
import { isLikelyTextModel, enrichModelError } from '../../composables/useModelGuard'
import { buildNodeNotices } from '../../utils/nodeNotices'
import { makeToken, refKey } from '../../utils/promptRefs'
import { cardWidthForRatio, ratioValue } from '../../utils/ratio'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const {
  refs, candidates, referenceImages, buildPrompt, check, inboundCount
} = useNodeRefs(props.id)

/* 展开与否由选中状态决定：恰好选中这一个才长出完整 chrome */
const focused = useFocusExpanded(props.id)
const multi = useMultiSelected(props.id)

/**
 * 卡片与媒体的比例：**有素材就按素材，没素材就按节点上配置的出图比例**。
 * 新建的空节点默认 4:3；在底部把比例改成 3:4 之后，空节点当场就变成 3:4，
 * 不用等生成出来才看到形状。
 */
const mediaRatio = ref(0)
const configuredRatio = computed(() => {
  if (props.data?.size) return ratioValue(normalizeRatioKey(props.data.size))
  if (props.data?.ratio) return ratioValue(String(props.data.ratio))
  return 0
})
const effectiveRatio = computed(() => mediaRatio.value || configuredRatio.value)
const cardWidth = computed(() => cardWidthForRatio(effectiveRatio.value))
const onMediaRatio = (value) => { mediaRatio.value = value }

const fileInputRef = ref(null)
const modelStore = useModelStore()
const { loading: generating, generate, stop: stopGeneration } = useImageGeneration()

const isGenerating = computed(() => generating.value || props.data?.loading === true)

/* ------------------------------------------------------------ 模型与渠道 */
const modelSelectOptions = computed(() => modelStore.groupedImageModelOptions || [])
const selectedModel = computed(() => {
  const options = modelSelectOptions.value
  const configuredKeys = new Set(options.map(option => option.value))
  if (configuredKeys.has(props.data?.model)) return props.data.model
  if (configuredKeys.has(modelStore.selectedImageModel)) return modelStore.selectedImageModel
  return options[0]?.value || ''
})
const selectedModelOption = computed(() => modelSelectOptions.value.find(o => o.value === selectedModel.value))
/** 本节点模型所属渠道：请求按该 provider 解析 Key / 端点 */
const providerId = computed(() => (
  modelStore.resolveModelSourceProvider(selectedModel.value, 'IMAGE')
  || selectedModelOption.value?.sourceProvider
  || ''
))
const providerLabel = computed(() => (
  providerId.value ? (modelStore.getProviderConfigById(providerId.value)?.label || providerId.value) : ''
))
const hasProviderKey = computed(() => Boolean(providerId.value) && Boolean(modelStore.getApiKeyByProvider(providerId.value)))
const currentModel = computed(() =>
  modelStore.availableImageModels.find(m => m.key === selectedModel.value) || modelStore.getImageModel(selectedModel.value))
const effectiveModel = computed(() => selectedModel.value)
const effectiveModelConfig = computed(() => modelStore.getImageModel(effectiveModel.value))
const selectedModelLabel = computed(() => selectedModelOption.value?.label || currentModel.value?.label || '请先配置图片模型')

// 模型写回：卡片的模型/比例/张数控件已经撤掉（参数统一在底部 composer），
// 但节点仍要记住自己该用哪个模型，否则生成时无从选择
watch(selectedModel, (value) => {
  if ((props.data?.model || '') !== value) updateNode(props.id, { model: value })
}, { immediate: true })

/* ---------------------------------------------------------------- 尺寸 */
const selectedSize = computed(() => {
  // 自适应时不发送 size，让上游模型自行决定；明确选择比例时再映射模型尺寸。
  if (props.data?.size) return props.data.size
  if (props.data?.ratio) return findSizeByRatio(effectiveModelConfig.value?.sizes || [], props.data.ratio) || props.data.ratio
  return ''
})
const resolutionOptions = computed(() => {
  const declared = currentModel.value?.imageResolutions || currentModel.value?.resolutions
  const values = Array.isArray(declared) && declared.length
    ? declared
    : (/seedream/i.test(selectedModel.value) ? ['2K', '4K'] : ['1K', '2K', '4K'])
  return values.map(value => ({ value: String(value).toUpperCase(), label: String(value).toUpperCase() }))
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
  if (isGenerating.value) return props.data?.loading ? '生成中…' : '排队中…'
  if (props.data?.error) return '失败'
  return props.data?.url ? '已就绪' : '待生成'
})
const statusClass = computed(() => {
  if (isGenerating.value) return 'is-busy'
  if (props.data?.error) return 'is-fail'
  return props.data?.url ? 'is-ok' : ''
})

/** 卡片正文里的提示条：只留带修法按钮的那种失败，见 utils/nodeNotices.js */
const notices = computed(() => buildNodeNotices(props.data))

/* ------------------------------------------------------------------ 编辑 */

/* ------------------------------------------------------------------ 上传 */
const triggerFileInput = () => fileInputRef.value?.click()
const handleFileSelect = (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (file) handleDroppedFile(file)
}
const handleDroppedFile = (file) => {
  if (!file.type.startsWith('image/')) {
    window.$message?.warning('图片节点只能放图片文件')
    return
  }
  const reader = new FileReader()
  reader.onload = (event) => setNodeMedia(props.id, {
    url: event.target.result,
    base64: event.target.result,
    fileName: file.name.replace(/\.[^.]+$/, '')
  })
  reader.onerror = () => window.$message?.error('图片读取失败')
  reader.readAsDataURL(file)
}

const openPreview = () => openMediaViewer({ url: props.data.url, kind: 'image', alt: props.data.label })
const openAssetPicker = () => { window.dispatchEvent(new CustomEvent('ling-canvas:open-asset-picker', { detail: { nodeId: props.id } })) }

/* ------------------------------------------------------------------ 生成 */
/**
 * 每次发送自增。只有最后一次发送的收尾才有权改节点状态，
 * 否则被顶掉的旧请求回来时会把新请求的 loading 抹掉（或反过来留下僵尸态）。
 */
let sendSeq = 0

const handleNoticeAction = (act) => {
  if (act === 'update-run') handleSend()
  else if (act === 'drop-orphans') dropOrphanRefs(props.id)
  else if (act === 'run-anyway') handleSend(true)
}

const cancelGeneration = () => {
  // 递增序号：取消之后飞回来的旧请求无权再改这个节点的状态
  sendSeq += 1
  stopGeneration()
  updateNode(props.id, { loading: false, error: '' })
}

/** 生成请求要用的参数 */
const buildRequest = () => ({
  model: effectiveModel.value,
  prompt: buildPrompt(),
  size: selectedSize.value,
  resolution: selectedResolution.value,
  n: Number(props.data?.count || 1),
  image: referenceImages.value
})

const handleSend = async (force = false) => {
  if (isGenerating.value) return

  const result = check()
  if (!result.ok) {
    updateNode(props.id, { error: result.message, errorKind: 'preflight', errorCode: result.code || '' })
    window.$message?.error(result.message)
    return
  }
  updateNode(props.id, { warn: null })

  if (!effectiveModel.value) {
    window.$message?.warning('请先前往设置，在模型配置中启用图片模型')
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

  const seq = ++sendSeq
  try {
    const model = effectiveModel.value
    // 拦截对话模型误用（服务端只支持 imagen/banana/seedream 等）
    if (isLikelyTextModel(model)) {
      const label = modelStore.getChatModel?.(model)?.label || model
      window.$message?.warning(
        `「${label}」是文本模型，不能生成图片。请在设置中把图片模型切换为 Nano Banana、Seedream 等，或改选其他供应商`
      )
      return
    }

    updateNode(props.id, { loading: true, error: '', model, size: selectedSize.value || null, resolution: selectedResolution.value })
    // 正文里 @文本1 换成上游正文，@图片1 换成可读标记；参考图另走素材字段
    const generated = await generate(buildRequest(), { providerId: providerId.value })

    const results = Array.isArray(generated) ? generated : []
    const url = results[0]?.url
    if (!url) throw new Error('接口未返回图片地址')
    // 卡片只展示单图；多张 base64 不进节点 data，否则会撑爆 localStorage 配额
    updateNode(props.id, { url, loading: false, updatedAt: Date.now() })
    // 产出变了 → 下游失效
  } catch (err) {
    // 已经被更新的一次生成（或取消）接手，这次的结果无权改状态
    if (seq !== sendSeq) return
    if (err?.name === 'AbortError') {
      // 取消不报错，但 loading 必须落回去：早退会把节点永远留在「生成中」
      updateNode(props.id, { loading: false })
      return
    }
    updateNode(props.id, { loading: false, error: err.message || '图片生成失败', errorKind: '' })
    window.$message?.error(enrichModelError(err, props.data?.model || effectiveModel.value, providerLabel.value))
  }
}

// 生成按钮在底部 composer 上，通过窗口事件桥驱动本节点的生成 / 取消
useNodeRunBridge(props.id, { run: () => handleSend(), cancel: cancelGeneration })

const duplicateAndRefresh = () => {
  duplicateNode(props.id)
}

const remove = () => {
  removeNode(props.id)
}

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
