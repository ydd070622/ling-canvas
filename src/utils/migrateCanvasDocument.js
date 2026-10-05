import {
  CANVAS_NODE_TYPES,
  createDefaultNodeData,
  inferModeKey,
  INPUT_HANDLE,
  OUTPUT_HANDLE,
  NODE_DEFINITIONS,
  NODE_MODES
} from '../config/nodeRegistry'
import { makeToken, refKey, computeSlots, parseTokens } from './promptRefs'

/**
 * 当前画布文档版本。
 * v3 = 单一输入 handle + 逻辑分槽 + 全显式引用（`{{Image 1}}`）。
 * v4 = 引用语法换成 `@图片1`，节点类型扩到 文本/图片/视频/音频/AI任务，
 *      新节点模式改为 `auto`（由上游推断），旧节点的显式 mode 原样保留。
 */
export const CANVAS_SCHEMA_VERSION = 4

const LEGACY_TYPE_MAP = Object.freeze({
  imageConfig: 'image',
  videoConfig: 'video',
  llmConfig: 'text',
  simpleText: 'text',
  simpleImage: 'image'
})

const id = prefix => globalThis.crypto?.randomUUID
  ? `${prefix}_${globalThis.crypto.randomUUID()}`
  : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

const normalizedData = (node, outputData = {}) => {
  const type = LEGACY_TYPE_MAP[node.type] || node.type
  const legacy = node.data || {}
  const base = createDefaultNodeData(type)

  if (node.type === 'llmConfig') {
    return {
      ...base,
      ...legacy,
      ...outputData,
      content: outputData.content || legacy.outputContent || '',
      prompt: legacy.systemPrompt || legacy.prompt || '',
      expanded: legacy.expanded !== false
    }
  }

  return {
    ...base,
    ...legacy,
    ...outputData,
    expanded: legacy.expanded !== false
  }
}

/**
 * 按入边类型推断节点该用哪个生成模式（迁移时给老文档补显式 mode 用）
 *
 * 老文档一律落成**显式** mode 而不是 `auto`：它们的连线是照着当时那套模式矩阵建的，
 * 换成自动推断会把槽位语义（首帧/尾帧/底图）改掉。新文档才走 auto。
 */
const inferMode = (node, inbound, byId) => {
  const kinds = inbound.map(edge => byId.get(edge.source)?.type).filter(Boolean)
  return inferModeKey(node.type, kinds) || NODE_DEFINITIONS[node.type]?.defaultMode || null
}

/** 每个目标的入边重新编号 1..n，保证顺序连续无空洞 */
const renumberOrders = (edges) => {
  const groups = new Map()
  edges.forEach((edge) => {
    if (!groups.has(edge.target)) groups.set(edge.target, [])
    groups.get(edge.target).push(edge)
  })
  const orderById = new Map()
  groups.forEach((group) => {
    group
      .sort((a, b) => (Number(a.data?.order) || 0) - (Number(b.data?.order) || 0))
      .forEach((edge, index) => orderById.set(edge.id, index + 1))
  })
  return edges.map(edge => ({ ...edge, data: { ...(edge.data || {}), order: orderById.get(edge.id) || 1 } }))
}

/**
 * 给迁移过来的节点补引用 token。
 *
 * v2 及更早是「上游内容自动注入」，提示词里没有 `{{...}}`。如果只是把端口换成单口、
 * 引入显式引用，老项目一生成就会命中「连了线但没引用」——上游内容**突然失效**。
 * 所以这里把已有入边对应的 token 补进正文尾部，保住原有行为，用户再自己删改。
 */
const backfillRefTokens = (node, edges, nodes) => {
  const { slots } = computeSlots(node, nodes, edges)
  if (!slots.length) return node
  const existing = new Set(parseTokens(node.data.prompt).map(t => t.key))
  const missing = slots.filter(s => !existing.has(refKey(s.kind, s.index)))
  if (!missing.length) return node

  const refBindings = { ...(node.data.refBindings || {}) }
  const tokens = missing.map((slot) => {
    refBindings[refKey(slot.kind, slot.index)] = slot.edge.id
    return makeToken(slot.kind, slot.index)
  })
  const prompt = `${String(node.data.prompt || '').trim()} ${tokens.join(' ')}`.trim()
  return { ...node, data: { ...node.data, prompt, refBindings } }
}

const LEGACY_TOKEN_RE = /\{\{\s*(Image|Video|Text)\s+(\d+)\s*\}\}/g
const LEGACY_TOKEN_KEY_RE = /^(Image|Video|Text)\s+(\d+)$/
const LEGACY_KIND = { Image: 'image', Video: 'video', Text: 'text' }

/**
 * v3 → v4：引用语法改写 | Rewrite legacy `{{Image 1}}` tokens
 *
 * 正文和 `refBindings` 的键必须一起改 —— 只改正文的话绑定查不到，所有引用会集体
 * 变成 orphan（"来源连线已被断开"），生成被 `E_ORPHAN` 挡住，而用户并没有删过任何连线。
 *
 * 这一步**必须排在 backfillRefTokens 之前**：backfill 靠新语法认 token，
 * 先 backfill 会把已有引用的老 token 当成"没有引用"，在正文里再补一份，引用就重了。
 */
const rewriteLegacyTokens = (node) => {
  const prompt = String(node?.data?.prompt || '')
  const bindings = node?.data?.refBindings || {}
  LEGACY_TOKEN_RE.lastIndex = 0
  const hasTokens = LEGACY_TOKEN_RE.test(prompt)
  LEGACY_TOKEN_RE.lastIndex = 0
  const hasKeys = Object.keys(bindings).some(key => LEGACY_TOKEN_KEY_RE.test(key))
  if (!hasTokens && !hasKeys) return node

  const nextPrompt = prompt.replace(
    LEGACY_TOKEN_RE,
    (_, title, index) => makeToken(LEGACY_KIND[title], Number(index))
  )
  const nextBindings = {}
  Object.entries(bindings).forEach(([key, edgeId]) => {
    const match = key.match(LEGACY_TOKEN_KEY_RE)
    nextBindings[match ? refKey(LEGACY_KIND[match[1]], Number(match[2])) : key] = edgeId
  })
  return { ...node, data: { ...node.data, prompt: nextPrompt, refBindings: nextBindings } }
}

/**
 * 把任意历史版本归一成 v3 | Normalize any historical document to v3
 *
 * v0/v1 是「配置节点 + 输出节点」两段式，v2 是统一内容节点但带三个物理端口，
 * v3 是单口 + 逻辑分槽 + 全显式引用。
 */
export const migrateCanvasDocument = (document = {}) => {
  if (Number(document.schemaVersion) >= CANVAS_SCHEMA_VERSION) return document

  const originalNodes = Array.isArray(document.nodes) ? document.nodes : []
  const originalEdges = Array.isArray(document.edges) ? document.edges : []
  const needsConfigMerge = originalNodes.some(node => LEGACY_TYPE_MAP[node.type])
  // createDefaultNodeData 会给每个节点填上默认 mode，所以「有没有 mode」不能看合并后的数据，
  // 必须看**原始文档里作者是否显式写过**，否则推断逻辑永远不执行。
  const authoredModes = new Set(
    originalNodes
      .filter(node => node.data && typeof node.data.mode === 'string' && node.data.mode)
      .map(node => node.id)
  )
  const byId = new Map(originalNodes.map(node => [node.id, node]))

  // ---- 第一段：老的配置节点模型 → 内容节点（合并成对的配置/输出节点） ----
  const aliases = new Map()
  const mergedOutputData = new Map()
  if (needsConfigMerge) {
    originalEdges.forEach((edge) => {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      const mappedSourceType = LEGACY_TYPE_MAP[source?.type]
      if (!mappedSourceType || target?.type !== mappedSourceType) return
      aliases.set(target.id, source.id)
      mergedOutputData.set(source.id, target.data || {})
    })
  }

  const resolveAlias = (nodeId) => {
    let current = nodeId
    const visited = new Set()
    while (aliases.has(current) && !visited.has(current)) {
      visited.add(current)
      current = aliases.get(current)
    }
    return current
  }

  let nodes = originalNodes
    .filter(node => !aliases.has(node.id))
    .map((node) => {
      const type = LEGACY_TYPE_MAP[node.type] || node.type
      const merged = needsConfigMerge ? mergedOutputData.get(node.id) : undefined
      const data = needsConfigMerge ? normalizedData(node, merged) : { ...createDefaultNodeData(type), ...node.data }
      const result = { ...node, type, data }
      if (result.data?.memberIds) result.data.memberIds = result.data.memberIds.map(resolveAlias)
      return result
    })

  const migratedById = new Map(nodes.map(node => [node.id, node]))

  // ---- 第二段：边归一（映射别名、去掉组相关边、保留顺序） ----
  let edges = originalEdges.flatMap((edge) => {
    const source = resolveAlias(edge.source)
    const target = resolveAlias(edge.target)
    if (source === target) return []
    const sourceNode = migratedById.get(source)
    const targetNode = migratedById.get(target)
    if (!sourceNode || !targetNode) return []
    if (sourceNode.type === 'group' || targetNode.type === 'group') return []
    return [{
      id: edge.id?.startsWith('edge_') ? edge.id : id('edge'),
      source,
      target,
      sourceHandle: OUTPUT_HANDLE,
      targetHandle: INPUT_HANDLE,
      type: 'flowEdge',
      data: { order: Number(edge.data?.order ?? edge.data?.promptOrder ?? edge.data?.imageOrder) || 1, ...(Number.isInteger(edge.data?.referenceIndex) && edge.data.referenceIndex > 0 ? { referenceIndex: edge.data.referenceIndex } : {}) }
    }]
  })
  // 同源同目标只留一条
  const seen = new Set()
  edges = edges.filter((edge) => {
    const key = `${edge.source}>${edge.target}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  edges = renumberOrders(edges)

  // ---- 第三段：补模式、补引用 token、补新字段 ----
  const inboundByTarget = new Map()
  edges.forEach((edge) => {
    if (!inboundByTarget.has(edge.target)) inboundByTarget.set(edge.target, [])
    inboundByTarget.get(edge.target).push(edge)
  })

  nodes = nodes.map((node) => {
    const data = { ...node.data }
    const modes = NODE_MODES[node.type]
    if (modes) {
      if (!authoredModes.has(node.id) || !modes[data.mode]) {
        data.mode = inferMode(node, inboundByTarget.get(node.id) || [], migratedById)
      }
      data.refBindings = data.refBindings || {}
    }
    return { ...node, data }
  })

  // 引用语法先改写好，backfill 才认得出现有的引用（顺序不能换，见 rewriteLegacyTokens）
  nodes = nodes.map(rewriteLegacyTokens)

  // 补 token 必须在 mode 与 edges 都定稿之后，才能算准槽位
  nodes = nodes.map((node) => {
    if (node.type === 'group') return node
    if (parseTokens(node.data.prompt).length) return node
    return backfillRefTokens(node, edges, nodes)
  })

  return {
    ...document,
    nodes,
    edges,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    // Image binaries are stored in IndexedDB under the original node ID.
    // Keep the one-load migration map so canvas restoration can copy those
    // assets to the surviving, merged node before autosave drops legacy nodes.
    _imageNodeAliases: Object.fromEntries(aliases)
  }
}

/**
 * 清掉不该跨会话存活的节点状态 | Reset transient node state
 *
 * 每次读项目都跑一遍，和版本迁移无关，所以独立于 migrateCanvasDocument：
 * 后者对已是当前版本的项目会直接原样返回。
 *
 * - `loading`：生成期间关掉应用会把它存下来，下次打开就成了没有任何请求在跑的
 *   「永远生成中」；而且 `isGenerating` 会挡住再次发送。
 * - `autoExecute`：编排器建节点时的一次性触发开关，节点会立刻消费掉；万一没消费
 *   就被落盘，下次打开会凭空跑一次生成（要花钱）。
 */
/**
 * 丢掉已经不存在的节点类型 | Drop nodes of types we no longer ship
 *
 * 和 resetTransientNodeState 一样**每次读项目都跑**，与版本无关：删掉一个节点类型之后
 * （比如堆叠），老画布里还留着它的节点数据，恢复出来会是一个没有组件可渲染的空框，
 * 而且连线还挂在上面。连到被丢弃节点的边由调用方一并滤掉。
 */
export const dropUnsupportedNodes = (nodes = []) =>
  nodes.filter(node => CANVAS_NODE_TYPES.includes(node.type))

export const resetTransientNodeState = (nodes = []) => nodes.map((node) => {
  const hasLoading = node?.data?.loading === true
  const hasAutoExecute = Boolean(node?.data?.autoExecute)
  if (!hasLoading && !hasAutoExecute) return node
  return { ...node, data: { ...node.data, loading: false, autoExecute: false } }
})
