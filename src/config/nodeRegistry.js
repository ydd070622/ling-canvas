/**
 * Node registry | 节点注册表
 *
 * 端口模型：**左侧单一输入口 + 逻辑分槽**。
 * 一个节点只有一个输入 handle（INPUT_HANDLE），所有上游边都挂在这一个口上；
 * 边的先后顺序（`edge.data.order`）决定它在本节点里的引用编号 `{{Image 1}}`。
 * 「首帧 / 尾帧 / 参考图」不是物理端口，而是由节点的 `data.mode` 决定的槽位语义。
 *
 * 引用模型：**全显式引用**。上游内容不会自动拼进提示词，
 * 必须在正文里写 `{{Text 1}}` / `{{Image 2}}` 才会生效。解析见 utils/promptRefs.js。
 */
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_VIDEO_MODEL,
  VIDEO_MODELS
} from './models'

export const CONTENT_NODE_TYPES = Object.freeze(['text', 'image', 'video'])
// 节点类型里能承载二进制媒体（存进 IndexedDB、渲染成 <img>/<video :src>）的那些。
// text 节点也在 CONTENT_NODE_TYPES 里，但它没有 url 字段，不要混用。
export const MEDIA_NODE_TYPES = Object.freeze(['image', 'video'])
export const CANVAS_NODE_TYPES = Object.freeze([...CONTENT_NODE_TYPES, 'group'])

/** 唯一的输入 / 输出 handle id */
export const INPUT_HANDLE = 'in'
export const OUTPUT_HANDLE = 'out'

/**
 * 点一下端口派发的自定义事件名 | Port click event
 * NodePort 派发、Canvas 监听：左口点出「往上游建节点」，右口点出「往下游建节点」。
 */
export const PORT_CLICK_EVENT = 'ling-canvas:port-click'

/** 引用种类：正文里的 `{{Image 1}}` 对应 kind=image、index=1 */
export const KIND_TITLE = Object.freeze({ text: 'Text', image: 'Image', video: 'Video' })
export const KIND_CODE = Object.freeze({ text: 'T', image: 'I', video: 'V' })

const videoModel = VIDEO_MODELS.find(model => model.key === DEFAULT_VIDEO_MODEL) || VIDEO_MODELS[0]

/**
 * 生成模式矩阵 | Generation modes
 *
 * `accepts` 决定该模式能收哪几类上游、各收几条（超出容量的边会成为「闲置」，不占编号）。
 * `roles` 决定每类上游按序落在什么语义槽上（首帧 / 尾帧 / 参考…），只影响展示与提示。
 */
export const NODE_MODES = Object.freeze({
  text: {
    gen:    { label: '文生文',   accepts: { text: 3 } },
    vision: { label: '图文理解', accepts: { text: 3, image: 4, video: 1 } }
  },
  image: {
    t2i:  { label: '文生图',   accepts: { text: 3 }, roles: { text: ['提示词', '补充', '补充'] } },
    i2i:  { label: '图生图',   accepts: { image: 2, text: 2 }, roles: { image: ['底图', '参考'], text: ['描述', '补充'] } },
    ref:  { label: '参考重绘', accepts: { image: 4, text: 2 }, roles: { image: ['参考', '参考', '参考', '参考'], text: ['描述', '补充'] } },
    edit: { label: '局部编辑', accepts: { image: 1, text: 1 }, roles: { image: ['底图'], text: ['编辑要求'] } },
    grid: { label: '九宫格分镜', accepts: { text: 2 }, roles: { text: ['分镜要求', '补充'] } }
  },
  video: {
    t2v:   { label: '文生视频', accepts: { text: 3 }, roles: { text: ['描述', '补充', '补充'] } },
    i2v:   { label: '图生视频', accepts: { image: 1, text: 2 }, roles: { image: ['首帧'], text: ['运动描述', '补充'] } },
    flf:   { label: '首尾帧',   accepts: { image: 2, text: 2 }, roles: { image: ['首帧', '尾帧'], text: ['运动描述', '补充'] } },
    ref:   { label: '图片参考', accepts: { image: 4, text: 2 }, roles: { image: ['参考', '参考', '参考', '参考'], text: ['描述', '补充'] } },
    vref:  { label: '视频参考', accepts: { video: 2, image: 2, text: 2 }, roles: { video: ['参考视频', '参考视频'], image: ['参考', '参考'], text: ['描述', '补充'] } },
    vedit: { label: '视频编辑', accepts: { video: 1, text: 1 }, roles: { video: ['待编辑'], text: ['编辑要求'] } }
  }
})

/** 每种节点类型的默认模式与承载模式的字段名 */
export const NODE_MODE_FIELD = Object.freeze({ text: 'mode', image: 'mode', video: 'mode' })

/** 新节点的通用字段：引用绑定 + 失效标记，见 utils/promptRefs.js */
const baseRefData = () => ({ refBindings: {}, stale: { is: false, reason: null, since: null } })

export const NODE_DEFINITIONS = Object.freeze({
  text: {
    label: '文本',
    defaultMode: 'gen',
    createData: () => ({
      label: '文本',
      content: '',
      prompt: '',
      model: '',
      mode: 'gen',
      expanded: true,
      ...baseRefData()
    })
  },
  image: {
    label: '图片',
    defaultMode: 't2i',
    createData: () => ({
      label: '图片',
      url: '',
      prompt: '',
      model: '',
      mode: 't2i',
      size: null,
      ratio: null,
      resolution: '1K',
      count: 1,
      strength: 0.75,
      expanded: true,
      ...baseRefData()
    })
  },
  video: {
    label: '视频',
    defaultMode: 't2v',
    createData: () => ({
      label: '视频',
      url: '',
      prompt: '',
      model: '',
      mode: 't2v',
      ratio: '3:4',
      duration: videoModel?.defaultParams?.duration || 5,
      resolution: videoModel?.defaultResolution || videoModel?.resolutions?.[0] || '1080p',
      expanded: true,
      ...baseRefData()
    })
  },
  group: {
    label: '节点组',
    defaultMode: null,
    createData: () => ({ label: '节点组', memberIds: [] })
  }
})

export const isContentNodeType = type => CONTENT_NODE_TYPES.includes(type)
export const isMediaNodeType = type => MEDIA_NODE_TYPES.includes(type)

export const createDefaultNodeData = (type) => {
  const definition = NODE_DEFINITIONS[type]
  return definition ? definition.createData() : {}
}

/** 该节点当前的模式定义（含 label / accepts / roles） */
export const getModeDef = (node) => {
  const modes = NODE_MODES[node?.type]
  if (!modes) return null
  const field = NODE_MODE_FIELD[node.type] || 'mode'
  return modes[node?.data?.[field]] || modes[NODE_DEFINITIONS[node.type].defaultMode] || null
}

/** 该节点当前的模式 key */
export const getModeKey = (node) => {
  const modes = NODE_MODES[node?.type]
  if (!modes) return null
  const field = NODE_MODE_FIELD[node.type] || 'mode'
  return modes[node?.data?.[field]] ? node.data[field] : NODE_DEFINITIONS[node.type].defaultMode
}

/** 某类型是否存在能接收 kind 的模式；返回可用的模式 key（拖线到空白新建时用） */
export const findModeAccepting = (type, kind) => {
  const modes = NODE_MODES[type]
  if (!modes) return null
  return Object.keys(modes).find(key => (modes[key].accepts?.[kind] || 0) > 0) || null
}

export const getAcceptLimit = (node, kind) => getModeDef(node)?.accepts?.[kind] || 0

/** 该上游在目标节点的某个序号上承担的角色（首帧 / 参考…） */
export const getSlotRole = (node, kind, index) =>
  getModeDef(node)?.roles?.[kind]?.[index] || '上下文'

const createsCycle = (sourceId, targetId, edges) => {
  const outgoing = new Map()
  edges.forEach((edge) => {
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

/**
 * 连线校验 | Validate a prospective connection
 *
 * 只看类型 / 容量 / 环 —— **就绪性留给生成时校验**。
 * 连线这个动作不该被「上游还没生成好」或「节点是收起状态」绑架。
 */
export const validateCanvasConnection = (connection, nodes, edges) => {
  if (!connection?.source || !connection?.target) return { valid: false, reason: '连接信息不完整' }
  if (connection.source === connection.target) return { valid: false, reason: '节点不能连接自身' }

  const sourceNode = nodes.find(node => node.id === connection.source)
  const targetNode = nodes.find(node => node.id === connection.target)
  if (!sourceNode || !targetNode) return { valid: false, reason: '节点不存在' }
  if (sourceNode.type === 'group' || targetNode.type === 'group') {
    return { valid: false, reason: '节点组不能参与连线' }
  }
  if (!isContentNodeType(sourceNode.type) || !isContentNodeType(targetNode.type)) {
    return { valid: false, reason: '该节点类型不支持连线' }
  }

  // Vue Flow 在重建受控 v-model:edges 时也会调 isValidConnection，
  // 那时候选边已在 edges 里，不能把它当成自己的重复项。
  const isDifferentEdge = edge => !connection.id || edge.id !== connection.id
  const duplicate = edges.some(edge =>
    isDifferentEdge(edge) && edge.source === connection.source && edge.target === connection.target
  )
  if (duplicate) return { valid: false, reason: '连接已经存在' }

  const limit = getAcceptLimit(targetNode, sourceNode.type)
  if (limit === 0) {
    const modeDef = getModeDef(targetNode)
    const what = sourceNode.type === 'image' ? '图片' : sourceNode.type === 'video' ? '视频' : '文本'
    return {
      valid: false,
      reason: `「${modeDef?.label || '当前'}」模式不接受${what}上游，请切换目标节点的生成模式`
    }
  }

  const used = edges.filter(edge =>
    isDifferentEdge(edge) && edge.target === targetNode.id && nodes.find(n => n.id === edge.source)?.type === sourceNode.type
  ).length
  if (used >= limit) {
    return { valid: false, reason: `最多接收 ${limit} 个同类上游，已达上限` }
  }

  if (createsCycle(sourceNode.id, targetNode.id, edges)) {
    return { valid: false, reason: '连接会形成循环依赖' }
  }

  return { valid: true }
}
