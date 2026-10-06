export function parseCanvasActions(text) {
  const match = String(text || '').match(/```canvas-actions\s*([\s\S]*?)```/)
  if (!match) return { text, actions: [] }
  const value = JSON.parse(match[1])
  if (!Array.isArray(value) || value.length > 10) throw new Error('画布动作格式无效或数量过多')
  for (const action of value) {
    if (!['create_image','run_node'].includes(action?.type)) throw new Error('不支持的画布动作')
    if (action.type === 'create_image' && (typeof action.prompt !== 'string' || !action.prompt.trim())) throw new Error('生图提示词不能为空')
    if (action.type === 'run_node' && typeof action.nodeId !== 'string') throw new Error('缺少生成节点编号')
  }
  return { text: String(text).replace(match[0], '').trim(), actions: value }
}
