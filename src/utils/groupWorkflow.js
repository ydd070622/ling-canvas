export const workflowOrder = (members, edges) => {
  const ids = new Set(members.map(node => node.id))
  const pending = new Set(ids), ordered = []
  while (pending.size) {
    const ready = members.filter(node => pending.has(node.id) && !edges.some(edge => edge.target === node.id && ids.has(edge.source) && pending.has(edge.source)))
    if (!ready.length) throw new Error('组内存在循环连线，无法顺序执行')
    for (const node of ready) { pending.delete(node.id); ordered.push(node) }
  }
  return ordered
}

export const instantiateGroupWorkflow = (saved, position) => {
  const map = new Map([...saved.nodes.map(node => node.id), ...saved.edges.map(edge => edge.id)].map(id => [id, crypto.randomUUID()]))
  const rewrite = value => {
    if (typeof value === 'string') return map.get(value) || value
    if (Array.isArray(value)) return value.map(rewrite)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [map.get(key) || key, rewrite(item)]))
    return value
  }
  const nodes = rewrite(saved.nodes)
  nodes.forEach(node => { node.selected = false; if (!node.parentNode) node.position = { x: node.position.x + position.x, y: node.position.y + position.y } })
  return { nodes, edges: rewrite(saved.edges) }
}
