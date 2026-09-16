/**
 * Prompt references | 提示词里的上游引用
 *
 * 全显式引用模型：连了线不等于用了上游素材，必须在正文里写 `{{Text 1}}` /
 * `{{Image 2}}` 才会生效。编号 = 该类型入边按 `edge.data.order` 升序的位次。
 *
 * 这些函数都是纯函数（显式传入 nodes / edges），便于单独验证。
 */
import { KIND_TITLE, KIND_CODE, getAcceptLimit, getSlotRole, getModeDef } from '../config/nodeRegistry'

export const TOKEN_RE = /\{\{\s*(Image|Video|Text)\s+(\d+)\s*\}\}/g
const KIND_BY_TITLE = { Image: 'image', Video: 'video', Text: 'text' }

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
      key: `${match[1]} ${match[2]}`,
      kind: KIND_BY_TITLE[match[1]],
      index: Number(match[2]),
      from: match.index,
      to: match.index + match[0].length
    })
  }
  return out
}

export const makeToken = (kind, index) => `{{${KIND_TITLE[kind]} ${index}}}`

/**
 * 入边 → 槽位 | Map inbound edges onto semantic slots
 *
 * 容量之外的边落进 `idle`（仍保留连线，只是当前模式用不到、也不占编号）。
 */
export const computeSlots = (node, nodes, edges) => {
  const used = {}
  const slots = []
  const idle = []

  incomingEdges(node?.id, edges).forEach((edge) => {
    const src = nodes.find(n => n.id === edge.source)
    if (!src || src.type === 'group') return
    const kind = src.type
    const limit = getAcceptLimit(node, kind)
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
      role: getSlotRole(node, kind, taken)
    })
  })

  return { slots, idle, modeDef: getModeDef(node) }
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
    return slot ? `${KIND_TITLE[slot.kind]} ${slot.index}` : token.key
  }

  const rewrites = []
  let collided = false
  tokens.forEach((token) => {
    const key = keyFor(token)
    if (!key || key === token.key) return
    if (orphanKeys.has(key)) { collided = true; return }
    rewrites.push({ from: token.from, to: token.to, text: `{{${key}}}` })
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
    const what = beyond.kind === 'image' ? '图片' : beyond.kind === 'video' ? '视频' : '文本'
    return {
      ok: false, code: 'E_BEYOND', refs, slots,
      message: `引用了不存在的 ${beyond.raw}：当前仅连入 ${count} 个${what}。`
    }
  }

  const isText = node.type === 'text'
  const hasOwnContent = isText ? !!String(node.data?.content || '').trim() : !!node.data?.url
  if (!prompt && !refs.length && !hasOwnContent) {
    return {
      ok: false, code: 'E_EMPTY', refs, slots,
      message: isText ? '请输入内容，或连入上游并在正文里引用。' : '请输入提示词，或连入上游并在正文里引用。'
    }
  }

  const usedEdges = new Set(refs.map(r => r.slot?.edge.id).filter(Boolean))
  const unused = slots.filter(s => !usedEdges.has(s.edge.id))
  if (unused.length) {
    return {
      ok: true, warn: 'W_UNREF', refs, slots,
      message: `连入了 ${unused.length} 个上游但正文里没有引用，本次生成不会用到它们。`,
      actions: [{ label: '插入引用', act: 'insert-refs' }, { label: '仍然生成', act: 'run-anyway', ghost: true }]
    }
  }

  return { ok: true, refs, slots }
}

export const defaultStale = () => ({ is: false, reason: null, since: null })
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
  if (slot) return { token: slot.token, key: `${KIND_TITLE[slot.kind]} ${slot.index}`, slot }
  const idleItem = idle.find(i => i.edge.id === edge.id)
  return idleItem ? { token: null, key: null, idle: idleItem } : null
}
