<template>
  <!-- 图片节点：展开/收缩双态 + 上传/预览 + 参考图注入 -->
  <div
    class="flow-node-outer image-node"
    :class="{ 'flow-node-collapsed': !isExpanded, 'flow-node-has-media': Boolean(data.url) }"
  >
    <!-- 收缩态标签 -->
    <span v-if="!isExpanded" class="flow-collapsed-label">{{ data.label || '图片' }}</span>

    <!-- 药丸悬浮工具栏（仅展开） -->
    <NodeToolbar v-if="isExpanded">
      <div class="flow-tb-group">
        <button class="flow-tool-btn nodrag" title="上传" @click="triggerFileInput">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 15V4M8.5 7.5 12 4l3.5 3.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
        </button>
        <button class="flow-tool-btn nodrag" title="创建副本" @click="handleAction('duplicate')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/></svg>
        </button>
        <button class="flow-tool-btn nodrag" title="下载" @click="handleDownload">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 4v11M8.5 11.5 12 15l3.5-3.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
        </button>
      </div>
      <div class="flow-tb-sep"></div>
      <div class="flow-tb-group">
        <button class="flow-tool-btn nodrag" title="收缩" @click="collapse">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 21H3v-6M15 3h6v6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
        <button class="flow-tool-btn flow-tool-danger nodrag" title="删除" @click="handleAction('delete')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M10 4h4M6.5 7l.8 12.2a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L17.5 7"/></svg>
        </button>
      </div>
    </NodeToolbar>

    <!-- 卡片 -->
    <div class="flow-card image-card">
      <!-- 头部（仅展开） -->
      <div v-if="isExpanded" class="flow-card-head">
        <span class="flow-head-left"><span class="flow-head-dot flow-tone-image"></span><span class="flow-head-title">图片</span></span>
        <span class="flow-head-right">{{ data.url ? '已就绪' : '空' }}</span>
      </div>

      <!-- 内容区 -->
      <div class="flow-card-body">
        <!-- 加载中 -->
        <div v-if="data.loading" class="flow-image-dash" style="min-height:300px">
          <div class="loading-spinner"></div>
          <span class="loading-text">生成中...</span>
        </div>
        <!-- 错误 -->
        <div v-else-if="data.error" class="flow-image-dash" style="border-color:rgba(239,68,68,.4);min-height:300px">
          <span style="color:#ef4444;font-size:26px">✕</span>
          <span style="color:#ef4444;font-size:12px">{{ data.error }}</span>
        </div>
        <!-- 预览 -->
        <div
          v-else-if="data.url"
          class="flow-image-preview"
          :style="collapsedPreviewStyle"
          @dblclick.stop="openImagePreview"
          @click="handleBodyClick"
        >
          <img :src="data.url" :alt="data.label" @load="handleImageLoad" />
        </div>
        <!-- 上传空态 -->
        <div
          v-else
          class="flow-image-dash"
          @click="handleBodyClick"
          @dragover.prevent
          @drop.prevent="handleDrop"
        >
          <span class="flow-upload-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="1.6"/><path d="M21 15.5l-4.2-4.2a1.5 1.5 0 0 0-2.1 0L6 20"/></svg></span>
          <button v-if="isExpanded" class="flow-upload-pill nodrag" @click.stop="triggerFileInput">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 15V4M8.5 7.5 12 4l3.5 3.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>上传
          </button>
        </div>
      </div>

      <!-- 底部生成区（仅展开） -->
      <div v-if="isExpanded" class="flow-card-footer">
        <div class="flow-footer-row">
          <button class="flow-plus-btn nodrag" title="添加上游参考">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        <div class="flow-footer-row">
          <PromptEditor
            :model-value="data.prompt || ''"
            placeholder="描述要生成的画面..."
            @update:model-value="handlePromptInput"
          />
        </div>
        <div class="flow-footer-row">
          <FlowSelect
            :options="modelSelectOptions"
            :model-value="selectedModel"
            :display="selectedModelLabel"
            empty-text="请先去设置配置图片模型"
            dot="blue"
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
          <PromptPresetPicker @select="handlePresetSelect" />
          <span class="flow-footer-spacer"></span>
          <FlowSelect
            :options="countOptions"
            :model-value="String(data.count || 1)"
            :display="`x${data.count || 1}`"
            @update:model-value="handleCountChange"
          />
          <button
            class="flow-send-btn nodrag"
            :class="{ 'flow-send-cancel': isGenerating }"
            :title="isGenerating ? '取消生成' : '发送'"
            @click="handleGenerateAction"
          >
            <svg v-if="isGenerating" class="flow-stop-icon" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.1c.9-.4.9-1.2 0-1.6L3.4 3.6c-.8-.3-1.4.2-1.4 1L4 12l-2 7.4c0 .8.6 1.3 1.4 1z"/></svg>
          </button>
        </div>
      </div>

      <!-- 端口 -->
      <NodePort id="left" type="target" side="left" tone="image" :collapsed="!isExpanded" :node-id="id" />
      <NodePort id="right" type="source" side="right" tone="image" :collapsed="!isExpanded" :node-id="id" />
    </div>

    <!-- 隐藏文件输入 -->
    <input ref="fileInputRef" type="file" accept="image/*" style="display:none" @change="handleFileSelect" />

    <!-- 大图预览 -->
    <Teleport to="body">
      <div v-if="previewOpen" class="image-lightbox" @click="closeImagePreview">
        <button class="lightbox-close" title="关闭" @click="closeImagePreview">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <img :src="data.url" :alt="data.label || '图片预览'" @click.stop />
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { NodeToolbar, NodePort, FlowSelect, RatioPicker, PromptEditor, PromptPresetPicker } from './base'
import { useNodeActions } from '../../composables/useNodeActions'
import { useUpstreamInputs } from '../../composables/useUpstreamInputs'
import { useImageGeneration } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import { nodes } from '../../stores/canvas'
import { normalizeRatioKey, findSizeByRatio, ratioDisplay } from '../../utils/ratio'
import { isLikelyTextModel, enrichModelError } from '../../composables/useModelGuard'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const { duplicate, remove, update } = useNodeActions(props.id)
const { upstreamText, upstreamImages } = useUpstreamInputs(props.id)
const fileInputRef = ref(null)
const previewOpen = ref(false)
const modelStore = useModelStore()
const { loading: generating, generate, stop: stopGeneration } = useImageGeneration()

const modelSelectOptions = computed(() => modelStore.groupedImageModelOptions || [])
const selectedModel = computed(() => {
  const options = modelSelectOptions.value
  const configuredKeys = new Set(options.map(option => option.value))
  if (configuredKeys.has(props.data?.model)) return props.data.model
  if (configuredKeys.has(modelStore.selectedImageModel)) return modelStore.selectedImageModel
  return options[0]?.value || ''
})
const selectedModelOption = computed(() => modelSelectOptions.value.find(option => option.value === selectedModel.value))
/**
 * 本节点所用模型所属的渠道。
 * 生成请求按该 provider 解析 Key/Base URL/端点，因此同一画布上不同节点
 * 可以分属不同供应商而互不影响。
 */
const providerId = computed(() => (
  // 权威来源是按模型反查渠道；下拉选项（FlowSelect 形状）仅作兜底
  modelStore.resolveModelSourceProvider(selectedModel.value, 'IMAGE')
  || selectedModelOption.value?.sourceProvider
  || ''
))
const providerLabel = computed(() => (
  providerId.value
    ? (modelStore.getProviderConfigById(providerId.value)?.label || providerId.value)
    : ''
))
const hasProviderKey = computed(() => (
  Boolean(providerId.value) && Boolean(modelStore.getApiKeyByProvider(providerId.value))
))
const currentModel = computed(() =>
  modelStore.availableImageModels.find(model => model.key === selectedModel.value)
  || modelStore.getImageModel(selectedModel.value)
)
/** 仅使用设置中已启用的图片模型，不回退到内置模型。 */
const effectiveModel = computed(() => selectedModel.value)
/** 有效模型的完整配置（后端定义的 sizes / 默认参数） */
const effectiveModelConfig = computed(() => modelStore.getImageModel(effectiveModel.value))
const selectedModelLabel = computed(() => selectedModelOption.value?.label || currentModel.value?.label || '请先配置图片模型')
watch(selectedModel, value => {
  if ((props.data?.model || '') !== value) update({ model: value })
}, { immediate: true })
const selectedSize = computed(() => {
  // 自适应时不发送 size，让上游模型自行决定；明确选择比例时再映射模型尺寸。
  if (props.data?.size) return props.data.size
  if (props.data?.ratio) {
    const matched = findSizeByRatio(effectiveModelConfig.value?.sizes || [], props.data.ratio)
    return matched || props.data.ratio
  }
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
watch(selectedResolution, value => {
  if (value && props.data?.resolution !== value) update({ resolution: value })
}, { immediate: true })

/** 当前比例：‘auto’（自适应）或 '16:9' 等 | Current ratio value */
const selectedRatio = computed(() => {
  if (props.data?.size) return normalizeRatioKey(props.data.size)
  if (props.data?.ratio) return String(props.data.ratio)
  return 'auto'
})
const selectedRatioLabel = computed(() => {
  if (selectedRatio.value === 'auto') return '自适应'
  return ratioDisplay(selectedRatio.value, { keepColon: true })
})
/** 比例变更：优先映射到有效模型支持的尺寸；无匹配时存 ratio 由发送端回退 */
const handleRatioChange = (ratio) => {
  if (ratio === 'auto') {
    update({ size: null, ratio: null })
    return
  }
  const matched = findSizeByRatio(effectiveModelConfig.value?.sizes || [], ratio)
  if (matched) {
    update({ size: matched, ratio: null })
  } else {
    update({ size: null, ratio })
  }
}

const isExpanded = computed(() => props.data?.expanded === true)
const isGenerating = computed(() => generating.value || props.data?.loading === true)
const collapsedPreviewStyle = computed(() => (
  isExpanded.value
    ? undefined
    : { aspectRatio: String(props.data?.imageAspectRatio || '3 / 4') }
))

const handleImageLoad = event => {
  const image = event.currentTarget
  const ratio = image?.naturalWidth && image?.naturalHeight
    ? image.naturalWidth / image.naturalHeight
    : 0
  if (!ratio || Math.abs(Number(props.data?.imageAspectRatio || 0) - ratio) < 0.001) return
  update({ imageAspectRatio: ratio })
}

/** 收缩态点击 → 展开并选中；展开态空态点击 → 上传 | Expand on collapsed click, upload on expanded empty click */
const handleBodyClick = () => {
  if (!isExpanded.value) {
    update({ expanded: true })
    nodes.value = nodes.value.map(n => ({ ...n, selected: n.id === props.id }))
  } else if (!props.data?.url) {
    triggerFileInput()
  }
}

const triggerFileInput = () => fileInputRef.value?.click()
const handleFileSelect = (e) => {
  const file = e.target.files?.[0]
  if (file) uploadFile(file)
}
const handleDrop = (e) => {
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) uploadFile(file)
}
const uploadFile = (file) => {
  update({ loading: true, error: '' })
  const reader = new FileReader()
  reader.onload = (e) => update({ url: e.target.result, loading: false, fileName: file.name.replace(/\.[^.]+$/, '') })
  reader.onerror = () => update({ loading: false, error: '图片加载失败' })
  reader.readAsDataURL(file)
}

const openImagePreview = () => { if (props.data.url) previewOpen.value = true }
const closeImagePreview = () => { previewOpen.value = false }
const handlePreviewKeydown = (e) => { if (e.key === 'Escape' && previewOpen.value) closeImagePreview() }
onMounted(() => window.addEventListener('keydown', handlePreviewKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handlePreviewKeydown))

const handleDownload = () => {
  if (!props.data.url) return
  const link = document.createElement('a')
  link.href = props.data.url
  link.download = `${props.data.label || 'image'}.png`
  link.click()
}

const handlePromptInput = value => update({ prompt: value })
const handlePresetSelect = value => update({ prompt: value })
const handleResolutionChange = value => update({ resolution: value })
const handleModelChange = (value) => {
  const option = modelSelectOptions.value.find(item => item.value === value)
  if (option?.sourceProvider) modelStore.setProvider(option.sourceProvider)
  const model = modelStore.getImageModel(value)
  const availableResolutions = model?.imageResolutions || model?.resolutions
  const resolution = Array.isArray(availableResolutions) && availableResolutions.length
    ? String(availableResolutions[0]).toUpperCase()
    : (/seedream/i.test(value) ? '2K' : '1K')
  update({ model: value, size: null, ratio: null, resolution })
}
const handleCountChange = (value) => update({ count: Number(value) })

const collapse = () => update({ expanded: false })

const cancelGeneration = () => {
  stopGeneration()
  update({ loading: false, error: '' })
  window.$message?.info('已取消图片生成')
}

const handleGenerateAction = () => {
  if (isGenerating.value) cancelGeneration()
  else handleSend()
}

const handleSend = async () => {
  const prompt = String(props.data?.prompt || '').trim()
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
  if (!prompt && !upstreamText.value && !upstreamImages.value.length) {
    window.$message?.warning('请输入画面描述或连接上游节点')
    return
  }

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
    update({ loading: true, error: '', model, size: selectedSize.value || null, resolution: selectedResolution.value })
    // 上游注入：文本拼入提示词，全部连入图片按边顺序作为参考图
    const parts = [upstreamText.value, prompt].filter(Boolean)
    const fullPrompt = parts.join('\n')
    const referenceImages = upstreamImages.value.map(item => item.url)
    const result = await generate({
      model,
      prompt: fullPrompt,
      size: selectedSize.value,
      resolution: selectedResolution.value,
      n: Number(props.data?.count || 1),
      image: referenceImages
    }, { providerId: providerId.value })

    const results = Array.isArray(result) ? result : []
    const url = results[0]?.url
    if (!url) throw new Error('接口未返回图片地址')
    // 卡片目前只展示单图；不要把多张 base64 塞进节点 data，
    // 否则会随 localStorage 保存撑爆配额（详见 stores/projects.js 的 cleanNodeForStorage）
    update({
      url,
      loading: false,
      updatedAt: Date.now()
    })
    window.$message?.success(results.length > 1 ? `已生成 ${results.length} 张图片` : '图片生成成功')
  } catch (err) {
    if (err?.name === 'AbortError') return
    update({ loading: false, error: err.message || '图片生成失败' })
    window.$message?.error(enrichModelError(err, props.data?.model || effectiveModel.value, providerLabel.value))
  }
}

watch(
  () => props.data?.autoExecute,
  shouldExecute => {
    if (!shouldExecute) return
    update({ autoExecute: false })
    handleSend()
  },
  { immediate: true }
)

const handleAction = (action) => {
  if (action === 'duplicate') duplicate()
  else if (action === 'delete') remove()
}
</script>

<style scoped>
.image-card { width: 520px; }
.flow-node-collapsed .image-card { width: 478px; }
.flow-node-collapsed .flow-card-body { margin: 7px; }

.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(120, 120, 120, 0.25);
  border-top-color: var(--flow-accent);
  border-radius: 50%;
  animation: flow-spin 0.8s linear infinite;
}
.loading-text { color: var(--flow-text-mid); font-size: 12px; font-weight: 500; }

@keyframes flow-spin { to { transform: rotate(360deg); } }

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
