<template>
  <!-- 图片节点：生成模式 + 引用式正文 + 上传/预览 -->
  <NodeFrame
    :node-id="id"
    tone="image"
    :title="data.label || '图片'"
    :expanded="isExpanded"
    :prompt="data.prompt || ''"
    :refs="refs"
    :candidates="candidates"
    :inbound-count="inboundCount"
    placeholder="描述要生成的画面…  输入 @ 引用上游"
    :status-text="statusText"
    :status-class="statusClass"
    :notices="notices"
    :footer-note="footerNote"
    :busy="isGenerating"
    :stale="isStale"
    :failed="!!data.error"
    @send="handleSend()"
    @cancel="cancelGeneration"
    @remove="remove"
    @duplicate="duplicateAndRefresh"
    @toggle-collapse="toggleCollapse"
    @upload="triggerFileInput"
    @drop-file="handleDroppedFile"
    @update-prompt="handlePromptInput"
    @insert-ref="handleInsertRef"
    @notice-action="handleNoticeAction"
  >
    <template #body>
      <NodeMedia
        tone="image"
        :url="data.url"
        :loading="data.loading"
        :alt="data.label"
        :meta="mediaMeta"
        @upload="triggerFileInput"
        @pick-asset="openAssetPicker"
        @preview="openPreview"
      />
    </template>

    <template #meta>
      <FlowSelect
        class="is-mode"
        :options="modeOptions"
        :model-value="currentMode"
        :display="modeLabel"
        @update:model-value="handleModeChange"
      />
      <FlowSelect
        :options="modelSelectOptions"
        :model-value="selectedModel"
        :display="selectedModelLabel"
        dot="blue"
        empty-text="请先去设置配置图片模型"
        @update:model-value="handleModelChange"
      />
      <RatioPicker
        :model-value="selectedRatio"
        :display="selectedRatioLabel"
        :resolution-options="resolutionOptions"
        :selected-resolution="selectedResolution"
        @change="handleRatioChange"
        @update:resolution="handleResolutionChange"
      />
      <FlowSelect
        :options="countOptions"
        :model-value="String(data.count || 1)"
        :display="`x${data.count || 1}`"
        @update:model-value="handleCountChange"
      />
    </template>

    <template #peek>
      <div v-if="data.url" class="flow-peek-strip">
        <img class="flow-media-fill" :src="data.url" alt="" />
      </div>
      <div v-else class="flow-peek-empty">还没有产出</div>
    </template>
  </NodeFrame>

  <input ref="fileInputRef" type="file" accept="image/*" style="display: none" @change="handleFileSelect" />

  <!-- 大图预览 -->
  <Teleport to="body">
    <div v-if="previewOpen" class="image-lightbox" @click="previewOpen = false">
      <button class="lightbox-close" title="关闭" @click="previewOpen = false">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      <img :src="data.url" :alt="data.label || '图片预览'" @click.stop />
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NodeFrame } from './base'
import NodeMedia from './base/NodeMedia.vue'
import { FlowSelect, RatioPicker } from './base'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useImageGeneration } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import {
  updateNode, editNode, editField, clearStale, dropOrphanRefs, setNodeMedia,
  duplicateNode, removeNode, propagateStale, renumberNodeRefs
} from '../../stores/canvas'
import { normalizeRatioKey, findSizeByRatio, ratioDisplay } from '../../utils/ratio'
import { isLikelyTextModel, enrichModelError } from '../../composables/useModelGuard'
import { NODE_MODES, KIND_TITLE } from '../../config/nodeRegistry'
import { makeToken } from '../../utils/promptRefs'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const {
  refs, candidates, modeDef, referenceImages, buildPrompt, check, inboundCount
} = useNodeRefs(props.id)

const fileInputRef = ref(null)
const previewOpen = ref(false)
const modelStore = useModelStore()
const { loading: generating, generate, stop: stopGeneration } = useImageGeneration()

const isExpanded = computed(() => props.data?.expanded === true)
const isGenerating = computed(() => generating.value || props.data?.loading === true)
const isStale = computed(() => !!props.data?.stale?.is)

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

watch(selectedModel, (value) => {
  if ((props.data?.model || '') !== value) updateNode(props.id, { model: value })
}, { immediate: true })

/* ---------------------------------------------------------------- 模式 */
const modeOptions = computed(() => Object.entries(NODE_MODES.image).map(([value, def]) => ({
  value,
  label: def.label,
  note: Object.entries(def.accepts).map(([k, n]) => `${KIND_TITLE[k][0]}≤${n}`).join(' ')
})))
const currentMode = computed(() => modeDef.value ? props.data?.mode : 't2i')
const modeLabel = computed(() => modeDef.value?.label || '文生图')

const handleModeChange = (value) => {
  if (value === props.data?.mode) return
  editNode(props.id, { mode: value })
  renumberNodeRefs(props.id)
}

/* ---------------------------------------------------------------- 尺寸 */
const selectedSize = computed(() => {
  // 自适应时不发送 size，让上游模型自行决定；明确选择比例时再映射模型尺寸。
  if (props.data?.size) return props.data.size
  if (props.data?.ratio) return findSizeByRatio(effectiveModelConfig.value?.sizes || [], props.data.ratio) || props.data.ratio
  return ''
})
const countOptions = ['1', '2', '3', '4'].map(v => ({ value: v, label: `x${v}` }))
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
const handleRatioChange = (ratio) => {
  if (ratio === 'auto') { editNode(props.id, { size: null, ratio: null }); return }
  const matched = findSizeByRatio(effectiveModelConfig.value?.sizes || [], ratio)
  editNode(props.id, matched ? { size: matched, ratio: null } : { size: null, ratio })
}

const mediaMeta = computed(() => {
  if (!props.data?.url) return ''
  const size = selectedSize.value || selectedRatioLabel.value
  return `${size} · ${selectedResolution.value}`.trim()
})

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

const notices = computed(() => {
  const list = []
  if (isStale.value) {
    list.push({
      kind: 'stale',
      text: props.data.stale.reason === 'indirect' ? '间接上游已变更，建议重新生成。' : '上游数据已变更，建议重新生成。',
      actions: [{ act: 'update-run', label: '更新生成' }, { act: 'dismiss-stale', label: '关闭提示', ghost: true }]
    })
  }
  if (props.data?.error) {
    list.push({ kind: 'error', text: props.data.error, actions: [{ act: 'drop-orphans', label: '移除失效引用' }] })
  }
  if (props.data?.warn) {
    list.push({ kind: 'warn', text: props.data.warn.message, actions: props.data.warn.actions || [] })
  }
  return list
})

const footerNote = computed(() => {
  const inCount = inboundCount.value
  const used = refs.value.filter(r => r.status === 'ok').length
  return inCount ? `已连入 <b>${inCount}</b> 个上游 · 引用 <b>${used}</b> 个` : '未连接上游'
})

/* ------------------------------------------------------------------ 编辑 */
const handlePromptInput = (value) => editField(props.id, 'prompt', value)
const handleInsertRef = ({ key, edgeId }) => {
  editNode(props.id, { refBindings: { ...(props.data.refBindings || {}), [key]: edgeId }, warn: null })
}
const toggleCollapse = () => updateNode(props.id, { expanded: !isExpanded.value })
const handleCountChange = (value) => editNode(props.id, { count: Number(value) })
const handleResolutionChange = (value) => editNode(props.id, { resolution: value })
const handleModelChange = (value) => {
  const option = modelSelectOptions.value.find(item => item.value === value)
  if (option?.sourceProvider) modelStore.setProvider(option.sourceProvider)
  const model = modelStore.getImageModel(value)
  const declared = model?.imageResolutions || model?.resolutions
  const resolution = Array.isArray(declared) && declared.length
    ? String(declared[0]).toUpperCase()
    : (/seedream/i.test(value) ? '2K' : '1K')
  editNode(props.id, { model: value, size: null, ratio: null, resolution })
}

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

const openPreview = () => { if (props.data.url) previewOpen.value = true }
const openAssetPicker = () => { window.dispatchEvent(new CustomEvent('ling-canvas:open-asset-picker', { detail: { nodeId: props.id } })) }

/* ------------------------------------------------------------------ 生成 */
/**
 * 每次发送自增。只有最后一次发送的收尾才有权改节点状态，
 * 否则被顶掉的旧请求回来时会把新请求的 loading 抹掉（或反过来留下僵尸态）。
 */
let sendSeq = 0

const handleNoticeAction = (act) => {
  if (act === 'update-run') handleSend()
  else if (act === 'dismiss-stale') clearStale(props.id)
  else if (act === 'drop-orphans') dropOrphanRefs(props.id)
  else if (act === 'run-anyway') handleSend(true)
  else if (act === 'insert-ref') insertAllRefs()
}

const insertAllRefs = () => {
  const list = candidates.value
  if (!list.length) return
  const tokens = list.map(c => makeToken(c.kind, c.index))
  const bindings = { ...(props.data.refBindings || {}) }
  list.forEach((c) => { bindings[`${KIND_TITLE[c.kind]} ${c.index}`] = c.edgeId })
  editNode(props.id, {
    prompt: `${String(props.data.prompt || '').trim()} ${tokens.join(' ')}`.trim(),
    refBindings: bindings,
    warn: null
  })
}

const cancelGeneration = () => {
  // 递增序号：取消之后飞回来的旧请求无权再改这个节点的状态
  sendSeq += 1
  stopGeneration()
  updateNode(props.id, { loading: false, error: '' })
  window.$message?.info('已取消图片生成')
}

const handleSend = async (force = false) => {
  if (isGenerating.value) return

  const result = check()
  if (!result.ok) {
    updateNode(props.id, { error: result.message })
    window.$message?.error(result.message)
    return
  }
  if (result.warn === 'W_UNREF' && !force) {
    updateNode(props.id, { warn: { message: result.message, actions: result.actions } })
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
    // 正文里的 {{Text N}} 换成上游正文，{{Image N}} 换成可读标记；参考图另走素材字段
    const prompt = buildPrompt()
    const references = referenceImages.value
    const generated = await generate({
      model,
      prompt,
      size: selectedSize.value,
      resolution: selectedResolution.value,
      n: Number(props.data?.count || 1),
      image: references
    }, { providerId: providerId.value })

    const results = Array.isArray(generated) ? generated : []
    const url = results[0]?.url
    if (!url) throw new Error('接口未返回图片地址')
    // 卡片只展示单图；多张 base64 不进节点 data，否则会撑爆 localStorage 配额
    updateNode(props.id, { url, loading: false, stale: { is: false, reason: null, since: null }, updatedAt: Date.now() })
    window.$message?.success(results.length > 1 ? `已生成 ${results.length} 张图片` : '图片生成成功')
    // 产出变了 → 下游失效
    propagateStale(props.id)
  } catch (err) {
    // 已经被更新的一次生成（或取消）接手，这次的结果无权改状态
    if (seq !== sendSeq) return
    if (err?.name === 'AbortError') {
      // 取消不报错，但 loading 必须落回去：早退会把节点永远留在「生成中」
      updateNode(props.id, { loading: false })
      return
    }
    updateNode(props.id, { loading: false, error: err.message || '图片生成失败' })
    window.$message?.error(enrichModelError(err, props.data?.model || effectiveModel.value, providerLabel.value))
  }
}

const duplicateAndRefresh = () => {
  const newId = duplicateNode(props.id)
  if (newId) window.$message?.success('节点已复制')
}

const remove = () => {
  removeNode(props.id)
  window.$message?.success('节点已删除')
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

<style scoped>
.image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px;
  background: rgba(12, 12, 13, 0.82);
  cursor: zoom-out;
  backdrop-filter: blur(8px);
}
.image-lightbox img {
  display: block;
  max-width: min(92vw, 1600px);
  max-height: 86vh;
  border-radius: 8px;
  object-fit: contain;
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.48);
}
.lightbox-close {
  position: fixed;
  top: 22px;
  right: 24px;
  display: flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 50%;
  background: rgba(30, 30, 31, 0.7);
  color: #fff;
  cursor: pointer;
}
.lightbox-close:hover { background: rgba(62, 62, 64, 0.92); }
</style>
