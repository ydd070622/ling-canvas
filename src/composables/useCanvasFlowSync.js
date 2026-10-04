import { watch } from 'vue'
import { toFlowNode } from '../utils/nodePayload.js'

const sameField = (key, a, b) => {
  if (Object.is(a, b)) return true
  if (key === 'position') return a?.x === b?.x && a?.y === b?.y
  if (key === 'dimensions') return a?.width === b?.width && a?.height === b?.height
  return false
}

// Business state owns membership and data. Vue Flow returns only interaction
// patches, never an entire cached array which can overwrite newer results.
export const applyFlowNodeChanges = (nodes, changes) => {
  let changed = false
  const byId = new Map()
  for (const change of changes) {
    if (!byId.has(change.id)) byId.set(change.id, [])
    byId.get(change.id).push(change)
  }
  const next = nodes.map(node => {
    let patch = null
    for (const change of byId.get(node.id) || []) {
      const assign = (key, value) => {
        if (value !== undefined && !sameField(key, patch?.[key] ?? node[key], value)) {
          patch = { ...patch, [key]: value }
        }
      }
      if (change.type === 'select') assign('selected', change.selected)
      if (change.type === 'position') {
        assign('position', change.position)
        assign('dragging', change.dragging)
      }
      if (change.type === 'dimensions') {
        assign('dimensions', change.dimensions)
        assign('resizing', change.resizing)
      }
    }
    if (!patch) return node
    changed = true
    return { ...node, ...patch }
  })
  return changed ? next : nodes
}

export const useCanvasFlowSync = (nodes, edges, flow) => {
  // No v-model echo and no pause/resume window: every business update reaches
  // the graph. Existing graph-node identities are retained by setNodes.
  const stopNodes = watch(nodes, (value, previous) => {
    // Membership/order changes still use the engine's normal reconciliation.
    if (!previous || value.length !== previous.length || value.some((node, i) => node.id !== previous[i].id)) {
      flow.setNodes(value.map(toFlowNode))
      return
    }
    // A pointer move changes only a few nodes. Do not reparse every image and
    // edge on every move, or echo geometry the engine has already applied.
    value.forEach((node, i) => {
      if (node === previous[i]) return
      const current = flow.findNode(node.id)
      const payload = toFlowNode(node)
      const patch = {}
      for (const key of new Set([...Object.keys(toFlowNode(previous[i])), ...Object.keys(payload)])) {
        if (!sameField(key, current?.[key], payload[key])) patch[key] = payload[key]
      }
      if (Object.keys(patch).length) flow.updateNode(node.id, patch)
    })
  }, { immediate: true, flush: 'sync' })
  const stopEdges = watch(edges, value => flow.setEdges(value), { immediate: true, flush: 'sync' })
  const onNodesChange = changes => {
    const next = applyFlowNodeChanges(nodes.value, changes)
    if (next !== nodes.value) nodes.value = next
  }
  const onEdgeSelectionChange = changes => {
    let changed = false
    const next = edges.value.map(edge => {
      const selection = changes.find(change => change.id === edge.id && change.type === 'select')
      if (!selection || edge.selected === selection.selected) return edge
      changed = true
      return { ...edge, selected: selection.selected }
    })
    if (changed) edges.value = next
  }
  return { onNodesChange, onEdgeSelectionChange, stop: () => { stopNodes(); stopEdges() } }
}
