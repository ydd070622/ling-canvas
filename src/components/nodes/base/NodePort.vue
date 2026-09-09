<template>
  <!-- 类型着色端口（连接点）| Type-colored port (connection point) -->
  <div
    class="flow-port-anchor"
    :class="[`flow-port-side-${side}`, { 'flow-port-hidden': collapsed }]"
    :style="anchorStyle"
  >
    <Handle
      :id="id"
      :type="type"
      :position="positionEnum"
      :connectable="!collapsed"
      class="flow-port"
      :class="`flow-tone-${tone}`"
    />
    <span v-if="slotLabel && !collapsed" class="flow-port-slot">{{ slotLabel }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  /** handle 唯一 id：left / right / first-frame / last-frame / prompt 等 */
  id: { type: String, required: true },
  /** source = 输出（右侧），target = 输入（左侧） */
  type: { type: String, default: 'source' },
  /** left / right */
  side: { type: String, default: 'left' },
  /** 端口类型色：text(橙) / image(蓝) / video(紫) */
  tone: { type: String, default: 'text' },
  /** 收缩态隐藏（保留 DOM 维持连线几何） */
  collapsed: { type: Boolean, default: false },
  /** 槽位名（如 首帧 / 尾帧），显示在端口旁 */
  slotLabel: { type: String, default: '' },
  /** 垂直位置，默认 50%（视频节点多槽用） */
  top: { type: String, default: '50%' },
  nodeId: { type: String, default: '' }
})

const positionEnum = computed(() => (props.side === 'right' ? Position.Right : Position.Left))

const anchorStyle = computed(() => ({ top: props.top }))
</script>
