<template>
  <!-- 圆形端口 | Round port
       左右各一个 `+`：左口收上游，右口建下游。点一下出新建菜单，拖拽则连线。
       拖动时松手落到另一个节点上就连上，落到空白处就在落点出菜单 —— 三种意图共用
       同一个手势，由 Canvas 的 onConnectEnd 分辨。

       **端口在任何状态下都挂在 DOM 上**，收起时靠 opacity 隐藏，绝不能用 display:none：
       Vue Flow 的边端点取自 handle 的 getBoundingClientRect（node.handleBounds），
       元素一旦不渲染，矩形就是 0×0，边会画到节点左上角去。 -->
  <div ref="anchorRef" class="flow-port-anchor" :class="sideClass">
    <Handle
      :id="id"
      :type="type"
      :position="positionEnum"
      class="flow-port"
      :class="`flow-tone-${tone}`"
    >
      <span class="flow-port-glyph" aria-hidden="true">+</span>
    </Handle>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position, useNodeId } from '@vue-flow/core'
import { INPUT_HANDLE, OUTPUT_HANDLE } from '../../../config/nodeRegistry'

const props = defineProps({
  /** target = 输入（固定在左）；source = 输出（固定在右） */
  handleId: { type: String, default: '' },
  type: { type: String, default: 'target' },
  side: { type: String, default: 'left' },
  /** 端口类型色：text / image / video / audio / task */
  tone: { type: String, default: 'text' },
})

defineEmits([])

const id = computed(() => props.handleId || (props.type === 'source' ? OUTPUT_HANDLE : INPUT_HANDLE))
const positionEnum = computed(() => (props.side === 'right' ? Position.Right : Position.Left))
const sideClass = computed(() => `flow-port-side-${props.side}`)

/* ---------------------------------------------------------------- 点端口出菜单
 * 这里**不再**监听端口的 pointerup。原来那套是往 handle 的 DOM 节点上挂监听器
 * （`.flow-port-anchor` 是 0×0 的锚点没有命中区，Vue Flow 的 Handle 又不转发 $attrs，
 * 只能手动挂），但那个 DOM 由 Vue Flow 渲染，节点一重渲染就可能被换掉，监听器跟着失效，
 * 「点端口出菜单」就会偶发失灵。
 *
 * 现在统一由 Canvas 的 `onConnectEnd` 判定：Vue Flow 的手势永远会走到那里，
 * 松手时位移小于阈值就是"点端口"，否则是拖线。
 */
const nodeId = useNodeId()
</script>
