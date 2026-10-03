// Rebase member coordinates while preserving their absolute canvas positions.
export const fitNodeGroups = (nodes, padding = 28, frozenGroups = new Set()) => {
  const patches = new Map()
  for (const group of nodes.filter(node => node.type === 'group')) {
    const members = nodes.filter(node => node.parentNode === group.id)
    if (!members.length) continue
    const size = node => ({
      width: Number(node.dimensions?.width || node.measured?.width || node.width) || 320,
      height: Number(node.dimensions?.height || node.measured?.height || node.height) || 240
    })
    if (group.data?.manualResizing) continue
    const manual = group.data?.manualBounds
    const left = Math.min(Math.min(...members.map(node => node.position.x)) - padding, manual?.x ?? Infinity)
    const top = Math.min(Math.min(...members.map(node => node.position.y)) - padding, manual?.y ?? Infinity)
    const width = Math.max(Math.max(...members.map(node => node.position.x + size(node).width)) + padding, manual ? manual.x + manual.width : -Infinity) - left
    const height = Math.max(Math.max(...members.map(node => node.position.y + size(node).height)) + padding, manual ? manual.y + manual.height : -Infinity) - top
    // Resize the visible frame during a gesture without rebasing the parent.
    // Vue Flow's drag origin must remain stable until pointer release.
    if (frozenGroups.has(group.id)) {
      const bounds = { x: left, y: top, width, height }
      const previous = group.data?.dragBounds
      if (!previous || Object.keys(bounds).some(key => previous[key] !== bounds[key])) {
        patches.set(group.id, { ...group, data: { ...group.data, dragBounds: bounds } })
      }
      continue
    }
    const moved = Math.abs(left) > .001 || Math.abs(top) > .001
    if (group.data?.dragBounds || moved || Math.abs(parseFloat(group.style?.width) - width) > .001 || Math.abs(parseFloat(group.style?.height) - height) > .001 || !group.style?.width || !group.style?.height) {
      patches.set(group.id, { ...group, position: { x: group.position.x + left, y: group.position.y + top },
        data: { ...group.data, dragBounds: undefined, ...(manual ? { manualBounds: { ...manual, x: manual.x - left, y: manual.y - top } } : {}) },
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
export const releaseGroupMembers = (nodes, draggedIds, bounds, allowDetach = true) => {
  if (!allowDetach) return nodes
  const detached = new Set()
  const next = nodes.map(node => {
    const group = bounds.get(node.parentNode)
    if (!group || !draggedIds.has(node.id)) return node
    const width = Number(node.dimensions?.width || node.width) || 320
    const height = Number(node.dimensions?.height || node.height) || 240
    const x = group.x + node.position.x
    const y = group.y + node.position.y
    // Require the entire image to clear the original frame by 48 canvas units.
    // Crossing an edge with its center is just a layout adjustment.
    const gap = 48
    const outside = x + width < group.x - gap || x > group.x + group.width + gap
      || y + height < group.y - gap || y > group.y + group.height + gap
    if (!outside) return node
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
