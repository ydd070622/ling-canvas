<template>
  <!-- 文本节点：展开/收缩双态 + 药丸工具栏 + 类型着色端口 -->
  <div class="flow-node-outer text-node" :class="{ 'flow-node-collapsed': !isExpanded }">
    <!-- 收缩态标签 -->
    <span v-if="!isExpanded" class="flow-collapsed-label">{{ data.label || '文本' }}</span>

    <!-- 药丸悬浮工具栏（仅展开） -->
    <NodeToolbar v-if="isExpanded">
      <div class="flow-tb-group">
        <button class="flow-tool-btn nodrag" title="标题1" @click="applyHeading(1)">H1</button>
        <button class="flow-tool-btn nodrag" title="标题2" @click="applyHeading(2)">H2</button>
        <button class="flow-tool-btn nodrag" title="标题3" @click="applyHeading(3)">H3</button>
      </div>
      <div class="flow-tb-sep"></div>
      <div class="flow-tb-group">
        <button class="flow-tool-btn flow-tool-active nodrag" title="正文">T</button>
        <button class="flow-tool-btn nodrag" title="文字颜色">A</button>
        <button class="flow-tool-btn nodrag" title="加粗" @click="applyFormat('**')">B</button>
        <button class="flow-tool-btn nodrag" title="斜体" @click="applyFormat('*')"><i>I</i></button>
        <button class="flow-tool-btn nodrag" title="编号列表" @click="applyList"><span style="font-size:11px">1.</span></button>
      </div>
      <div class="flow-tb-sep"></div>
      <div class="flow-tb-group">
        <button class="flow-tool-btn nodrag" title="创建副本" @click="handleAction('duplicate')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/></svg>
        </button>
        <button class="flow-tool-btn nodrag" title="收缩" @click="collapse">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 21H3v-6M15 3h6v6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
        <button class="flow-tool-btn nodrag" title="全屏编辑" @click="focusEditor">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/></svg>
        </button>
      </div>
      <div class="flow-tb-sep"></div>
      <div class="flow-tb-group">
        <button class="flow-tool-btn flow-tool-danger nodrag" title="删除" @click="handleAction('delete')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M10 4h4M6.5 7l.8 12.2a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L17.5 7"/></svg>
        </button>
      </div>
    </NodeToolbar>

    <!-- 卡片 -->
    <div class="flow-card text-card">
      <!-- 头部（仅展开） -->
      <div v-if="isExpanded" class="flow-card-head">
        <span class="flow-head-left"><span class="flow-head-dot"></span><span class="flow-head-title">文本</span></span>
        <span class="flow-head-right">Markdown</span>
      </div>

      <!-- 内容区（展开/收缩都显示） -->
      <div class="flow-card-body">
        <textarea
          ref="editorRef"
          :value="data.content || ''"
          class="flow-text-body nodrag nowheel"
          :placeholder="isExpanded ? '输入需求、笔记或提示词。' : '点击展开编辑'"
          @input="handleContentInput"
          @click="handleBodyClick"
        />
      </div>

      <!-- 底部生成区（仅展开） -->
      <div v-if="isExpanded" class="flow-card-footer">
        <div class="flow-footer-row">
          <button class="flow-plus-btn nodrag" title="添加素材">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button class="flow-preset-chip nodrag" title="预设模板">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/></svg>预设
          </button>
        </div>
        <div class="flow-footer-row">
          <PromptEditor
            :model-value="data.prompt || ''"
            placeholder="描述你想生成或改写的内容..."
            @update:model-value="handlePromptInput"
          />
        </div>
        <div class="flow-footer-row">
          <FlowSelect
            :options="modelSelectOptions"
            :model-value="selectedModel"
            :display="selectedModelLabel"
            empty-text="请先去设置配置文本模型"
            dot="orange"
            @update:model-value="handleModelChange"
          />
          <FlowSelect
            :options="countOptions"
            :model-value="String(data.count || 1)"
            :display="`${data.count || 1}x`"
            @update:model-value="handleCountChange"
          />
          <span class="flow-pill nodrag">
            <span class="pd-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/></svg></span>高级
            <span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></span>
          </span>
          <button class="flow-send-btn nodrag" :disabled="loading" :title="loading ? '生成中' : '发送'" @click="handleSend">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.1c.9-.4.9-1.2 0-1.6L3.4 3.6c-.8-.3-1.4.2-1.4 1L4 12l-2 7.4c0 .8.6 1.3 1.4 1z"/></svg>
          </button>
        </div>
      </div>

      <!-- 端口：左输入 / 右输出（收缩时隐藏但保留 DOM） -->
      <NodePort id="left" type="target" side="left" tone="text" :collapsed="!isExpanded" :node-id="id" />
      <NodePort id="right" type="source" side="right" tone="text" :collapsed="!isExpanded" :node-id="id" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NodeToolbar, NodePort, FlowSelect, PromptEditor } from './base'
import { useNodeActions } from '../../composables/useNodeActions'
import { useUpstreamInputs } from '../../composables/useUpstreamInputs'
import { useChat } from '../../hooks/useApi'
import { useModelStore } from '../../stores/pinia'
import { nodes } from '../../stores/canvas'

const props = defineProps({
  id: String,
  data: Object,
  selected: Boolean
})

const { duplicate, remove, update } = useNodeActions(props.id)
const { upstreamText, upstreamImages } = useUpstreamInputs(props.id)
const editorRef = ref(null)
const modelStore = useModelStore()

const modelSelectOptions = computed(() => modelStore.groupedChatModelOptions || [])
const selectedModel = computed(() => {
  const options = modelSelectOptions.value
  const configuredKeys = new Set(options.map(option => option.value))
  if (configuredKeys.has(props.data?.model)) return props.data.model
  if (configuredKeys.has(modelStore.selectedChatModel)) return modelStore.selectedChatModel
  return options[0]?.value || ''
})
const selectedModelOption = computed(() => modelSelectOptions.value.find(option => option.value === selectedModel.value))
const selectedModelLabel = computed(() => selectedModelOption.value?.label || '请先配置文本模型')
/** 本节点模型所属渠道：文本请求按该渠道解析 Key / 端点。 */
const providerId = computed(() => (
  // 权威来源是按模型反查渠道；下拉选项（FlowSelect 形状）仅作兜底
  modelStore.resolveModelSourceProvider(selectedModel.value, 'CHAT')
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
/** 仅使用设置中已启用的文本模型，不回退到内置模型。 */
const effectiveModel = computed(() => selectedModel.value)
watch(selectedModel, value => {
  if ((props.data?.model || '') !== value) update({ model: value })
}, { immediate: true })
const countOptions = ['1', '2', '3', '5'].map(v => ({ value: v, label: `${v}x` }))

const chatOptions = { get model() { return effectiveModel.value } }
const { loading, send } = useChat(chatOptions)

const isExpanded = computed(() => props.data?.expanded === true)

const handleContentInput = (e) => update({ content: e.target.value })
const handlePromptInput = value => update({ prompt: value })
const handleModelChange = (value) => {
  const option = modelSelectOptions.value.find(item => item.value === value)
  if (option?.sourceProvider) modelStore.setProvider(option.sourceProvider)
  update({ model: value })
}
const handleCountChange = (value) => update({ count: Number(value) })

const collapse = () => update({ expanded: false })
const focusEditor = () => {
  editorRef.value?.focus()
}

/** 收缩态点击内容区 → 展开并选中 | Click collapsed body to expand */
const handleBodyClick = () => {
  if (!isExpanded.value) {
    update({ expanded: true })
    nodes.value = nodes.value.map(n => ({ ...n, selected: n.id === props.id }))
  }
}

/** 简单 Markdown 格式化：在选区两侧包语法 | Wrap selection with markdown syntax */
const applyFormat = (token) => {
  const el = editorRef.value
  if (!el) return
  const { selectionStart: start, selectionEnd: end, value } = el
  const selected = value.slice(start, end) || '文本'
  const next = `${value.slice(0, start)}${token}${selected}${token}${value.slice(end)}`
  update({ content: next })
}

const applyHeading = (level) => {
  const el = editorRef.value
  if (!el) return
  const { value } = el
  const line = `${'#'.repeat(level)} ${value || ''}`
  update({ content: value ? `${value}\n${line}` : line })
}

const applyList = () => {
  const el = editorRef.value
  if (!el) return
  const next = el.value ? `${el.value}\n1. ` : '1. '
  update({ content: next })
}

const handleSend = async () => {
  const prompt = String(props.data?.prompt || '').trim()
  const source = String(props.data?.content || '').trim()
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
  if (!prompt && !source && !upstreamText.value && !upstreamImages.value.length) {
    window.$message?.warning('请输入生成或改写要求')
    return
  }

  try {
    update({ error: '', loading: true, model: effectiveModel.value })
    // 上游注入：连入的文本 + 连入的图片（多模态）
    const parts = [prompt, upstreamText.value].filter(Boolean)
    const request = parts.length ? `${parts.join('\n')}\n\n原始内容：\n${source}` : source
    const result = await send(request, true, {
      images: upstreamImages.value.map(img => img.url),
      providerId: providerId.value
    })
    if (result) update({ content: result, loading: false, updatedAt: Date.now() })
    window.$message?.success('文本生成完成')
  } catch (err) {
    update({ error: err.message || '文本生成失败', loading: false })
    window.$message?.error(err.message || '文本生成失败')
  }
}

const handleAction = (action) => {
  if (action === 'duplicate') duplicate()
  else if (action === 'delete') remove()
}
</script>

<style scoped>
.text-card { width: 520px; }
.flow-node-collapsed .text-card { width: 422px; }
.flow-node-collapsed .flow-card-body { margin: 8px; border-radius: 12px; }
</style>
