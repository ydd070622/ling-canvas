<template>
  <!-- 引用顺序浮层 | Reference order popover
       平时画布上没有任何常驻的引用列表；点输入口上的数字徽标才弹出这个。
       顺序决定正文里 {{Image N}} 的编号，调整后会同步重写正文。 -->
  <Teleport to="body">
    <div v-if="show" ref="panelRef" class="flow-refpop" :style="panelStyle" @mousedown.stop>
      <div class="flow-refpop-title">引用顺序 · 拖拽调整</div>

      <div
        v-for="(slot, index) in slots"
        :key="slot.edge.id"
        class="flow-refpop-row"
        :class="{ 'is-over': dragOverIndex === index, 'is-dragging': dragIndex === index }"
        draggable="true"
        @dragstart="onDragStart($event, index)"
        @dragover.prevent="dragOverIndex = index"
        @drop.prevent="onDrop(index)"
        @dragend="resetDrag"
      >
        <span class="flow-refpop-grip">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
        </span>
        <span class="flow-refpop-code" :class="`flow-tone-${slot.kind}`">{{ slot.code }}</span>
        <span class="flow-refpop-name">{{ slot.src.data?.label || slot.src.title }}</span>
        <span class="flow-refpop-role">{{ slot.role }}</span>
        <button class="flow-refpop-cut" type="button" title="断开这条连线" @click.stop="cut(slot.edge.id)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div v-for="item in idle" :key="item.edge.id" class="flow-refpop-row is-idle">
        <span class="flow-refpop-grip">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
        </span>
        <span class="flow-refpop-code is-muted">{{ KIND_CODE[item.kind] }}–</span>
        <span class="flow-refpop-name">{{ item.src.data?.label || item.src.title }}</span>
        <span class="flow-refpop-role">闲置</span>
        <button class="flow-refpop-cut" type="button" title="断开这条连线" @click.stop="cut(item.edge.id)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div class="flow-refpop-hint">顺序决定正文里 <code>{{ TOKEN_SAMPLE }}</code> 的编号，调整后会自动重写</div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { KIND_CODE } from '../../../config/nodeRegistry'
import { nodeSlots, reorderNodeEdges, cutEdge } from '../../../stores/canvas'

const props = defineProps({
  show: { type: Boolean, default: false },
  nodeId: { type: String, default: '' },
  /** 锚点元素（输入口的数字徽标） */
  anchor: { type: Object, default: null }
})
const emit = defineEmits(['update:show'])
/** 单独放常量里：直接写进模板会被当成插值，内层的 }} 会提前截断表达式 */
const TOKEN_SAMPLE = '{{Image N}}'

const panelRef = ref(null)
const slots = ref([])
const idle = ref([])
const dragIndex = ref(-1)
const dragOverIndex = ref(-1)

const refresh = () => {
  if (!props.nodeId) { slots.value = []; idle.value = []; return }
  const result = nodeSlots(props.nodeId)
  slots.value = result.slots
  idle.value = result.idle
}

watch(() => [props.show, props.nodeId], () => { if (props.show) refresh() }, { immediate: true })

const panelStyle = ref({})
const position = () => {
  const el = panelRef.value
  const anchor = props.anchor?.$el || props.anchor
  if (!el || !anchor?.getBoundingClientRect) return
  const a = anchor.getBoundingClientRect()
  const p = el.getBoundingClientRect()
  panelStyle.value = {
    left: `${Math.max(8, Math.min(a.left - p.width - 12, window.innerWidth - p.width - 10))}px`,
    top: `${Math.max(8, Math.min(a.top - 8, window.innerHeight - p.height - 10))}px`
  }
}
watch(panelRef, () => requestAnimationFrame(position))

const onDragStart = (event, index) => {
  dragIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
  try { event.dataTransfer.setData('text/plain', String(index)) } catch { /* 忽略 */ }
}
const resetDrag = () => { dragIndex.value = -1; dragOverIndex.value = -1 }
const onDrop = (index) => {
  const from = dragIndex.value
  resetDrag()
  if (from < 0 || from === index) return
  const order = slots.value.map(s => s.edge.id)
  order.splice(index, 0, order.splice(from, 1)[0])
  reorderNodeEdges(props.nodeId, order)
  refresh()
}
const cut = (edgeId) => {
  cutEdge(edgeId)
  if (!slots.value.length && !idle.value.length) emit('update:show', false)
  else refresh()
}

const onDocDown = (event) => {
  if (!props.show) return
  if (panelRef.value?.contains(event.target)) return
  if (props.anchor?.$el?.contains?.(event.target)) return
  emit('update:show', false)
}
onMounted(() => document.addEventListener('mousedown', onDocDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))

const total = computed(() => slots.value.length + idle.value.length)
</script>
