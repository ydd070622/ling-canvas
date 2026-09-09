<template>
  <!-- 图片节点：展开/收缩双态 + 上传/预览 + 参考图注入 -->
  <div class="flow-node-outer image-node" :class="{ 'flow-node-collapsed': !isExpanded }">
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
        <div v-else-if="data.url" class="flow-image-preview" @dblclick.stop="openImagePreview" @click="handleBodyClick">
          <img :src="data.url" :alt="data.label" />
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
          <textarea
            :value="data.prompt || ''"
            class="flow-prompt-input nodrag nowheel"
            placeholder="描述要生成的画面..."
            rows="1"
            @input="handlePromptInput"
          />
        </div>
        <div class="flow-footer-row">
          <FlowSelect
            :options="modelSelectOptions"
            :model-value="selectedModel"
            :display="selectedModelLabel"
            dot="blue"
            @update:model-value="handleModelChange"
          />
          <RatioPicker
            :model-value="selectedRatio"
            :display="selectedRatioLabel"
            @change="handleRatioChange"
          />
          <span class="flow-pill nodrag">
            <span class="pd-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/></svg></span>高级
            <span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></span>
          </span>
          <span class="flow-footer-spacer"></span>
          <FlowSelect
            :options="countOptions"
            :model-value="String(data.count || 1)"
            :display="`x${data.count || 1}`"
            @update:model-value="handleCountChange"
          />
          <button class="flow-send-btn nodrag" :disabled="generating" :title="generating ? '生成中' : '发送'" @click="handleSend">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.1c.9-.4.9-1.2 0-1.6L3.4 3.6c-.8-.3-1.4.2-1.4 1L4 12l-2 7.4c0 .8.6 1.3 1.4 1z"/></svg>
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
import { NodeToolbar, NodePort, FlowSelect, RatioPicker } from './base'
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
const { loading: generating, generate } = useImageGeneration()

const selectedModel = computed(() => props.data?.model || modelStore.selectedImageModel)
const currentModel = computed(() => modelStore.getImageModel(selectedModel.value))
/** 有效模型：旧数据/无模型名时回退到设置中启用的图片模型，避免用对话模型调用生图接口 */
const effectiveModel = computed(() => {
  const current = selectedModel.value
  if (modelStore.getImageModel(current)) return current
  const fallback = modelStore.selectedImageModel && modelStore.getImageModel(modelStore.selectedImageModel)
    ? modelStore.selectedImageModel
    : 'nano-banana-pro'
  return fallback
})
/** 有效模型的完整配置（后端定义的 sizes / 默认参数） */
const effectiveModelConfig = computed(() => modelStore.getImageModel(effectiveModel.value))
const selectedModelLabel = computed(() => currentModel.value?.label || selectedModel.value || 'Choose image model')
const modelOptions = computed(() => {
  if (modelStore.imageModelOptions.length) return modelStore.imageModelOptions
  const model = currentModel.value
  return [{ key: selectedModel.value, label: model?.label || selectedModel.value }]
})
/** 设置中启用的模型，按供应商分组；当前值缺失时置顶"当前使用" */
const modelSelectOptions = computed(() => {
  const list = modelStore.groupedImageModelOptions || []
  const hasCurrent = list.some(o => o.value === selectedModel.value)
  if (hasCurrent || !selectedModel.value) return list
  const current = { value: selectedModel.value, label: selectedModelLabel.value, group: '当前使用' }
  return list.length ? [current, ...list] : [current]
})
const sizeOptions = computed(() => {
  const sizes = currentModel.value?.sizes || []
  return sizes.length ? sizes : [props.data?.size || currentModel.value?.defaultParams?.size || '1x1']
})
const selectedSize = computed(() => {
  // 显式存储的 size 优先；其次按所选比例从有效模型尺寸中匹配；最后回退模型默认
  if (props.data?.size) return props.data.size
  if (props.data?.ratio) {
    const matched = findSizeByRatio(effectiveModelConfig.value?.sizes || [], props.data.ratio)
    if (matched) return matched
  }
  return effectiveModelConfig.value?.defaultParams?.size || sizeOptions.value[0] || '1x1'
})
const formatSize = (size) => String(size).replace(/x/g, ' × ')
const countOptions = ['1', '2', '3', '4'].map(v => ({ value: v, label: `x${v}` }))

/** 当前比例：‘auto’（自适应）或 '16:9' 等 | Current ratio value */
const selectedRatio = computed(() => {
  if (props.data?.size) return normalizeRatioKey(props.data.size)
  if (props.data?.ratio) return String(props.data.ratio)
  return 'auto'
})
const selectedRatioLabel = computed(() => {
  if (selectedRatio.value === 'auto') return '自适应'
  return ratioDisplay(selectedRatio.value)
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

const handlePromptInput = (e) => update({ prompt: e.target.value })
const handleModelChange = (value) => {
  const model = modelStore.getImageModel(value)
  update({ model: value, size: model?.defaultParams?.size || model?.sizes?.[0] || '1x1' })
}
const handleCountChange = (value) => update({ count: Number(value) })

const collapse = () => update({ expanded: false })

const handleSend = async () => {
  const prompt = String(props.data?.prompt || '').trim()
  if (!modelStore.currentApiKey) {
    window.$message?.warning('请先配置 API Key')
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
    update({ loading: true, error: '', model, size: selectedSize.value })
    // 上游注入：文本拼入提示词，全部连入图片按边顺序作为参考图
    const parts = [upstreamText.value, prompt].filter(Boolean)
    const fullPrompt = parts.join('\n')
    const referenceImages = upstreamImages.value.map(item => item.url)
    const refImage = referenceImages.length > 1 ? referenceImages : referenceImages[0] || null
    const result = await generate({
      model,
      prompt: fullPrompt,
      size: selectedSize.value,
      n: Number(props.data?.count || 1),
      image: refImage
    })
    const url = result?.[0]?.url
    if (!url) throw new Error('接口未返回图片地址')
    update({ url, loading: false, updatedAt: Date.now() })
    window.$message?.success('图片生成成功')
  } catch (err) {
    update({ loading: false, error: err.message || '图片生成失败' })
    window.$message?.error(enrichModelError(err, props.data?.model || effectiveModel.value, modelStore.providerLabel))
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
.image-card { width: 468px; }
.flow-node-collapsed .image-card { width: 430px; }
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
