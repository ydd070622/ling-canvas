// Only newly added image connections trigger the mode change. A user's
// later choice of single angle is retained until another image is connected.
export const promoteConnectedRenderNodes = (nodes, edges, addedEdges) => {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const targets = new Set(addedEdges.filter(edge => byId.get(edge.source)?.type === 'image').map(edge => edge.target))
  return nodes.map(node => {
    if (node.type !== 'render' || !targets.has(node.id) || node.data?.viewMode === 'multi') return node
    const imageSources = new Set(edges.filter(edge => edge.target === node.id && byId.get(edge.source)?.type === 'image').map(edge => edge.source))
    return imageSources.size > 1 ? { ...node, data: { ...node.data, viewMode: 'multi' } } : node
  })
}
