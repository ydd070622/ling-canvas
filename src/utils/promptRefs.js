/**
 * Prompt references | 提示词里的上游引用
 *
 * 全显式引用模型：连了线不等于用了上游素材，必须在正文里写 `@图片1` / `@文本2`
 * 才会生效。编号 = 该类型入边按 `edge.data.order` 升序的位次。
 *
 * token 字面量与绑定键同名（`@图片1` ↔ key `图片1`），统一由 `refKey()` 产出，
 * 不要在别处手拼这个格式。
 *
 * 这些函数都是纯函数（显式传入 nodes / edges），便于单独验证。
 */
import {
  KIND_TITLE, KIND_CODE, getAcceptLimit, getSlotRole, getModeDef, isReferenceableType
} from '../config/nodeRegistry'
import { presetTextOf } from '../config/promptPresets'

export const TOKEN_RE = /@(文本|图片|视频|音频)(\d+)/g
const KIND_BY_TITLE = Object.fromEntries(
  Object.entries(KIND_TITLE).map(([kind, title]) => [title, kind])
)

/** token 的绑定键（不含 `@`）：`图片1` */
export const refKey = (kind, index) => `${KIND_TITLE[kind]}${index}`

/** 进入某节点的边，按入边顺序升序 */
export const incomingEdges = (nodeId, edges) =>
  edges
    .filter(edge => edge.target === nodeId)
    .sort((a, b) => (Number(a.data?.order) || 0) - (Number(b.data?.order) || 0))

/** 解析正文里所有引用 token（含位置，便于就地改写） */
export const parseTokens = (text) => {
  const out = []
  let match
  TOKEN_RE.lastIndex = 0
  const source = text || ''
  while ((match = TOKEN_RE.exec(source))) {
    out.push({
      raw: match[0],
      key: `${match[1]}${match[2]}`,
      kind: KIND_BY_TITLE[match[1]],
      index: Number(match[2]),
      from: match.index,
      to: match.index + match[0].length
    })
  }
  return out
}

export const makeToken = (kind, index) => `@${refKey(kind, index)}`

/**
 * 入边 → 槽位 | Map inbound edges onto semantic slots
 *
 * 容量之外的边落进 `idle`（仍保留连线，只是当前模式用不到、也不占编号）。
 *
 * 先收集**全部可引用上游的种类**再逐个分配槽位：auto 节点要靠这份种类清单反推模式
 * （接 1 张图 → 图生图，2 张 → 首尾帧），边分配边算会得到互相矛盾的槽位语义。
 */
export const computeSlots = (node, nodes, edges) => {
  const inbound = incomingEdges(node?.id, edges)
  const sources = inbound.map(edge => nodes.find(n => n.id === edge.source))
  const sourceKinds = sources.filter(src => isReferenceableType(src?.type)).map(src => src.type)

  const used = {}
  const slots = []
  const idle = []

  inbound.forEach((edge, i) => {
    const src = sources[i]
    if (!src || !isReferenceableType(src.type)) return
    const kind = src.type
    const limit = getAcceptLimit(node, kind, sourceKinds)
    const taken = used[kind] || 0
    if (limit === 0 || taken >= limit) {
      idle.push({ edge, src, kind })
      return
    }
    used[kind] = taken + 1
    slots.push({
      edge,
      src,
      kind,
      index: taken + 1,
      code: KIND_CODE[kind] + (taken + 1),
      token: makeToken(kind, taken + 1),
      role: getSlotRole(node, kind, taken, sourceKinds)
    })
  })

  return { slots, idle, modeDef: getModeDef(node, sourceKinds) }
}

/** 解析每个 token 的状态：ok / orphan（绑定边已删）/ beyond（编号越界） */
export const resolveRefs = (node, nodes, edges) => {
  const { slots } = computeSlots(node, nodes, edges)
  const byKind = {}
  slots.forEach(s => { (byKind[s.kind] = byKind[s.kind] || []).push(s) })

  return parseTokens(node?.data?.prompt).map((token) => {
    const binding = node?.data?.refBindings?.[token.key]
    if (binding) {
      const hit = slots.find(s => s.edge.id === binding)
      return hit ? { ...token, status: 'ok', slot: hit } : { ...token, status: 'orphan' }
    }
    const nth = byKind[token.kind]?.[token.index - 1]
    return nth ? { ...token, status: 'ok', slot: nth } : { ...token, status: 'beyond' }
  })
}

/**
 * 顺序变了之后重算编号，并把正文里的 token 与绑定一起改写。
 *
 * 安全底线：**绝不把「已失效引用」占用的编号让给别的引用**。否则原本指向已删素材的
 * 引用会被悄悄改成指向另一张图，两端都显示正常、生成时毫无警告。一旦发现这种冲突，
 * 整批跳过重写并把 conflitted 置为 true，交给调用方提示用户。
 *
 * @returns {{prompt: string, refBindings: object, tokens: object[], collided: boolean, changed: boolean}}
 */
export const renumberRefs = (node, nodes, edges) => {
  const { slots } = computeSlots(node, nodes, edges)
  const byEdge = new Map(slots.map(s => [s.edge.id, s]))
  const tokens = parseTokens(node?.data?.prompt)
  const bindings = node?.data?.refBindings || {}
  const boundEdge = token => bindings[token.key]

  // 正文里还留着、但来源边已被删掉的引用所占的编号
  const orphanKeys = new Set(
    tokens.filter(t => boundEdge(t) && !byEdge.has(boundEdge(t))).map(t => t.key)
  )

  const keyFor = (token) => {
    const edgeId = boundEdge(token)
    if (!edgeId) return null
    const slot = byEdge.get(edgeId)
    return slot ? refKey(slot.kind, slot.index) : token.key
  }

  const rewrites = []
  let collided = false
  tokens.forEach((token) => {
    const key = keyFor(token)
    if (!key || key === token.key) return
    if (orphanKeys.has(key)) { collided = true; return }
    rewrites.push({ from: token.from, to: token.to, text: `@${key}` })
  })

  if (collided) {
    return { prompt: node.data.prompt, refBindings: bindings, tokens, collided: true, changed: false }
  }
  if (!rewrites.length) {
    return { prompt: node.data.prompt, refBindings: bindings, tokens, collided: false, changed: false }
  }

  let prompt = node.data.prompt || ''
  ;[...rewrites].sort((a, b) => b.from - a.from).forEach((r) => {
    prompt = prompt.slice(0, r.from) + r.text + prompt.slice(r.to)
  })

  const nextBindings = {}
  tokens.forEach((token) => {
    const key = keyFor(token)
    if (key) nextBindings[key] = boundEdge(token)
  })

  return { prompt, refBindings: nextBindings, tokens, collided: false, changed: true }
}

/**
 * 生成前校验 | Pre-flight check
 * @returns {{ok:boolean, code?:string, message?:string, refs:Array, slots:Array, warn?:string, actions?:Array}}
 */
export const checkGenerate = (node, nodes, edges) => {
  const { slots } = computeSlots(node, nodes, edges)
  const refs = resolveRefs(node, nodes, edges)
  const prompt = String(node?.data?.prompt || '').trim()

  const orphan = refs.find(r => r.status === 'orphan')
  if (orphan) {
    return {
      ok: false, code: 'E_ORPHAN', refs, slots,
      message: `正文里的 ${orphan.raw} 已失效：来源连线已被断开。请重新连接上游，或点「移除失效引用」。`
    }
  }

  const beyond = refs.find(r => r.status === 'beyond')
  if (beyond) {
    const count = slots.filter(s => s.kind === beyond.kind).length
    const what = KIND_TITLE[beyond.kind] || '内容'
    return {
      ok: false, code: 'E_BEYOND', refs, slots,
      message: `引用了不存在的 ${beyond.raw}：当前仅连入 ${count} 个${what}。`
    }
  }

  const isText = node.type === 'text'
  const hasOwnContent = isText ? !!String(node.data?.content || '').trim() : !!node.data?.url
  // 选了提示词预设也算"有内容"：它不进正文，但生成时会拼在最前面
  const hasPreset = !!presetTextOf(node?.data?.preset)
  // 连进来的文本上游同样算内容：连线即使用，它的正文会拼进提示词
  const hasUpstreamText = slots.some(
    slot => slot.kind === 'text' && String(slot.src.data?.content || '').trim()
  )
  if (!prompt && !hasOwnContent && !hasPreset && !hasUpstreamText) {
    return {
      ok: false, code: 'E_EMPTY', refs, slots,
      message: isText ? '请输入内容，或连入上游。' : '请输入提示词，或连入上游。'
    }
  }

  /**
   * 这里原本有一条 `W_UNREF`（「连了上游但正文里没引用，本次生成不会用到它们」）。
   *
   * 改成**连线即使用**之后它不可能成立了：连上来的就是本次要用的，不再要求正文里点名。
   * 留着只会误导 —— 用户连了一张参考图，却被告诉"不会用到"。
   */
  return { ok: true, refs, slots }
}

export const defaultRefBindings = () => ({})

/**
 * 删除正文里的失效引用 | Drop orphan tokens
 * @param {object} node
 * @param {Array} nodes
 * @param {Array} edges
 */
export const removeOrphanRefs = (node, nodes, edges) => {
  const orphanRefs = resolveRefs(node, nodes, edges).filter(r => r.status === 'orphan')
  if (!orphanRefs.length) return null
  let prompt = node.data.prompt || ''
  ;[...orphanRefs].sort((a, b) => b.from - a.from).forEach((r) => {
    prompt = prompt.slice(0, r.from) + prompt.slice(r.to)
  })
  const refBindings = { ...(node.data.refBindings || {}) }
  orphanRefs.forEach(r => { delete refBindings[r.key] })
  return { prompt: prompt.replace(/[ \t]{2,}/g, ' ').trim(), refBindings }
}

/** 为某条边生成它在目标节点里的引用 token（@ 菜单用） */
export const tokenForEdge = (node, edge, nodes, edges) => {
  const { slots, idle } = computeSlots(node, nodes, edges)
  const slot = slots.find(s => s.edge.id === edge.id)
  if (slot) return { token: slot.token, key: refKey(slot.kind, slot.index), slot }
  const idleItem = idle.find(i => i.edge.id === edge.id)
  return idleItem ? { token: null, key: null, idle: idleItem } : null
}
