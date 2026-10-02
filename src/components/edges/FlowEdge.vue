<template>
  <!-- 语义连线 | Flow edge
       线上不再常驻任何标签 —— 引用关系已经写在节点的正文里（{{Image 1}}）。
       **点一下线，小剪刀钉在中点上，点剪刀断开**；悬停也会浮出来，但只靠悬停太难命中
       （20px 的命中带要一直踩着，稍微一偏就灭）。

       命中带（`.flow-edge-hit`）只负责接手势，不负责断线：点它只是"选中这条线"。
       真正的断线动作在剪刀那颗按钮上，避免手一抖就把线剪了。 -->
  <path
    class="flow-edge-hit"
    :data-edge-id="id"
    :d="path"
    vector-effect="non-scaling-stroke"
    @pointerdown.stop
    @mouseenter="onEnter"
    @mousemove="moveScissors"
    @mouseleave="onLeave"
    @click.stop="selectEdge"
  />
  <path v-if="!isIdle && isRunning" :d="path" class="flow-edge-stream" pathLength="100" />
  <BaseEdge
    :interaction-width="0"
    :id="id"
    :path="path"
    :marker-end="markerEnd"
    :style="edgeStyle"
    class="flow-edge"
  />

  <EdgeLabelRenderer>
    <div
      v-if="revealed"
      class="flow-edge-actions"
      :style="actionStyle"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
    >
      <button
        class="flow-edge-scissors nodrag nopan"
        type="button"
        title="断开这条连线"
        @click.stop="cut"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="6.8" r="2.4" />
          <circle cx="6" cy="17.2" r="2.4" />
          <path d="M20 4.6 8 15.4M20 19.4 8 8.6" />
        </svg>
      </button>
    </div>
  </EdgeLabelRenderer>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useVueFlow } from '@vue-flow/core'
import { cutEdge, nodeSlots, nodes, edges } from '../../stores/canvas'
import { activeEdgeId, clearEdgeFocus, focusEdge } from '../../composables/useEdgeFocus'
import { isEdgeRunning } from '../../utils/edgeRunState'

const props = defineProps({
  id: String,
  source: String,
  target: String,
  sourceX: Number,
  sourceY: Number,
  targetX: Number,
  targetY: Number,
  sourcePosition: String,
  targetPosition: String,
  data: Object,
  markerEnd: String,
  style: Object,
  selected: Boolean
})

const { viewport, screenToFlowCoordinate } = useVueFlow()
const hovered = ref(false)
const isRunning = computed(() => isEdgeRunning(
  nodes.value.find(node => node.id === props.source), nodes.value.find(node => node.id === props.target)
))
const cursorPosition = ref(null)
const moveScissors = event => {
  cursorPosition.value = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
}
const selectEdge = () => {
  nodes.value = nodes.value.map(node => node.selected ? { ...node, selected: false } : node)
  edges.value = edges.value.map(edge => ({ ...edge, selected: edge.id === props.id }))
  focusEdge(props.id)
}
let leaveTimer = null

// 连线直接使用 Vue Flow 根据真实 Handle 测量的端点。
/**
 * `getBezierPath` 顺手把**曲线自身的中点**算出来了（labelX / labelY）。
 * 剪刀必须落在这上面 —— 早先拿 `(sourceX + targetX) / 2` 手算中点，那是两个端点的
 * 中点、不是曲线的中点；端点坐标又和实际画的线差了十几像素，于是剪刀飘在线旁边，
 * 想点它得先离开线，鼠标一离开剪刀就没了。
 */
const geometry = computed(() => getBezierPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  targetX: props.targetX,
  targetY: props.targetY,
  sourcePosition: props.sourcePosition,
  targetPosition: props.targetPosition,
  curvature: 0.32
}))

const path = computed(() => geometry.value[0])

/** 这条边在当前模式下落进了「闲置」时就画成虚线 */
const isIdle = computed(() => {
  if (!props.target) return false
  return nodeSlots(props.target).idle.some(item => item.edge.id === props.id)
})

/** 悬停或点中：剪刀露出来 */
const revealed = computed(() => hovered.value || props.selected || activeEdgeId.value === String(props.id))

const edgeStyle = computed(() => ({
  stroke: isIdle.value ? 'var(--flow-text-faint)' : 'var(--flow-accent)',
  strokeWidth: revealed.value || props.selected ? 2.8 : isIdle.value ? 1.6 : 1.75,
  opacity: isIdle.value ? 0.5 : revealed.value ? 1 : 0.8,
  ...props.style
}))

/** 剪刀落在曲线中点上，并按画布缩放反向补偿，保证恒定屏幕尺寸 */
const actionStyle = computed(() => {
  const labelX = cursorPosition.value?.x ?? geometry.value[1]
  const labelY = cursorPosition.value?.y ?? geometry.value[2]
  const zoom = viewport.value?.zoom || 1
  return {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${1 / zoom})`,
    transformOrigin: 'center'
  }
})

/** 鼠标要从线上移到剪刀上，给一点宽限时间，避免中途熄灭 */
const onEnter = event => { clearTimeout(leaveTimer); hovered.value = true; if (event?.currentTarget?.tagName?.toLowerCase() === 'path') moveScissors(event) }
const onLeave = () => {
  clearTimeout(leaveTimer)
  leaveTimer = setTimeout(() => { hovered.value = false }, 240)
}

const cut = () => { hovered.value = false; cutEdge(props.id) }

onBeforeUnmount(() => {
  clearTimeout(leaveTimer)
  // 线被剪掉（或整块画布卸载）时把"点中的是哪条"一起收掉，否则 id 会指向一条不存在的边
  if (activeEdgeId.value === String(props.id)) clearEdgeFocus()
})
</script>
