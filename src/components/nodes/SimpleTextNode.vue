<template>
  <!-- 文本节点：正文就是这段文字（内容态退成一段普通文本，见 flow-nodes.css）。
       改写指令在底部 composer 里写，卡片上不放第二个输入框。 -->
  <NodeFrame
    :node-id="id"
    tone="text"
    :title="data.label || '文本'"
    :focused="focused"
    :multi="multi"
    :card-width="boxWidth"
    resizable
    @resize="handleResize"
    :status-text="statusText"
    :status-class="statusClass"
    :notices="notices"
    :failed="!!data.error"
    :fail-text="data.error || ''"
    @remove="remove"
    @duplicate="duplicateAndRefresh"
    @notice-action="handleNoticeAction"
  >
    <template #body>
      <textarea
        ref="contentRef"
        class="flow-pfield flow-pfield-textarea nodrag nowheel"
        :style="boxHeight ? { height: `${boxHeight}px` } : null"
        :value="data.content || ''"
        placeholder="写点什么…"
        @input="handleContentInput"
      />
    </template>
  </NodeFrame>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NodeFrame } from './base'
import { useNodeRefs } from '../../composables/useNodeRefs'
import { useFocusExpanded, useMultiSelected } from '../../composables/useFocusMode'
import { useNodeRunBridge } from '../../composables/useNodeRunBridge'
import { useChat } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import {
  updateNode, editNode, editField, dropOrphanRefs,
  duplicateNode, removeNode
} from '../../stores/canvas'
import { makeToken, refKey } from '../../utils/promptRefs'
import { buildNodeNotices } from '../../utils/nodeNotices'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const { refs, candidates, buildPrompt, check, inboundCount } = useNodeRefs(props.id)

const focused = useFocusExpanded(props.id)

/**
 * 文本节点的尺寸由用户拖出来（数据里存着），其它节点是按素材比例算的。
 */
const boxWidth = computed(() => Number(props.data?.boxWidth) || 320)
/** 这是**内容框**的高度，不是卡片高度 —— 卡片自然包住它，不去算"减去表头多少" */
const boxHeight = computed(() => Number(props.data?.boxHeight) || Math.max(0, boxWidth.value - 2))
const handleResize = ({ width, height }) => editNode(props.id, { boxWidth: width, boxHeight: height })
const multi = useMultiSelected(props.id)

const contentRef = ref(null)
const modelStore = useModelStore()


/* ------------------------------------------------------------ 模型与渠道 */
const modelSelectOptions = computed(() => modelStore.groupedChatModelOptions || [])
const selectedModel = computed(() => {
  const options = modelSelectOptions.value
  const configuredKeys = new Set(options.map(option => option.value))
  if (configuredKeys.has(props.data?.model)) return props.data.model
  if (configuredKeys.has(modelStore.selectedChatModel)) return modelStore.selectedChatModel
  return options[0]?.value || ''
})
const selectedModelOption = computed(() => modelSelectOptions.value.find(o => o.value === selectedModel.value
  && o.sourceProvider === props.data?.sourceProvider) || modelSelectOptions.value.find(o => o.value === selectedModel.value))
const providerId = computed(() => (
  modelStore.resolveModelSourceProvider(selectedModel.value, 'CHAT', props.data?.sourceProvider)
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

const notices = computed(() => buildNodeNotices(props.data))

/** 底部中间那格显示字数，比"已连入 N 个上游"有用 */
const contentSummary = computed(() => {
  const length = String(props.data?.content || '').trim().length
  return length ? `${length} 字` : ''
})

/* ------------------------------------------------------------------ 编辑 */
const handleContentInput = (event) => editField(props.id, 'content', event.target.value)

const handleNoticeAction = (act) => {
  if (act === 'update-run') handleSend()
  else if (act === 'drop-orphans') dropOrphanRefs(props.id)
  else if (act === 'run-anyway') handleSend(true)
}


/* ------------------------------------------------------------------ 生成 */
const cancelGeneration = () => updateNode(props.id, { loading: false, error: '' })

const handleSend = async (force = false) => {
  if (loading.value) return

  const result = check()
  if (!result.ok) {
    updateNode(props.id, { error: result.message, errorKind: 'preflight', errorCode: result.code || '' })
    window.$message?.error(result.message)
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
        content: answer, loading: false, updatedAt: Date.now()
      })
    }
  } catch (err) {
    updateNode(props.id, { error: err.message || '文本生成失败', loading: false })
    window.$message?.error(err.message || '文本生成失败')
  }
}

// 生成按钮在底部 composer 上，通过窗口事件桥驱动本节点的生成 / 取消
useNodeRunBridge(props.id, { run: () => handleSend(), cancel: cancelGeneration })

const duplicateAndRefresh = () => { duplicateNode(props.id) }
const remove = () => { removeNode(props.id)}

defineExpose({ focusContent: () => contentRef.value?.focus() })
</script>
