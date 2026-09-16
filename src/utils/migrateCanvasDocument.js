import {
  createDefaultNodeData,
  INPUT_HANDLE,
  OUTPUT_HANDLE,
  NODE_DEFINITIONS,
  NODE_MODES
} from '../config/nodeRegistry'
import { makeToken, defaultStale, computeSlots, parseTokens } from './promptRefs'

/** 当前画布文档版本。v3 = 单一输入 handle + 逻辑分槽 + 全显式引用。 */
export const CANVAS_SCHEMA_VERSION = 3

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

/** 按入边类型推断节点该用哪个生成模式（迁移时补 mode 用） */
const inferMode = (node, inbound, byId) => {
  const sources = inbound.map(edge => byId.get(edge.source)).filter(Boolean)
  if (node.type === 'image') {
    return sources.some(s => s.type === 'image') ? 'i2i' : 't2i'
  }
  if (node.type === 'video') {
    const images = sources.filter(s => s.type === 'image')
    if (images.length >= 2) return 'flf'
    if (images.length === 1) return 'i2v'
    if (sources.some(s => s.type === 'video')) return 'vref'
    return 't2v'
  }
  if (node.type === 'text') {
    return sources.some(s => s.type === 'image' || s.type === 'video') ? 'vision' : 'gen'
  }
  return NODE_DEFINITIONS[node.type]?.defaultMode || null
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
  return edges.map(edge => ({ ...edge, data: { order: orderById.get(edge.id) || 1 } }))
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
  const missing = slots.filter(s => !existing.has(`${s.kind === 'image' ? 'Image' : s.kind === 'video' ? 'Video' : 'Text'} ${s.index}`))
  if (!missing.length) return node

  const refBindings = { ...(node.data.refBindings || {}) }
  const tokens = missing.map((slot) => {
    const token = makeToken(slot.kind, slot.index)
    refBindings[`${slot.kind === 'image' ? 'Image' : slot.kind === 'video' ? 'Video' : 'Text'} ${slot.index}`] = slot.edge.id
    return token
  })
  const prompt = `${String(node.data.prompt || '').trim()} ${tokens.join(' ')}`.trim()
  return { ...node, data: { ...node.data, prompt, refBindings } }
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
      data: { order: Number(edge.data?.order ?? edge.data?.promptOrder ?? edge.data?.imageOrder) || 1 }
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
      data.stale = data.stale || defaultStale()
    }
    return { ...node, data }
  })

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
