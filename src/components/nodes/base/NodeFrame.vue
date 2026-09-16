<template>
  <!-- 节点外壳 | Node frame
       三种内容节点（文本/图片/视频）共用的卡片骨架：头部、提示条、端口、
       正文富文本字段、底部动作条、折叠态内容预览、引用顺序浮层。
       各节点只需通过插槽补上自己的内容区、元信息条与额外操作。 -->
  <div
    class="flow-node-outer"
    :class="[`flow-node-${tone}`, { 'flow-node-collapsed': !expanded, 'is-dropzone': dragOver }]"
    @dragover="onDragOver"
    @dragleave="dragOver = false"
    @drop="onDrop"
  >
    <span v-if="!expanded" class="flow-collapsed-label">{{ title }}</span>

    <NodeToolbar>
      <div class="flow-tb-group">
        <button
          v-if="tone !== 'text'"
          class="flow-tool-btn nodrag"
          type="button"
          :title="`上传本地${tone === 'video' ? '视频' : '图片'}`"
          @click="emit('upload')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></svg>
        </button>
        <button class="flow-tool-btn nodrag" type="button" title="创建副本" @click="emit('duplicate')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2.2" /><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" /></svg>
        </button>
        <button class="flow-tool-btn nodrag" type="button" :title="expanded ? '折叠' : '展开'" @click="emit('toggle-collapse')">
          <svg v-if="expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H3v-6M15 3h6v6M21 3l-7 7M3 21l7-7" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9V3h6M21 15v6h-6M21 3l-7 7M3 21l7-7" /></svg>
        </button>
      </div>
      <div class="flow-tb-sep"></div>
      <div class="flow-tb-group">
        <button class="flow-tool-btn flow-tool-danger nodrag" type="button" title="删除" @click="emit('remove')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M10 4h4M6.5 7l.8 12.2a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L17.5 7" /></svg>
        </button>
      </div>
    </NodeToolbar>

    <div class="flow-card" :class="{ 'flow-card-stale': stale, 'flow-card-failed': failed }">
      <div class="flow-card-head">
        <span class="flow-head-left">
          <span class="flow-head-dot" :class="`flow-tone-${tone}`"></span>
          <span
            ref="titleRef"
            class="flow-head-title"
            title="双击重命名"
            @dblclick="startRename"
          >{{ title }}</span>
        </span>
        <span class="flow-head-right">
          <span class="flow-status" :class="statusClass"><i></i>{{ statusText }}</span>
        </span>
      </div>

      <div v-for="(notice, index) in notices" :key="index" class="flow-notice" :class="`is-${notice.kind}`">
        <span class="flow-notice-text">{{ notice.text }}</span>
        <button
          v-for="action in notice.actions"
          :key="action.act"
          type="button"
          :class="{ 'is-ghost': action.ghost }"
          @click="emit('notice-action', action.act)"
        >{{ action.label }}</button>
      </div>

      <div class="flow-card-body">
        <div class="flow-stage"><slot name="body" /></div>
      </div>

      <div v-if="tone !== 'text'" class="flow-card-meta"><slot name="meta" /></div>

      <PromptField
        :model-value="prompt"
        :refs="refs"
        :candidates="candidates"
        :placeholder="placeholder"
        well
        @update:model-value="emit('update-prompt', $event)"
        @insert-ref="emit('insert-ref', $event)"
      />

      <div class="flow-card-footer">
        <slot name="footer-actions" />
        <span class="flow-footer-note" v-html="footerNote"></span>
        <button
          class="flow-send-btn nodrag"
          :class="{ 'flow-send-cancel': busy }"
          type="button"
          :disabled="!busy && disabled"
          :title="busy ? '取消生成' : '发送生成'"
          @click="emit(busy ? 'cancel' : 'send')"
        >
          <svg v-if="busy" class="flow-stop-icon" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.1c.9-.4.9-1.2 0-1.6L3.4 3.6c-.8-.3-1.4.2-1.4 1L4 12l-2 7.4c0 .8.6 1.3 1.4 1z" /></svg>
        </button>
      </div>

      <div v-if="!expanded" class="flow-peek"><slot name="peek" /></div>

      <NodePort
        ref="inPortRef"
        type="target"
        side="left"
        :tone="tone"
        :count="inboundCount"
        @inspect="refPopOpen = true"
      />
      <NodePort type="source" side="right" :tone="tone" />
    </div>

    <RefOrderPopover v-model:show="refPopOpen" :node-id="nodeId" :anchor="portAnchor" />
  </div>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import NodeToolbar from './NodeToolbar.vue'
import NodePort from './NodePort.vue'
import PromptField from './PromptField.vue'
import RefOrderPopover from './RefOrderPopover.vue'
import { updateNode } from '../../../stores/canvas'

const props = defineProps({
  nodeId: { type: String, required: true },
  tone: { type: String, default: 'text' },
  title: { type: String, default: '' },
  expanded: { type: Boolean, default: true },
  prompt: { type: String, default: '' },
  refs: { type: Array, default: () => [] },
  candidates: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  inboundCount: { type: Number, default: 0 },
  statusText: { type: String, default: '' },
  statusClass: { type: String, default: '' },
  notices: { type: Array, default: () => [] },
  footerNote: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  stale: { type: Boolean, default: false },
  failed: { type: Boolean, default: false }
})

const emit = defineEmits([
  'send', 'cancel', 'remove', 'duplicate', 'toggle-collapse',
  'upload', 'drop-file', 'update-prompt', 'insert-ref', 'notice-action'
])

const refPopOpen = ref(false)
const inPortRef = ref(null)
const portAnchor = computed(() => inPortRef.value?.$el || null)

/* 拖文件到节点上：媒体节点才接收 */
const dragOver = ref(false)
const onDragOver = (event) => {
  if (props.tone === 'text' || !event.dataTransfer?.types?.includes('Files')) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}
const onDrop = (event) => {
  dragOver.value = false
  if (props.tone === 'text') return
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  event.preventDefault()
  event.stopPropagation()
  emit('drop-file', file)
}

/* 双击标题原地重命名 */
const titleRef = ref(null)
const startRename = () => {
  const el = titleRef.value
  if (!el) return
  el.contentEditable = 'true'
  el.focus()
  window.getSelection()?.selectAllChildren(el)
  const finish = () => {
    el.contentEditable = 'false'
    const next = el.textContent.trim()
    if (next && next !== props.title) updateNode(props.nodeId, { label: next })
    else el.textContent = props.title
  }
  el.addEventListener('blur', finish, { once: true })
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); el.blur() }
    if (event.key === 'Escape') { el.textContent = props.title; el.blur() }
  })
  nextTick(() => window.getSelection()?.selectAllChildren(el))
}
</script>
