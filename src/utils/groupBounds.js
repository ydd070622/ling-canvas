// Rebase member coordinates while preserving their absolute canvas positions.
export const fitNodeGroups = (nodes, padding = 28, frozenGroups = new Set()) => {
  const patches = new Map()
  for (const group of nodes.filter(node => node.type === 'group')) {
    if (frozenGroups.has(group.id)) continue
    const members = nodes.filter(node => node.parentNode === group.id)
    if (!members.length) continue
    const size = node => ({
      width: Number(node.dimensions?.width || node.measured?.width || node.width) || 320,
      height: Number(node.dimensions?.height || node.measured?.height || node.height) || 240
    })
    const left = Math.min(...members.map(node => node.position.x)) - padding
    const top = Math.min(...members.map(node => node.position.y)) - padding
    const width = Math.max(...members.map(node => node.position.x + size(node).width)) + padding - left
    const height = Math.max(...members.map(node => node.position.y + size(node).height)) + padding - top
    const moved = Math.abs(left) > .001 || Math.abs(top) > .001
    if (moved || Math.abs(parseFloat(group.style?.width) - width) > .001 || Math.abs(parseFloat(group.style?.height) - height) > .001 || !group.style?.width || !group.style?.height) {
      patches.set(group.id, { ...group, position: { x: group.position.x + left, y: group.position.y + top },
        style: { ...group.style, width: `${width}px`, height: `${height}px` } })
    }
    for (const node of members) {
      if (!moved && node.extent !== 'parent') continue
      const { extent, ...rest } = node
      patches.set(node.id, { ...rest, extent: undefined, position: { x: node.position.x - left, y: node.position.y - top } })
    }
  }
  return patches.size ? nodes.map(node => patches.get(node.id) || node) : nodes
}


// Snapshot bounds stay fixed for the gesture; release outside detaches only
// the moved members, preserving their world coordinates and all edges.
export const releaseGroupMembers = (nodes, draggedIds, bounds) => {
  const detached = new Set()
  const next = nodes.map(node => {
    const group = bounds.get(node.parentNode)
    if (!group || !draggedIds.has(node.id)) return node
    const width = Number(node.dimensions?.width || node.width) || 320
    const height = Number(node.dimensions?.height || node.height) || 240
    const x = group.x + node.position.x
    const y = group.y + node.position.y
    const cx = x + width / 2, cy = y + height / 2
    if (cx >= group.x && cx <= group.x + group.width && cy >= group.y && cy <= group.y + group.height) return node
    detached.add(node.id)
    const { groupId, ...data } = node.data || {}
    return { ...node, parentNode: undefined, extent: undefined, position: { x, y }, data }
  })
  if (!detached.size) return nodes
  return next.map(node => node.type === 'group'
    ? { ...node, data: { ...node.data, memberIds: (node.data?.memberIds || []).filter(id => !detached.has(id)) } }
    : node)
}

// Drop into a stationary group when at least 25% of the node area overlaps.
// Prefer the smallest eligible group if frames overlap.
export const joinDroppedGroupMembers = (nodes, draggedIds, previousParents = new Map()) => {
  const groups = nodes.filter(node => node.type === 'group' && !draggedIds.has(node.id) && !node.parentNode)
    .map(node => ({ node, width: parseFloat(node.style?.width) || node.dimensions?.width || 0,
      height: parseFloat(node.style?.height) || node.dimensions?.height || 0 }))
    .sort((a, b) => a.width * a.height - b.width * b.height)
  const joined = new Map()
  const next = nodes.map(node => {
    if (!draggedIds.has(node.id) || node.parentNode || node.type === 'group') return node
    const nodeWidth = Number(node.dimensions?.width || node.width) || 320
    const nodeHeight = Number(node.dimensions?.height || node.height) || 240
    const target = groups.find(({ node: group, width, height }) => {
      // A member deliberately dragged out must not immediately rejoin its
      // former group through the more generous entry threshold.
      if (previousParents.get(node.id) === group.id) return false
      const overlapWidth = Math.max(0, Math.min(node.position.x + nodeWidth, group.position.x + width) - Math.max(node.position.x, group.position.x))
      const overlapHeight = Math.max(0, Math.min(node.position.y + nodeHeight, group.position.y + height) - Math.max(node.position.y, group.position.y))
      return overlapWidth * overlapHeight >= nodeWidth * nodeHeight * 0.25
    })
    if (!target) return node
    joined.set(node.id, target.node.id)
    return { ...node, parentNode: target.node.id, extent: undefined,
      position: { x: node.position.x - target.node.position.x, y: node.position.y - target.node.position.y },
      data: { ...node.data, groupId: target.node.id } }
  })
  if (!joined.size) return nodes
  return next.map(node => node.type === 'group'
    ? { ...node, data: { ...node.data, memberIds: [...new Set([...(node.data?.memberIds || []),
      ...[...joined].filter(([, groupId]) => groupId === node.id).map(([id]) => id)])] } }
    : node)
}
