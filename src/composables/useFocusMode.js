/**
 * useFocusMode | 焦点态
 *
 * 卡片有两种状态，由**选中状态**决定，不再有"折叠"按钮：
 *
 * - **内容态**（compact）：没选中，或选了多个。只显示内容本身 —— 图片就是图片、
 *   文本就是文本，没有表头、参数行、底部动作条。
 * - **焦点态**（focused）：恰好选中一个。展开完整 chrome，可编辑参数、改提示词、生成。
 *
 * 这样做的理由是内容比控件重要：一张画布上大部分节点是"结果"，用户看的是结果，
 * 控件只在他要对某一张动手时才需要出现。
 *
 * 展开/收起会让卡片尺寸变化，而节点坐标是左上角 —— 直接用新尺寸渲染会让卡片
 * 朝右下角"长出去"。保持视觉中心不动的补偿在 `views/Canvas.vue` 的 watch 里做。
 */
import { computed } from 'vue'
import { nodes } from '../stores/canvas'

/**
 * 选中的节点 id。
 *
 * 读的是节点自己的 `selected` 字段而不是 Vue Flow 的内部选区：框选（marquee）和
 * 单击都会写这个字段，而 Vue Flow 的 `useVueFlow().getSelectedNodes` 只认它自己
 * 触发的那部分选中，两者会对不上。
 */
export const selectedNodeIds = computed(() =>
  nodes.value.filter(node => node.selected).map(node => String(node.id))
)

export const selectedCount = computed(() => selectedNodeIds.value.length)

/** 焦点节点：恰好选中一个时才是它，否则没有任何节点处于展开态 */
export const focusedNodeId = computed(() => {
  const ids = selectedNodeIds.value
  return ids.length === 1 ? ids[0] : null
})

/** 该节点是否展开完整 chrome */
export const useFocusExpanded = (id) => computed(() => focusedNodeId.value === String(id))

/** 该节点是否处于多选状态（用于描边，与单选互斥） */
export const useMultiSelected = (id) =>
  computed(() => selectedCount.value > 1 && selectedNodeIds.value.includes(String(id)))
