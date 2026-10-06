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
import { presetTextOf } from '../config/promptPresets'

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
    slots.value.forEach((slot) => {
      const url = slot.src.data?.url
      if (!url) return
      const role = slot.role || '参考'
      ;(map[role] = map[role] || []).push(url)
    })
    return map
  })

  /**
   * 本次要发给模型的图片素材。
   *
   * **连线即使用** —— 取的是槽位（实际连上来的上游），不是正文里写没写 `@图片1`。
   * 之前是"连了线还要在正文里点名才算用"，结果连了一张参考图却被告知"本次生成不会用到它"，
   * 与直觉相悖。现在连上就送出去，正文里的 `@图片1` 只用来在句子里指代某一张。
   */
  const referenceImages = computed(() => slots.value
    .filter(slot => slot.kind === 'image' && slot.src.data?.url)
    .map(slot => slot.src.data.url))

  const firstFrame = computed(() => mediaByRole.value['首帧']?.[0] || '')
  const lastFrame = computed(() => mediaByRole.value['尾帧']?.[0] || '')

  /**
   * 正文转成真正发给模型的提示词。
   *
   * 顺序：**预设 → 正文（token 就地展开）→ 没被点名的上游正文**。
   * 正文里的 `@文本1` 会换成该上游的正文（这就是在句子里指代它）；
   * 连上但没在正文里点名的文本上游同样算用到，接在末尾 —— 否则用户连了文本却毫无作用，
   * 又要靠一条警告去解释。媒体不走提示词表达，它们在请求的素材字段里。
   */
  const buildPrompt = () => {
    const text = String(node.value?.data?.prompt || '')
    const usedEdges = new Set()
    let out = ''
    let last = 0
    refs.value.forEach((r) => {
      out += text.slice(last, r.from)
      if (r.status === 'ok') {
        usedEdges.add(r.slot.edge.id)
        if (r.kind === 'text') out += String(r.slot.src.data?.content || '').trim()
        else out += r.kind === 'image' ? `参考图${r.slot.index}` : `参考视频${r.slot.index}`
      } else if (r.kind !== 'image') {
        out += r.raw
      }
      last = r.to
    })

    const parts = [(out + text.slice(last)).replace(/[ \t]{2,}/g, ' ').trim()]
    slots.value
      .filter(slot => slot.kind === 'text' && !usedEdges.has(slot.edge.id))
      .map(slot => String(slot.src.data?.content || '').trim())
      .filter(Boolean)
      .forEach(content => parts.push(content))

    const body = parts.filter(Boolean).join('\n')
    const preset = presetTextOf(node.value?.data?.preset)
    return preset ? `${preset}\n${body}`.trim() : body
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
