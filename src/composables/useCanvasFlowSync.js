import { watch } from 'vue'
import { toFlowNode } from '../utils/nodePayload.js'

// Business state owns membership and data. Vue Flow returns only interaction
// patches, never an entire cached array which can overwrite newer results.
export const applyFlowNodeChanges = (nodes, changes) => {
  let changed = false
  const next = nodes.map(node => {
    let patch = null
    for (const change of changes) {
      if (change.id !== node.id) continue
      const assign = (key, value) => {
        if (value !== undefined && JSON.stringify(patch?.[key] ?? node[key]) !== JSON.stringify(value)) {
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
  const stopNodes = watch(nodes, value => flow.setNodes(value.map(toFlowNode)), { immediate: true, flush: 'sync' })
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
