/**
 * useNodeRefs | 节点引用 | Node references
 *
 * 取代原来的 useUpstreamInputs：上游不再是「连上就自动注入」，
 * 而是「正文里显式引用才生效」。这里把引用解析成 UI 需要的槽位/状态，
 * 以及发请求时真正要用的提示词与素材。
 */
import { computed } from 'vue'
import { nodes, edges } from '../stores/canvas'
import { computeSlots, resolveRefs, checkGenerate } from '../utils/promptRefs'

export function useNodeRefs(nodeId) {
  const node = computed(() => nodes.value.find(n => String(n.id) === String(nodeId)))
  const slotState = computed(() => node.value
    ? computeSlots(node.value, nodes.value, edges.value)
    : { slots: [], idle: [], modeDef: null })

  const slots = computed(() => slotState.value.slots)
  const idleSlots = computed(() => slotState.value.idle)
  const modeDef = computed(() => slotState.value.modeDef)
  const refs = computed(() => node.value ? resolveRefs(node.value, nodes.value, edges.value) : [])
  /** 入边总数（含当前模式下闲置的）—— 端口徽标用 */
  const inboundCount = computed(() => slots.value.length + idleSlots.value.length)

  /** @ 菜单的候选：只列本节点连入的素材 */
  const candidates = computed(() => slots.value.map(slot => ({
    edgeId: slot.edge.id,
    kind: slot.kind,
    index: slot.index,
    code: slot.code,
    role: slot.role,
    name: slot.src.data?.label || slot.src.type
  })))

  /** 引用了但还没产出内容的上游数量（生成前会提示） */
  const pendingUpstreams = computed(() => refs.value.filter(r => r.status === 'ok' && !upstreamHasContent(r)).length)

  const check = () => (node.value ? checkGenerate(node.value, nodes.value, edges.value) : { ok: false, code: 'E_NODE' })

  /** 按角色取上游素材：视频节点的首帧/尾帧靠这个 */
  const mediaByRole = computed(() => {
    const map = {}
    refs.value.forEach((r) => {
      if (r.status !== 'ok') return
      const url = r.slot.src.data?.url
      if (!url) return
      const role = r.slot.role || '参考'
      ;(map[role] = map[role] || []).push(url)
    })
    return map
  })

  /** 连入的图片素材（按引用顺序） */
  const referenceImages = computed(() => refs.value
    .filter(r => r.status === 'ok' && r.kind === 'image' && r.slot.src.data?.url)
    .map(r => r.slot.src.data.url))

  const firstFrame = computed(() => mediaByRole.value['首帧']?.[0] || '')
  const lastFrame = computed(() => mediaByRole.value['尾帧']?.[0] || '')

  /**
   * 正文转成真正发给模型的提示词。
   * 文本引用替换成上游正文（这才是「引用」的语义），
   * 图片/视频引用替换成可读标记 —— 媒体本身走接口的素材字段，不靠提示词表达。
   */
  const buildPrompt = () => {
    const text = String(node.value?.data?.prompt || '')
    let out = ''
    let last = 0
    refs.value.forEach((r) => {
      out += text.slice(last, r.from)
      if (r.status === 'ok') {
        if (r.kind === 'text') out += String(r.slot.src.data?.content || '').trim()
        else out += r.kind === 'image' ? `参考图${r.slot.index}` : `参考视频${r.slot.index}`
      } else {
        out += r.raw // 失效引用保持原样，让上游模型也看出这里有问题
      }
      last = r.to
    })
    return (out + text.slice(last)).replace(/[ \t]{2,}/g, ' ').trim()
  }

  return {
    node,
    slots,
    idleSlots,
    inboundCount,
    modeDef,
    refs,
    candidates,
    pendingUpstreams,
    mediaByRole,
    referenceImages,
    firstFrame,
    lastFrame,
    check,
    buildPrompt
  }
}

const upstreamHasContent = (ref) => {
  const src = ref.slot?.src
  if (!src) return false
  return src.type === 'text' ? !!String(src.data?.content || '').trim() : !!src.data?.url
}
