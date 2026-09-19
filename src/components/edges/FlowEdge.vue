<template>
  <!-- 语义连线 | Flow edge
       线上不再常驻任何标签 —— 引用关系已经写在节点的正文里（{{Image 1}}）。
       **点一下线，小剪刀钉在中点上，点剪刀断开**；悬停也会浮出来，但只靠悬停太难命中
       （20px 的命中带要一直踩着，稍微一偏就灭）。

       命中带（`.flow-edge-hit`）只负责接手势，不负责断线：点它只是"选中这条线"。
       真正的断线动作在剪刀那颗按钮上，避免手一抖就把线剪了。 -->
  <path
    class="flow-edge-hit"
    :d="path"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @click.stop="focusEdge(props.id)"
  />
  <BaseEdge
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
import { cutEdge, nodeSlots } from '../../stores/canvas'
import { activeEdgeId, clearEdgeFocus, focusEdge } from '../../composables/useEdgeFocus'

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

const { viewport, findNode } = useVueFlow()
const hovered = ref(false)
let leaveTimer = null

/**
 * 连线端点按**节点卡片的边**算，不用 Vue Flow 传进来的 handle 坐标。
 *
 * 两个原因：
 * 1) 端口在视觉上被挪到了卡片外侧（见 flow-nodes.css 的「端口挪到卡片外面」），
 *    handle 坐标跟着一起外移，线端就会停在卡片外面 —— 缩小时那段空隙看着就像线断了；
 * 2) handle 的位置是 Vue Flow 缓存的（节点尺寸变化才重算），实测与 DOM 里的实际位置
 *    能差出十几像素，拿它画线本来就不稳。
 *
 * 节点几何是权威的：左边出、右边进，竖向取卡片中点 —— 与端口画在哪儿无关。
 */
const anchorX = (nodeId, side, fallback) => {
  const node = findNode(nodeId)
  if (!node) return fallback
  const width = node.dimensions?.width || node.measured?.width || node.width || 0
  if (!width) return fallback
  return side === 'right' ? node.position.x + width : node.position.x
}
const anchorY = (nodeId, fallback) => {
  const node = findNode(nodeId)
  if (!node) return fallback
  const height = node.dimensions?.height || node.measured?.height || node.height || 0
  if (!height) return fallback
  return node.position.y + height / 2
}

/**
 * `getBezierPath` 顺手把**曲线自身的中点**算出来了（labelX / labelY）。
 * 剪刀必须落在这上面 —— 早先拿 `(sourceX + targetX) / 2` 手算中点，那是两个端点的
 * 中点、不是曲线的中点；端点坐标又和实际画的线差了十几像素，于是剪刀飘在线旁边，
 * 想点它得先离开线，鼠标一离开剪刀就没了。
 */
const geometry = computed(() => getBezierPath({
  sourceX: anchorX(props.source, 'right', props.sourceX),
  sourceY: anchorY(props.source, props.sourceY),
  targetX: anchorX(props.target, 'left', props.targetX),
  targetY: anchorY(props.target, props.targetY),
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
const revealed = computed(() => hovered.value || activeEdgeId.value === String(props.id))

const edgeStyle = computed(() => ({
  stroke: isIdle.value ? 'var(--flow-text-faint)' : 'var(--flow-accent)',
  strokeWidth: revealed.value ? 2.8 : isIdle.value ? 1.6 : 1.75,
  opacity: isIdle.value ? 0.5 : revealed.value ? 1 : 0.8,
  ...props.style
}))

/** 剪刀落在曲线中点上，并按画布缩放反向补偿，保证恒定屏幕尺寸 */
const actionStyle = computed(() => {
  const [, labelX, labelY] = geometry.value
  const zoom = viewport.value?.zoom || 1
  return {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${1 / zoom})`,
    transformOrigin: 'center'
  }
})

/** 鼠标要从线上移到剪刀上，给一点宽限时间，避免中途熄灭 */
const onEnter = () => { clearTimeout(leaveTimer); hovered.value = true }
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
