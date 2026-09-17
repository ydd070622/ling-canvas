<template>
  <!-- 类型着色端口 | Type-colored port
       左侧只有一个输入口：所有上游边都挂在这一个口上，顺序即引用编号。
       收起态也照常可连 —— 连线这个动作不该被展开态绑架。
       点一下端口（不拖动）= 打开新建节点菜单，方向由是左口还是右口决定。 -->
  <div ref="anchorRef" class="flow-port-anchor" :class="sideClass">
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Handle, Position, useNodeId } from '@vue-flow/core'
import { INPUT_HANDLE, OUTPUT_HANDLE, PORT_CLICK_EVENT } from '../../../config/nodeRegistry'

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

/* ---------------------------------------------------------------- 点端口出菜单
 * 判据与 LibTV 一致：按下后 300ms 内、位移不超过 10px 松开才算「点击」；
 * 超过就是拖线，交给 Vue Flow，不弹菜单。
 * 监听器必须挂在 handle 这个 DOM 上：`.flow-port-anchor` 是 0×0 的定位锚点，
 * 没有命中区域；而 Vue Flow 的 Handle 不转发 $attrs，@click 之类写在组件上是收不到的。
 */
const CLICK_MAX_MS = 300
const CLICK_MAX_PX = 10

const nodeId = useNodeId()
const anchorRef = ref(null)
let pressAt = null

const onPointerDown = (event) => {
  pressAt = event.button === 0 ? { t: Date.now(), x: event.clientX, y: event.clientY } : null
}

const onPointerUp = (event) => {
  const start = pressAt
  pressAt = null
  // 注意 useNodeId() 返回的是普通字符串，不是 ref
  if (!start || !nodeId) return
  if (Date.now() - start.t >= CLICK_MAX_MS) return
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= CLICK_MAX_PX) return
  window.dispatchEvent(new CustomEvent(PORT_CLICK_EVENT, {
    detail: {
      nodeId,
      handleId: id.value,
      handleType: props.type,
      clientX: event.clientX,
      clientY: event.clientY
    }
  }))
}

let handleEl = null
onMounted(() => {
  handleEl = anchorRef.value?.querySelector('.vue-flow__handle') || null
  handleEl?.addEventListener('pointerdown', onPointerDown)
  handleEl?.addEventListener('pointerup', onPointerUp)
})
onBeforeUnmount(() => {
  handleEl?.removeEventListener('pointerdown', onPointerDown)
  handleEl?.removeEventListener('pointerup', onPointerUp)
  handleEl = null
})
</script>
