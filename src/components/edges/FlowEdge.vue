<template>
  <!-- Flow edge with semantic label | 带语义标签的连线 -->
  <BaseEdge
    :id="id"
    :path="path"
    :marker-end="markerEnd"
    :style="edgeStyle"
    class="flow-edge"
  />
  <EdgeLabelRenderer>
    <div
      v-if="label"
      :style="{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: 'all'
      }"
      class="nodrag nopan"
    >
      <span class="flow-edge-label">
        {{ label }}
        <span v-if="order > 1" class="edge-order">{{ order }}</span>
      </span>
    </div>
  </EdgeLabelRenderer>
</template>

<script setup>
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@vue-flow/core'

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

// 语义标签 | Semantic label
const label = computed(() => props.data?.label || '')

// 同语义第 N 条（提示词 2、提示词 3…）| Nth edge of same semantic
const order = computed(() => Number(props.data?.order) || 1)

// 边颜色按源节点类型着色 | Edge color follows source node type
const edgeColor = computed(() => props.data?.color || '#e8912e')

const path = computed(() => {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    curvature: 0.32
  })
  return edgePath
})

const labelX = computed(() => (props.sourceX + props.targetX) / 2)
const labelY = computed(() => (props.sourceY + props.targetY) / 2)

const edgeStyle = computed(() => ({
  stroke: edgeColor.value,
  strokeWidth: props.selected ? 3 : 2,
  opacity: props.selected ? 1 : 0.85,
  ...props.style
}))
</script>

<style scoped>
.flow-edge {
  transition: stroke-width 0.15s ease, opacity 0.15s ease;
}

.flow-edge:hover {
  stroke-width: 3;
  opacity: 1;
}
</style>
