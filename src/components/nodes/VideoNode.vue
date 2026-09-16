<template>
  <!-- 视频节点：生成模式决定上游素材的语义（首帧 / 尾帧 / 参考），
       不再有多个物理端口 —— 所有上游都接左侧那一个口。 -->
  <NodeFrame
    :node-id="id"
    tone="video"
    :title="data.label || '视频'"
    :expanded="isExpanded"
    :prompt="data.prompt || ''"
    :refs="refs"
    :candidates="candidates"
    :inbound-count="inboundCount"
    placeholder="描述希望画面如何动起来…  输入 @ 引用上游"
    :status-text="statusText"
    :status-class="statusClass"
    :notices="notices"
    :footer-note="footerNote"
    :busy="generating || isPolling"
    :stale="isStale"
    :failed="!!data.error"
    @send="handleSend"
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
        tone="video"
        :url="data.url"
        :loading="data.loading || !!data.taskId"
        :loading-text="data.taskId ? `创作中… ${data.progress || 0}%` : '任务创建中…'"
        :meta="mediaMeta"
        @upload="triggerFileInput"
        @pick-asset="openAssetPicker"
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
        dot="purple"
        empty-text="请先去设置配置视频模型"
        @update:model-value="handleModelChange"
      />
      <FlowSelect
        :options="presetOptions"
        :model-value="selectedPreset"
        :display="selectedPresetLabel"
        @update:model-value="handlePresetChange"
      />
    </template>

    <template #peek>
      <div v-if="data.url" class="flow-peek-strip" style="background: #0b0f16">
        <span class="flow-peek-play">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width: 11px; height: 11px; margin-left: 1px"><path d="M8 5.5v13l11-6.5z" /></svg>
        </span>
      </div>
      <div v-else class="flow-peek-empty">还没有产出</div>
    </template>
  </NodeFrame>

  <input ref="fileInputRef" type="file" accept="video/*" style="display: none" @change="handleFileSelect" />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NodeFrame, FlowSelect } from './base'
import NodeMedia from './base/NodeMedia.vue'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useVideoGeneration } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import {
  updateNode, editNode, editField, clearStale, dropOrphanRefs, setNodeMedia,
  duplicateNode, removeNode, propagateStale, renumberNodeRefs
} from '../../stores/canvas'
import { NODE_MODES, KIND_TITLE } from '../../config/nodeRegistry'
import { makeToken } from '../../utils/promptRefs'
import { isLikelyTextModel, enrichModelError } from '../../composables/useModelGuard'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const {
  refs, candidates, modeDef, firstFrame, lastFrame, buildPrompt, check, inboundCount
} = useNodeRefs(props.id)

const fileInputRef = ref(null)
const isPolling = ref(false)
const modelStore = useModelStore()
const { loading: generating, generate, pollVideoTask } = useVideoGeneration()

const isExpanded = computed(() => props.data?.expanded === true)
const isStale = computed(() => !!props.data?.stale?.is)

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
const selectedModelLabel = computed(() => selectedModelOption.value?.label || currentModel.value?.label || '请先配置视频模型')

watch(selectedModel, (value) => {
  if ((props.data?.model || '') !== value) updateNode(props.id, { model: value })
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
const selectedPreset = computed(() =>
  `${props.data?.resolution || currentModel.value?.defaultResolution || '1080p'}:${props.data?.duration || currentModel.value?.defaultParams?.duration || 5}`)
const selectedPresetLabel = computed(() => presetOptions.value.find(p => p.value === selectedPreset.value)?.label || '自适应 · 1080p · 5s')

/* ---------------------------------------------------------------- 模式 */
const modeOptions = computed(() => Object.entries(NODE_MODES.video).map(([value, def]) => ({
  value,
  label: def.label,
  note: Object.entries(def.accepts).map(([k, n]) => `${KIND_TITLE[k][0]}≤${n}`).join(' ')
})))
const currentMode = computed(() => modeDef.value ? props.data?.mode : 't2v')
const modeLabel = computed(() => modeDef.value?.label || '文生视频')

const handleModeChange = (value) => {
  if (value === props.data?.mode) return
  editNode(props.id, { mode: value })
  renumberNodeRefs(props.id)
}

const mediaMeta = computed(() => (props.data?.url
  ? `${props.data?.duration || 5}s · ${props.data?.resolution || '1080p'}`
  : ''))

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
  const used = refs.value.filter(r => r.status === 'ok').length
  return inboundCount.value ? `已连入 <b>${inboundCount.value}</b> 个上游 · 引用 <b>${used}</b> 个` : '未连接上游'
})

/* ---------------------------------------------------------- 任务续跑 */
const startPolling = async (taskId) => {
  if (isPolling.value) return
  isPolling.value = true
  try {
    const result = await pollVideoTask(taskId, {
      providerId: providerId.value,
      onProgress: (attempt, percentage) => { updateNode(props.id, { progress: percentage, attempt }) }
    })
    updateNode(props.id, { url: result.url, loading: false, progress: 100, taskId: null, stale: { is: false, reason: null, since: null } })
    window.$message?.success('视频生成成功')
    propagateStale(props.id)
  } catch (err) {
    updateNode(props.id, { loading: false, error: err.message || '生成失败', taskId: null })
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

/* ------------------------------------------------------------------ 编辑 */
const handlePromptInput = (value) => editField(props.id, 'prompt', value)
const handleInsertRef = ({ key, edgeId }) => {
  editNode(props.id, { refBindings: { ...(props.data.refBindings || {}), [key]: edgeId }, warn: null })
}
const toggleCollapse = () => updateNode(props.id, { expanded: !isExpanded.value })
const handlePresetChange = (value) => {
  const [resolution, duration] = value.split(':')
  editNode(props.id, { resolution, duration: Number(duration) })
}
const handleModelChange = (value) => {
  const option = modelSelectOptions.value.find(item => item.value === value)
  if (option?.sourceProvider) modelStore.setProvider(option.sourceProvider)
  const model = modelStore.getVideoModel(value)
  editNode(props.id, {
    model: value,
    ratio: '3:4',
    duration: model?.defaultParams?.duration || 5,
    resolution: model?.defaultResolution || model?.resolutions?.[0] || '1080p'
  })
}

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

/* ------------------------------------------------------------------ 生成 */
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
  updateNode(props.id, { loading: false, taskId: null, error: '' })
  window.$message?.info('已取消视频生成')
}

const handleSend = async (force = false) => {
  if (generating.value || isPolling.value) return

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
      url: output.url, loading: false, taskId: null, progress: 100,
      stale: { is: false, reason: null, since: null }, updatedAt: Date.now()
    })
    window.$message?.success('视频生成成功')
    propagateStale(props.id)
  } catch (err) {
    updateNode(props.id, { loading: false, taskId: null, error: err.message || '视频生成失败' })
    window.$message?.error(enrichModelError(err, props.data?.model || effectiveModel.value, providerLabel.value))
  }
}

const duplicateAndRefresh = () => { if (duplicateNode(props.id)) window.$message?.success('节点已复制') }
const remove = () => { removeNode(props.id); window.$message?.success('节点已删除') }

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
