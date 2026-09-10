import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  VIDEO_MODELS
} from './models'

export const CONTENT_NODE_TYPES = Object.freeze(['text', 'image', 'video'])
export const CANVAS_NODE_TYPES = Object.freeze([...CONTENT_NODE_TYPES, 'group'])

const imageModel = IMAGE_MODELS.find(model => model.key === DEFAULT_IMAGE_MODEL) || IMAGE_MODELS[0]
const videoModel = VIDEO_MODELS.find(model => model.key === DEFAULT_VIDEO_MODEL) || VIDEO_MODELS[0]

export const NODE_DEFINITIONS = Object.freeze({
  text: {
    label: '文本',
    accepts: { left: ['text', 'image'] },
    createData: () => ({
      label: '文本',
      content: '',
      prompt: '',
      model: '',
      expanded: true
    })
  },
  image: {
    label: '图片',
    accepts: { left: ['text', 'image'] },
    createData: () => ({
      label: '图片',
      url: '',
      prompt: '',
      model: '',
      size: imageModel?.defaultParams?.size || imageModel?.sizes?.[0] || '1x1',
      count: 1,
      expanded: true
    })
  },
  video: {
    label: '视频',
    accepts: {
      prompt: ['text'],
      'first-frame': ['image'],
      'last-frame': ['image']
    },
    singleInputHandles: ['first-frame', 'last-frame'],
    createData: () => ({
      label: '视频',
      url: '',
      prompt: '',
      model: '',
      ratio: videoModel?.defaultParams?.ratio || '16:9',
      duration: videoModel?.defaultParams?.duration || 5,
      resolution: videoModel?.defaultResolution || videoModel?.resolutions?.[0] || '1080p',
      expanded: true
    })
  },
  group: {
    label: '节点组',
    accepts: {},
    createData: () => ({ label: '节点组', memberIds: [] })
  }
})

const EDGE_SEMANTICS = Object.freeze({
  'text>text:left': { label: '上下文', color: '#e8912e' },
  'text>image:left': { label: '提示词', color: '#e8912e' },
  'text>video:prompt': { label: '描述', color: '#e8912e' },
  'image>text:left': { label: '视觉参考', color: '#4c8bf5' },
  'image>image:left': { label: '参考图', color: '#4c8bf5' },
  'image>video:first-frame': { label: '首帧', color: '#4c8bf5' },
  'image>video:last-frame': { label: '尾帧', color: '#4c8bf5' },
})

export const isContentNodeType = type => CONTENT_NODE_TYPES.includes(type)

export const createDefaultNodeData = (type) => {
  const definition = NODE_DEFINITIONS[type]
  return definition ? definition.createData() : {}
}

export const getConnectionSemantics = (sourceType, targetType, targetHandle = 'left') => (
  EDGE_SEMANTICS[`${sourceType}>${targetType}:${targetHandle || 'left'}`] || null
)

const createsCycle = (sourceId, targetId, edges) => {
  const outgoing = new Map()
  edges.forEach(edge => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, [])
    outgoing.get(edge.source).push(edge.target)
  })

  const pending = [targetId]
  const visited = new Set()
  while (pending.length) {
    const current = pending.pop()
    if (current === sourceId) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(outgoing.get(current) || []))
  }
  return false
}

export const validateCanvasConnection = (connection, nodes, edges) => {
  if (!connection?.source || !connection?.target) return { valid: false, reason: '连接信息不完整' }
  if (connection.source === connection.target) return { valid: false, reason: '节点不能连接自身' }

  const sourceNode = nodes.find(node => node.id === connection.source)
  const targetNode = nodes.find(node => node.id === connection.target)
  if (!sourceNode || !targetNode) return { valid: false, reason: '节点不存在' }
  if (!isContentNodeType(sourceNode.type) || !isContentNodeType(targetNode.type)) {
    return { valid: false, reason: '该节点类型不支持连线' }
  }

  const targetHandle = connection.targetHandle || 'left'
  const accepted = NODE_DEFINITIONS[targetNode.type]?.accepts?.[targetHandle] || []
  if (!accepted.includes(sourceNode.type)) return { valid: false, reason: '节点类型或输入槽不兼容' }

  // Vue Flow also invokes `isValidConnection` while it rebuilds controlled
  // `v-model:edges`. In that pass the candidate already exists in `edges`, so
  // it must not be treated as a duplicate of itself. Interactive connections
  // do not have an id yet and still get the normal duplicate check.
  const isDifferentEdge = edge => !connection.id || edge.id !== connection.id
  const duplicate = edges.some(edge =>
    isDifferentEdge(edge) &&
    edge.source === connection.source &&
    edge.target === connection.target &&
    (edge.sourceHandle || 'right') === (connection.sourceHandle || 'right') &&
    (edge.targetHandle || 'left') === targetHandle
  )
  if (duplicate) return { valid: false, reason: '连接已经存在' }

  const singleInputHandles = NODE_DEFINITIONS[targetNode.type]?.singleInputHandles || []
  if (singleInputHandles.includes(targetHandle) && edges.some(edge =>
    isDifferentEdge(edge) &&
    edge.target === targetNode.id &&
    edge.targetHandle === targetHandle
  )) {
    return { valid: false, reason: '该输入槽只能连接一个节点' }
  }

  if (createsCycle(sourceNode.id, targetNode.id, edges)) return { valid: false, reason: '连接会形成循环依赖' }

  return {
    valid: true,
    semantics: getConnectionSemantics(sourceNode.type, targetNode.type, targetHandle)
  }
}
