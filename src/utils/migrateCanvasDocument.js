import { createDefaultNodeData, getConnectionSemantics } from '../config/nodeRegistry'

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

const targetHandleFor = (sourceType, targetType, edge) => {
  if (targetType !== 'video') return 'left'
  if (sourceType === 'text') return 'prompt'
  if (sourceType === 'image') {
    if (edge.targetHandle === 'last-frame' || edge.data?.imageRole === 'last_frame_image') return 'last-frame'
    return 'first-frame'
  }
  return edge.targetHandle || 'left'
}

/** Convert saved/template graphs from the removed config-node model to content nodes. */
export const migrateCanvasDocument = (document = {}) => {
  const originalNodes = Array.isArray(document.nodes) ? document.nodes : []
  const originalEdges = Array.isArray(document.edges) ? document.edges : []
  const isCurrentSchema = document.schemaVersion === 2
    && originalNodes.every(node => ['text', 'image', 'video', 'group'].includes(node.type))
    && originalEdges.every(edge => edge.type === 'flowEdge')
  if (isCurrentSchema) return document

  const byId = new Map(originalNodes.map(node => [node.id, node]))
  const aliases = new Map()
  const mergedOutputData = new Map()

  originalEdges.forEach(edge => {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    const mappedSourceType = LEGACY_TYPE_MAP[source?.type]
    if (!mappedSourceType || target?.type !== mappedSourceType) return
    aliases.set(target.id, source.id)
    mergedOutputData.set(source.id, target.data || {})
  })

  const resolveAlias = nodeId => {
    let current = nodeId
    const visited = new Set()
    while (aliases.has(current) && !visited.has(current)) {
      visited.add(current)
      current = aliases.get(current)
    }
    return current
  }

  const nodes = originalNodes
    .filter(node => !aliases.has(node.id))
    .map(node => {
      const type = LEGACY_TYPE_MAP[node.type] || node.type
      const result = {
        ...node,
        type,
        data: normalizedData(node, mergedOutputData.get(node.id))
      }
      if (result.data?.memberIds) result.data.memberIds = result.data.memberIds.map(resolveAlias)
      return result
    })

  const migratedById = new Map(nodes.map(node => [node.id, node]))
  const seen = new Set()
  const edges = originalEdges.flatMap(edge => {
    const source = resolveAlias(edge.source)
    const target = resolveAlias(edge.target)
    if (source === target) return []
    const sourceNode = migratedById.get(source)
    const targetNode = migratedById.get(target)
    if (!sourceNode || !targetNode || sourceNode.type === 'group' || targetNode.type === 'group') return []

    const targetHandle = targetHandleFor(sourceNode.type, targetNode.type, edge)
    const key = `${source}:${edge.sourceHandle || 'right'}>${target}:${targetHandle}`
    if (seen.has(key)) return []
    seen.add(key)
    const semantics = getConnectionSemantics(sourceNode.type, targetNode.type, targetHandle)
    if (!semantics) return []

    return [{
      id: id('edge'),
      source,
      target,
      sourceHandle: 'right',
      targetHandle,
      type: 'flowEdge',
      data: {
        label: semantics.label,
        color: semantics.color,
        order: Number(edge.data?.order || edge.data?.promptOrder || edge.data?.imageOrder) || 1
      }
    }]
  })

  return {
    ...document,
    nodes,
    edges,
    schemaVersion: 2,
    // Image binaries are stored in IndexedDB under the original node ID.
    // Keep the one-load migration map so canvas restoration can copy those
    // assets to the surviving, merged node before autosave drops legacy nodes.
    _imageNodeAliases: Object.fromEntries(aliases)
  }
}
