<template>
  <!-- 视频节点：展开/收缩 + 首帧/尾帧/描述三槽输入 -->
  <div class="flow-node-outer video-node" :class="{ 'flow-node-collapsed': !isExpanded }">
    <!-- 收缩态标签 -->
    <span v-if="!isExpanded" class="flow-collapsed-label">{{ data.label || '视频' }}</span>

    <!-- 药丸悬浮工具栏（仅展开） -->
    <NodeToolbar v-if="isExpanded">
      <div class="flow-tb-group">
        <button class="flow-tool-btn nodrag" title="静音" @click="toggleMute">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 9.5v5a1 1 0 0 0 1 1h2.8L11 18.6c.5.4 1.2.1 1.2-.5V5.9c0-.6-.7-.9-1.2-.5L7.8 8.5H5a1 1 0 0 0-1 1z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg>
        </button>
        <button class="flow-tool-btn nodrag" title="下载" @click="handleDownload">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 4v11M8.5 11.5 12 15l3.5-3.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
        </button>
        <button class="flow-tool-btn nodrag" title="收缩" @click="collapse">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 21H3v-6M15 3h6v6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
      </div>
      <div class="flow-tb-sep"></div>
      <div class="flow-tb-group">
        <button class="flow-tool-btn nodrag" title="创建副本" @click="handleAction('duplicate')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/></svg>
        </button>
        <button class="flow-tool-btn nodrag" title="图层">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 3 8l9 5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>
        </button>
        <button class="flow-tool-btn flow-tool-danger nodrag" title="删除" @click="handleAction('delete')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M10 4h4M6.5 7l.8 12.2a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L17.5 7"/></svg>
        </button>
      </div>
    </NodeToolbar>

    <!-- 卡片 -->
    <div class="flow-card video-card">
      <!-- 头部（仅展开） -->
      <div v-if="isExpanded" class="flow-card-head">
        <span class="flow-head-left"><span class="flow-head-dot flow-tone-video"></span><span class="flow-head-title">视频</span></span>
        <span class="flow-head-right">视频</span>
      </div>

      <!-- 媒体区 -->
      <div class="flow-video-media" @dblclick.stop="togglePlay" @click="handleBodyClick">
        <!-- 加载中 -->
        <div v-if="(data.taskId && !data.url) || (data.loading && !data.taskId)" class="video-loading">
          <div class="loading-spinner"></div>
          <span class="loading-text">{{ data.taskId ? `创作中... ${data.progress || 0}%` : '任务创建中...' }}</span>
        </div>
        <!-- 错误 -->
        <div v-else-if="data.error" class="video-error">
          <span style="color:#ef4444;font-size:26px">✕</span>
          <span style="color:#ef4444;font-size:12px">{{ data.error }}</span>
        </div>
        <!-- 视频 -->
        <video
          v-else-if="data.url"
          ref="videoRef"
          :src="data.url"
          :muted="muted"
          controls
          playsinline
          class="preview-video"
        />
        <!-- 上传空态 -->
        <div v-else class="video-upload" @dragover.prevent @drop.prevent="handleDrop">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          <span v-if="isExpanded">拖放视频或点击上传</span>
        </div>
      </div>

      <!-- 底部生成区（仅展开） -->
      <div v-if="isExpanded" class="flow-card-footer">
        <div class="flow-footer-row" style="align-items:flex-end">
          <button class="flow-plus-btn nodrag" title="添加上游素材">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <!-- 首帧 chip：来自连入 first-frame 槽的图片 -->
          <button class="flow-frame-chip nodrag" :title="slotInputs.first ? '首帧已连接' : '连接图片节点到首帧槽'" @click="clearSlot('first')">
            <span class="fc-box">
              <img v-if="slotInputs.first" :src="slotInputs.first" alt="首帧" />
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>
            </span>
            <span class="fc-label">首帧</span>
          </button>
          <!-- 尾帧 chip -->
          <button class="flow-frame-chip nodrag" :title="slotInputs.last ? '尾帧已连接' : '连接图片节点到尾帧槽'" @click="clearSlot('last')">
            <span class="fc-box">
              <img v-if="slotInputs.last" :src="slotInputs.last" alt="尾帧" />
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>
            </span>
            <span class="fc-label">尾帧</span>
          </button>
        </div>
        <div class="flow-footer-row">
          <textarea
            :value="data.prompt || ''"
            class="flow-prompt-input nodrag nowheel"
            placeholder="描述希望画面如何动起来..."
            rows="2"
            @input="handlePromptInput"
          />
        </div>
        <div class="flow-footer-row">
          <FlowSelect
            :options="modelSelectOptions"
            :model-value="selectedModel"
            :display="selectedModelLabel"
            empty-text="请先去设置配置视频模型"
            dot="purple"
            @update:model-value="handleModelChange"
          />
          <FlowSelect
            :options="presetOptions"
            :model-value="selectedPreset"
            :display="selectedPresetLabel"
            @update:model-value="handlePresetChange"
          />
          <span class="flow-pill nodrag">
            <span class="pd-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/></svg></span>高级
            <span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></span>
          </span>
          <button class="flow-send-btn nodrag" :disabled="generating || isPolling" :title="generating || isPolling ? '生成中' : '发送'" @click="handleSend">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.1c.9-.4.9-1.2 0-1.6L3.4 3.6c-.8-.3-1.4.2-1.4 1L4 12l-2 7.4c0 .8.6 1.3 1.4 1z"/></svg>
          </button>
        </div>
      </div>

      <!-- 端口：左三槽（首帧/尾帧/描述）+ 右输出 -->
      <NodePort id="first-frame" type="target" side="left" tone="image" slot-label="首帧" top="28%" :collapsed="!isExpanded" :node-id="id" />
      <NodePort id="last-frame" type="target" side="left" tone="image" slot-label="尾帧" top="50%" :collapsed="!isExpanded" :node-id="id" />
      <NodePort id="prompt" type="target" side="left" tone="text" slot-label="描述" top="72%" :collapsed="!isExpanded" :node-id="id" />
      <NodePort id="right" type="source" side="right" tone="video" :collapsed="!isExpanded" :node-id="id" />
    </div>

    <!-- 隐藏文件输入 -->
    <input ref="fileInputRef" type="file" accept="video/*" style="display:none" @change="handleFileSelect" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { NodeToolbar, NodePort, FlowSelect } from './base'
import { useNodeActions } from '../../composables/useNodeActions'
import { useUpstreamInputs } from '../../composables/useUpstreamInputs'
import { useVideoGeneration } from '../../hooks/useApi'
import { updateNode, nodes } from '../../stores/canvas'
import { useModelStore } from '../../stores/pinia'
import { isLikelyTextModel, enrichModelError } from '../../composables/useModelGuard'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const { duplicate, remove, update } = useNodeActions(props.id)
const { slotInputs } = useUpstreamInputs(props.id)
const { loading: generating, generate, pollVideoTask } = useVideoGeneration()
const modelStore = useModelStore()

const fileInputRef = ref(null)
const videoRef = ref(null)
const isPolling = ref(false)
const muted = ref(false)

const modelSelectOptions = computed(() => modelStore.groupedVideoModelOptions || [])
const selectedModel = computed(() => {
  const options = modelSelectOptions.value
  const configuredKeys = new Set(options.map(option => option.value))
  if (configuredKeys.has(props.data?.model)) return props.data.model
  if (configuredKeys.has(modelStore.selectedVideoModel)) return modelStore.selectedVideoModel
  return options[0]?.value || ''
})
const selectedModelOption = computed(() => modelSelectOptions.value.find(option => option.value === selectedModel.value))
/** 本节点所用模型所属渠道：创建任务与轮询查询都必须命中同一渠道。 */
const providerId = computed(() => (
  // 权威来源是按模型反查渠道；下拉选项（FlowSelect 形状）仅作兜底
  modelStore.resolveModelSourceProvider(selectedModel.value, 'VIDEO')
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
  modelStore.availableVideoModels.find(model => model.key === selectedModel.value)
  || modelStore.getVideoModel(selectedModel.value)
)
const selectedModelLabel = computed(() => selectedModelOption.value?.label || currentModel.value?.label || '请先配置视频模型')
/** 仅使用设置中已启用的视频模型，不回退到内置模型。 */
const effectiveModel = computed(() => selectedModel.value)
watch(selectedModel, value => {
  if ((props.data?.model || '') !== value) update({ model: value })
}, { immediate: true })

const presetOptions = computed(() => {
  const model = currentModel.value
  const resolutions = model?.resolutions?.length ? model.resolutions : [model?.defaultResolution || '1080p']
  const durations = model?.durs?.length ? model.durs.map(item => item.key) : [model?.defaultParams?.duration || 5]
  return resolutions.flatMap(resolution => durations.map(duration => ({
    value: `${resolution}:${duration}`,
    label: `${resolution} · ${duration}s`
  })))
})
const selectedPreset = computed(() => `${props.data?.resolution || currentModel.value?.defaultResolution || '1080p'}:${props.data?.duration || currentModel.value?.defaultParams?.duration || 5}`)
const selectedPresetLabel = computed(() => {
  const preset = presetOptions.value.find(p => p.value === selectedPreset.value)
  return preset?.label || '自适应 · 1080p · 5s'
})

const isExpanded = computed(() => props.data?.expanded === true)

/** 收缩态点击 → 展开并选中；展开态空态点击 → 上传 */
const handleBodyClick = () => {
  if (!isExpanded.value) {
    update({ expanded: true })
    nodes.value = nodes.value.map(n => ({ ...n, selected: n.id === props.id }))
  } else if (!props.data?.url) {
    triggerFileInput()
  }
}

// 已有 taskId 未完成时继续轮询
watch(() => props.data?.taskId, (taskId) => {
  if (taskId && !props.data?.url && !isPolling.value) startPolling(taskId)
})
onMounted(() => {
  const { taskId, url } = props.data || {}
  if (taskId && !url && !isPolling.value) startPolling(taskId)
})
onBeforeUnmount(() => { isPolling.value = false })

const startPolling = async (taskId) => {
  if (isPolling.value) return
  isPolling.value = true
  try {
    const result = await pollVideoTask(taskId, {
      providerId: providerId.value,
      onProgress: (attempt, percentage) => {
        updateNode(props.id, { progress: percentage, attempt })
      }
    })
    updateNode(props.id, { url: result.url, loading: false, progress: 100, taskId: null })
    window.$message?.success('视频生成成功')
  } catch (err) {
    updateNode(props.id, { loading: false, error: err.message || '生成失败', taskId: null })
    window.$message?.error(err.message || '视频生成失败')
  } finally {
    isPolling.value = false
  }
}

const triggerFileInput = () => fileInputRef.value?.click()
const handleFileSelect = (e) => {
  const file = e.target.files?.[0]
  if (file) uploadFile(file)
}
const handleDrop = (e) => {
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('video/')) uploadFile(file)
}
const uploadFile = (file) => {
  update({ loading: true, error: '' })
  const reader = new FileReader()
  reader.onload = event => update({
    url: event.target.result,
    base64: event.target.result,
    loading: false,
    fileName: file.name.replace(/\.[^.]+$/, ''),
    updatedAt: Date.now()
  })
  reader.onerror = () => update({ loading: false, error: '视频读取失败' })
  reader.readAsDataURL(file)
}

const togglePlay = () => {
  const v = videoRef.value
  if (!v) return
  v.paused ? v.play() : v.pause()
}
const toggleMute = () => {
  muted.value = !muted.value
  if (videoRef.value) videoRef.value.muted = muted.value
}

const handleDownload = () => {
  if (!props.data.url) return
  const link = document.createElement('a')
  link.href = props.data.url
  link.download = props.data.fileName || `video_${Date.now()}.mp4`
  link.click()
}

const clearSlot = (slot) => {
  // 首尾帧槽由连入图片自动填充；手动点击只是提示，不破坏连线
  if (slot === 'first' || slot === 'last') {
    window.$message?.info('首尾帧由连接的首帧/尾帧槽图片自动填充')
  }
}

const handlePromptInput = (e) => update({ prompt: e.target.value })
const handleModelChange = (value) => {
  const option = modelSelectOptions.value.find(item => item.value === value)
  if (option?.sourceProvider) modelStore.setProvider(option.sourceProvider)
  const model = modelStore.getVideoModel(value)
  update({
    model: value,
    ratio: model?.defaultParams?.ratio || '16:9',
    duration: model?.defaultParams?.duration || 5,
    resolution: model?.defaultResolution || model?.resolutions?.[0] || '1080p'
  })
}
const handlePresetChange = (value) => {
  const [resolution, duration] = value.split(':')
  update({ resolution, duration: Number(duration) })
}

const collapse = () => update({ expanded: false })

const handleSend = async () => {
  const prompt = String(props.data?.prompt || '').trim()
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
  const prompts = [...slotInputs.value.prompts, prompt].filter(Boolean)
  if (!prompts.length && !slotInputs.value.first && !slotInputs.value.last) {
    window.$message?.warning('请输入视频描述或连接首帧/尾帧/描述节点')
    return
  }

  try {
    const model = effectiveModel.value
    // 拦截对话模型误用（视频端点只支持 seedance 等视频模型）
    if (isLikelyTextModel(model)) {
      const label = modelStore.getChatModel?.(model)?.label || model
      window.$message?.warning(
        `「${label}」是文本模型，不能生成视频。请在设置中把视频模型切换为 Seedance 等，或改选其他供应商`
      )
      return
    }
    update({ loading: true, error: '', model })
    const modelConfig = currentModel.value || modelStore.getVideoModel(model)
    const result = await generate({
      model,
      prompt: prompts.join('\n'),
      ratio: props.data?.ratio || modelConfig?.defaultParams?.ratio || '16:9',
      dur: Number(props.data?.duration || modelConfig?.defaultParams?.duration || 5),
      resolution: props.data?.resolution || modelConfig?.defaultResolution,
      first_frame_image: slotInputs.value.first || props.data?.firstFrameImage || undefined,
      last_frame_image: slotInputs.value.last || props.data?.lastFrameImage || undefined
    }, { providerId: providerId.value })
    if (!result?.url) throw new Error('接口未返回视频地址')
    update({ url: result.url, loading: false, taskId: null, progress: 100, updatedAt: Date.now() })
    window.$message?.success('视频生成成功')
  } catch (err) {
    update({ loading: false, taskId: null, error: err.message || '视频生成失败' })
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
.video-card { width: 588px; }
.flow-node-collapsed .video-card { width: 500px; }
.flow-node-collapsed .flow-video-media { height: 280px; }

.video-loading, .video-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.video-upload {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.35);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12.5px;
  cursor: pointer;
}

.video-upload:hover { background: rgba(255, 255, 255, 0.06); }

.preview-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }

.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: flow-spin 0.8s linear infinite;
}
.loading-text { color: #fff; font-size: 12px; font-weight: 500; }

@keyframes flow-spin { to { transform: rotate(360deg); } }
</style>
