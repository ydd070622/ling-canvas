/**
 * useUpstreamInputs - 收集连入当前节点的上游数据 | Collect upstream connected inputs
 *
 * 依赖图语义：上游输出 = 下游输入。
 * 文本连入 → 拼成提示词文本；图片连入 → 参考图（图片节点）/ 首尾帧（视频节点，按槽位）。
 */
import { computed } from 'vue'
import { nodes, edges } from '../stores/canvas'

export function useUpstreamInputs(nodeId) {
  /** 所有连入当前节点的边 + 源节点 */
  const upstreams = computed(() => edges.value
    .filter(edge => edge.target === nodeId)
    .map(edge => ({
      edge,
      node: nodes.value.find(n => n.id === edge.source)
    }))
    .filter(item => item.node)
    .sort((a, b) => (Number(a.edge.data?.order) || 0) - (Number(b.edge.data?.order) || 0)))

  /** 连入的文本内容（按连接顺序拼接） */
  const upstreamText = computed(() => upstreams.value
    .filter(item => item.node.type === 'text')
    .map(item => String(item.node.data?.content || '').trim())
    .filter(Boolean)
    .join('\n'))

  /** 连入的图片（url 列表，按连接顺序） */
  const upstreamImages = computed(() => upstreams.value
    .filter(item => item.node.type === 'image' && item.node.data?.url)
    .map(item => ({ url: item.node.data.url, slot: item.edge.targetHandle, order: Number(item.edge.data?.order) || 1 })))

  /** 视频槽位：首帧 / 尾帧 / 描述（按 targetHandle 分槽） */
  const slotInputs = computed(() => {
    const slots = { first: null, last: null, prompts: [] }
    upstreams.value.forEach(item => {
      const handle = item.edge.targetHandle
      if (handle === 'first-frame' && item.node.type === 'image') {
        slots.first = item.node.data?.url || slots.first
      } else if (handle === 'last-frame' && item.node.type === 'image') {
        slots.last = item.node.data?.url || slots.last
      } else if (item.node.type === 'text') {
        const text = String(item.node.data?.content || '').trim()
        if (text) slots.prompts.push(text)
      }
    })
    return slots
  })

  return { upstreams, upstreamText, upstreamImages, slotInputs }
}
