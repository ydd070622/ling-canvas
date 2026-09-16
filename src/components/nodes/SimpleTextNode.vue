<template>
  <!-- 文本节点：内容区 + 改写指令（指令里可用 @ 引用上游） -->
  <NodeFrame
    :node-id="id"
    tone="text"
    :title="data.label || '文本'"
    :expanded="isExpanded"
    :prompt="data.prompt || ''"
    :refs="refs"
    :candidates="candidates"
    :inbound-count="inboundCount"
    placeholder="给这段文字一个改写要求…  输入 @ 引用上游"
    :status-text="statusText"
    :status-class="statusClass"
    :notices="notices"
    :footer-note="footerNote"
    :busy="loading"
    :stale="isStale"
    :failed="!!data.error"
    @send="handleSend"
    @cancel="cancelGeneration"
    @remove="remove"
    @duplicate="duplicateAndRefresh"
    @toggle-collapse="toggleCollapse"
    @update-prompt="handlePromptInput"
    @insert-ref="handleInsertRef"
    @notice-action="handleNoticeAction"
  >
    <template #body>
      <textarea
        ref="contentRef"
        class="flow-pfield flow-pfield-textarea nodrag nowheel"
        :value="data.content || ''"
        :placeholder="isExpanded ? '写点什么…' : '点击展开编辑'"
        @input="handleContentInput"
      />
    </template>

    <template #peek>
      <span v-if="(data.content || '').trim()" class="flow-peek-line">{{ data.content }}</span>
      <div v-else class="flow-peek-empty">还没有内容</div>
    </template>
  </NodeFrame>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NodeFrame } from './base'
import { FlowSelect } from './base'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useChat } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import {
  updateNode, editNode, editField, clearStale, dropOrphanRefs,
  duplicateNode, removeNode, propagateStale, renumberNodeRefs
} from '../../stores/canvas'
import { KIND_TITLE } from '../../config/nodeRegistry'
import { makeToken } from '../../utils/promptRefs'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const { refs, candidates, buildPrompt, check, inboundCount } = useNodeRefs(props.id)

const contentRef = ref(null)
const modelStore = useModelStore()

const isExpanded = computed(() => props.data?.expanded === true)
const isStale = computed(() => !!props.data?.stale?.is)

/* ------------------------------------------------------------ 模型与渠道 */
const modelSelectOptions = computed(() => modelStore.groupedChatModelOptions || [])
const selectedModel = computed(() => {
  const options = modelSelectOptions.value
  const configuredKeys = new Set(options.map(option => option.value))
  if (configuredKeys.has(props.data?.model)) return props.data.model
  if (configuredKeys.has(modelStore.selectedChatModel)) return modelStore.selectedChatModel
  return options[0]?.value || ''
})
const selectedModelOption = computed(() => modelSelectOptions.value.find(o => o.value === selectedModel.value))
const selectedModelLabel = computed(() => selectedModelOption.value?.label || '请先配置文本模型')
const providerId = computed(() => (
  modelStore.resolveModelSourceProvider(selectedModel.value, 'CHAT')
  || selectedModelOption.value?.sourceProvider
  || ''
))
const providerLabel = computed(() => (
  providerId.value ? (modelStore.getProviderConfigById(providerId.value)?.label || providerId.value) : ''
))
const hasProviderKey = computed(() => Boolean(providerId.value) && Boolean(modelStore.getApiKeyByProvider(providerId.value)))
const effectiveModel = computed(() => selectedModel.value)

watch(selectedModel, (value) => {
  if ((props.data?.model || '') !== value) updateNode(props.id, { model: value })
}, { immediate: true })

const { loading, send } = useChat({ get model() { return effectiveModel.value } })

/* ------------------------------------------------------------ 状态与提示 */
const statusText = computed(() => {
  if (loading.value) return '生成中…'
  if (props.data?.error) return '失败'
  return (props.data?.content || '').trim() ? '已就绪' : '待生成'
})
const statusClass = computed(() => {
  if (loading.value) return 'is-busy'
  if (props.data?.error) return 'is-fail'
  return (props.data?.content || '').trim() ? 'is-ok' : ''
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

/* ------------------------------------------------------------------ 编辑 */
const handleContentInput = (event) => editField(props.id, 'content', event.target.value)
const handlePromptInput = (value) => editField(props.id, 'prompt', value)
const handleInsertRef = ({ key, edgeId }) => {
  editNode(props.id, { refBindings: { ...(props.data.refBindings || {}), [key]: edgeId }, warn: null })
}
const toggleCollapse = () => updateNode(props.id, { expanded: !isExpanded.value })

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

/* ------------------------------------------------------------------ 生成 */
const cancelGeneration = () => updateNode(props.id, { loading: false, error: '' })

const handleSend = async (force = false) => {
  if (loading.value) return

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
    window.$message?.warning('请先前往设置，在模型配置中启用文本模型')
    return
  }
  if (!hasProviderKey.value) {
    window.$message?.warning(
      providerId.value
        ? `请先在设置中为「${providerLabel.value}」配置 API Key`
        : '该模型未绑定供应商，请在设置中重新启用这个模型'
    )
    return
  }

  try {
    updateNode(props.id, { error: '', loading: true, model: effectiveModel.value })
    const instruction = buildPrompt()
    const source = String(props.data?.content || '').trim()
    // 指令里已经含被引用进来的上游正文；原内容作为待改写的素材附在后面
    const request = instruction && source ? `${instruction}\n\n原始内容：\n${source}` : (instruction || source)
    const answer = await send(request, true, { providerId: providerId.value })
    if (answer) {
      updateNode(props.id, {
        content: answer, loading: false,
        stale: { is: false, reason: null, since: null }, updatedAt: Date.now()
      })
      propagateStale(props.id)
    }
    window.$message?.success('文本生成完成')
  } catch (err) {
    updateNode(props.id, { error: err.message || '文本生成失败', loading: false })
    window.$message?.error(err.message || '文本生成失败')
  }
}

const duplicateAndRefresh = () => { if (duplicateNode(props.id)) window.$message?.success('节点已复制') }
const remove = () => { removeNode(props.id); window.$message?.success('节点已删除') }

watch(
  () => props.data?.mode,
  (value) => { if (value) renumberNodeRefs(props.id) }
)

defineExpose({ focusContent: () => contentRef.value?.focus() })
</script>
