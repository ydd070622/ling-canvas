<template>
  <!-- 类型着色端口 | Type-colored port
       左侧只有一个输入口：所有上游边都挂在这一个口上，顺序即引用编号。
       收起态也照常可连 —— 连线这个动作不该被展开态绑架。 -->
  <div class="flow-port-anchor" :class="sideClass">
    <Handle
      :id="id"
      :type="type"
      :position="positionEnum"
      class="flow-port"
      :class="`flow-tone-${tone}`"
    />
    <button
      v-if="showCount"
      class="flow-port-count nodrag nopan"
      type="button"
      :title="`${count} 条入边 · 点这里调整引用顺序`"
      @mousedown.stop
      @click.stop="emit('inspect')"
    >{{ count }}</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { INPUT_HANDLE, OUTPUT_HANDLE } from '../../../config/nodeRegistry'

const props = defineProps({
  /** target = 输入（单口，固定在左）；source = 输出（固定在右） */
  type: { type: String, default: 'target' },
  side: { type: String, default: 'left' },
  /** 端口类型色：text(靛蓝) / image(绿) / video(橙) */
  tone: { type: String, default: 'text' },
  /** 入边数量；>0 时在输入口上方显示可点的徽标 */
  count: { type: Number, default: 0 }
})

const emit = defineEmits(['inspect'])

const id = computed(() => (props.type === 'source' ? OUTPUT_HANDLE : INPUT_HANDLE))
const positionEnum = computed(() => (props.side === 'right' ? Position.Right : Position.Left))
const sideClass = computed(() => `flow-port-side-${props.side}`)
const showCount = computed(() => props.type === 'target' && props.count > 0)
</script>
