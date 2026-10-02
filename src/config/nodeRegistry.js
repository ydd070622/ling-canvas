/**
 * Node registry | 节点注册表
 *
 * 端口模型：**左侧一个输入口、右侧一个输出口**（INPUT_HANDLE / OUTPUT_HANDLE）。
 * 所有上游边都挂在左侧那一个口上；边的先后顺序（`edge.data.order`）决定它在本节点里的
 * 引用编号 `@图片1`。「首帧 / 尾帧 / 参考图」不是物理端口，而是模式（mode）决定的槽位语义。
 *
 * 引用模型：**全显式引用**。上游内容不会自动拼进提示词，
 * 必须在正文里写 `@文本1` / `@图片2` 才会生效。解析见 utils/promptRefs.js。
 *
 * 模式：新节点一律 `auto`，由实际连上来的上游推断（inferModeKey）；卡片上没有模式选单。
 */
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_VIDEO_MODEL,
  VIDEO_MODELS
} from './models'
import { RENDER_DEFAULTS } from '../utils/renderPrompt'

export const CONTENT_NODE_TYPES = Object.freeze(['text', 'image', 'video', 'audio', 'task', 'render', 'compare'])
// 节点类型里能承载二进制媒体（存进 IndexedDB、渲染成 <img>/<video>/<audio> :src）的那些。
// text 节点也在 CONTENT_NODE_TYPES 里，但它没有 url 字段，不要混用。
export const MEDIA_NODE_TYPES = Object.freeze(['image', 'video', 'audio'])
export const CANVAS_NODE_TYPES = Object.freeze([...CONTENT_NODE_TYPES, 'group'])

/**
 * 能被"引用"的节点类型 | Referenceable node types
 *
 * 只有承载内容的节点才有引用编号。task 是生成指令、group 是分组框，
 * 三者都能连线，但都不该出现在上游引用列表里（没有可被引用的内容）。
 */
export const REFERENCEABLE_TYPES = Object.freeze(['text', 'image', 'video', 'audio'])
export const isReferenceableType = type => REFERENCEABLE_TYPES.includes(type)

/** 唯一的输入 / 输出 handle id */
export const INPUT_HANDLE = 'in'
export const OUTPUT_HANDLE = 'out'

/**
 * 点端口 = 出新建菜单，由 Canvas 的 `onConnectEnd` 按落点位移判定，
 * 不再往 Handle 的 DOM 上挂监听器（那个节点会被 Vue Flow 重渲染换掉）。
 * 左口往上游建，右口往下游建。
 */

/** 引用种类：正文里的 `@图片1` 对应 kind=image、index=1。中文名即 token 字面量。 */
export const KIND_TITLE = Object.freeze({ text: '文本', image: '图片', video: '视频', audio: '音频' })
export const KIND_CODE = Object.freeze({ text: 'T', image: 'I', video: 'V', audio: 'A' })

/**
 * 自动模式 | Auto mode
 *
 * 新节点一律 `mode: 'auto'`：卡片上不再有模式选单，模式改由**实际连上来的上游**推断
 * （接 1 张图就是图生图，接 2 张就是首尾帧）。旧存档里显式写死的 mode 原样保留，
 * 走各自的老路径，行为不变。
 */
export const AUTO_MODE = 'auto'

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
    vision: { label: '图文理解', accepts: { text: 3, image: 4, video: 1, audio: 2 } }
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
  },
  // 承载型：只存上传的素材，不生成。容量给足，什么上游都收 —— 与"随便连"的卡片一致。
  audio: {
    hold: { label: '音频素材', accepts: { text: 4, image: 4, video: 2, audio: 4 } }
  },
  // 生成入口：上游就是素材池，具体语义（底图 / 首帧 / 参考）由 targetType + 上游构成推导。
  task: {
    gen: {
      label: 'AI 任务',
      accepts: { text: 4, image: 6, video: 2, audio: 2 },
      roles: { text: ['描述', '补充', '补充', '补充'], image: ['参考', '参考', '参考', '参考', '参考', '参考'], video: ['参考视频', '参考视频'], audio: ['参考音频', '参考音频'] }
    }
  },
  /**
   * 超级节点 | Super node
   *
   * 一张卡片 = 一整组子任务：上游每张图就是**一个视角**，逐视角出图（N 进 N 出），
   * 共用同一套结构 / 人物 / 灯光 / 环境参数。这是它与 task 的本质区别 ——
   * task 的 count 是「一个提示词出 N 张」，这里是「N 个视角各出 1 张」。
   *
   * viewMode（单 / 多视角）是行为字段而非模式：它不改槽位语义，只改跑几个视角，
   * 所以不在这里，而是落在 data 上。
   *
   * 容量给到 8 是留余量（原型用 4）。因为 mode 保持 auto，getAcceptLimit 走
   * 「跨模式取最大」分支，第 9 张图会落进 idle 槽，而不是在连线时被硬拒。
   */
  render: {
    gen: {
      label: '室内渲染',
      accepts: { image: 8, text: 2 },
      roles: {
        image: ['视角', '视角', '视角', '视角', '视角', '视角', '视角', '视角'],
        text: ['补充', '补充']
      }
    }
  },
  /**
   * 查看型节点 | Viewer node
   *
   * 只收两张图 —— 第一张当「前」、第二张当「后」，就这一种用法，所以整张表只有一项，
   * 也不带 roles（前 / 后不走槽位角色：交换前后是卡片上的一个按钮，不是连线语义）。
   *
   * 它必须在这张表里有条目，`getAcceptLimit` 才会返回非零 —— 表里没有的类型
   * 一张上游都连不进来（见 getAcceptLimit 的头一段）。
   */
  compare: {
    hold: { label: '图片对比', accepts: { image: 2 } }
  },
})

/** 每种节点类型的默认模式与承载模式的字段名 */
export const NODE_MODE_FIELD = Object.freeze({
  text: 'mode', image: 'mode', video: 'mode', audio: 'mode', task: 'mode', render: 'mode', compare: 'mode'
})

/**
 * 按上游构成推断该用哪个模式 | Infer the generation mode from actual upstreams
 *
 * 这是"模式从界面消失但不从系统消失"的落点：卡片上不再有模式选单，
 * 但连线和生成请求仍然需要一份模式定义，于是从实际连上来的上游反推。
 */
export const inferModeKey = (type, sourceKinds = []) => {
  const count = kind => sourceKinds.filter(k => k === kind).length
  const images = count('image')
  const videos = count('video')

  if (type === 'image') {
    if (images === 0) return 't2i'
    if (images === 1) return 'i2i'
    return 'ref'
  }
  if (type === 'video') {
    if (videos > 0) return 'vref'
    if (images >= 3) return 'ref'
    if (images === 2) return 'flf'
    if (images === 1) return 'i2v'
    return 't2v'
  }
  if (type === 'text') return (images || videos || count('audio')) ? 'vision' : 'gen'
  if (type === 'audio') return 'hold'
  return NODE_DEFINITIONS[type]?.defaultMode || null
}

/** task 节点生成什么，就按那个类型推断它的槽位语义 */
export const taskTargetType = node => node?.data?.targetType || 'image'

/**
 * 节点实际生效的模式 key | Effective mode key
 *
 * 显式写过、且是合法 key 的（旧存档）原样返回；`auto` / 缺失 / 非法值一律按上游推断。
 * task 节点按它的 targetType 借用对应类型的模式表。
 */
export const resolveModeKey = (node, sourceKinds = []) => {
  const modes = NODE_MODES[node?.type]
  if (!modes) return null
  const declared = node?.data?.[NODE_MODE_FIELD[node.type] || 'mode']
  if (declared && declared !== AUTO_MODE && modes[declared]) return declared
  const target = node?.type === 'task' ? taskTargetType(node) : node.type
  return inferModeKey(target, sourceKinds)
}

/** 节点实际生效的模式定义（含 label / accepts / roles） */
export const resolveModeDef = (node, sourceKinds = []) =>
  NODE_MODES[node?.type]?.[resolveModeKey(node, sourceKinds)] || null

/**
 * 各类节点共用的基础字段 | Common node fields
 * - `refBindings`：正文里的引用 token → 来源边 id，见 utils/promptRefs.js
 * - `preset`：选中的提示词预设 `{ id, title, text } | null`，**本体存下来**（自定义预设
 *   存在 localStorage 里，生成时不该再去读它）；文本由 buildPrompt 拼在最前面
 */
const baseRefData = () => ({ refBindings: {}, preset: null })

export const NODE_DEFINITIONS = Object.freeze({
  text: {
    label: '文本',
    // 新节点写 auto，由上游推断；defaultMode 只作为推断不出结果时的兜底
    defaultMode: 'gen',
    createData: () => ({
      label: '文本',
      content: '',
      prompt: '',
      model: '',
      mode: AUTO_MODE,
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
      mode: AUTO_MODE,
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
      mode: AUTO_MODE,
      ratio: '3:4',
      duration: videoModel?.defaultParams?.duration || 5,
      resolution: videoModel?.defaultResolution || videoModel?.resolutions?.[0] || '1080p',
      expanded: true,
      ...baseRefData()
    })
  },
  audio: {
    label: '音频',
    defaultMode: 'hold',
    createData: () => ({
      label: '音频',
      url: '',
      prompt: '',
      model: '',
      mode: 'hold',
      duration: 0,
      expanded: true,
      ...baseRefData()
    })
  },
  // 生成入口。targetType 决定它产出什么，模式与槽位语义都按 targetType 借用。
  task: {
    label: 'AI 任务',
    defaultMode: 'gen',
    createData: () => ({
      label: 'AI 任务',
      prompt: '',
      model: '',
      mode: 'gen',
      targetType: 'image',
      size: null,
      ratio: null,
      resolution: '1K',
      count: 1,
      duration: videoModel?.defaultParams?.duration || 5,
      ...baseRefData()
    })
  },
  /**
   * 超级节点：一张卡片 = 上游每个视角各出 1 张图。
   *
   * 参数默认值来自 utils/renderPrompt 的 RENDER_DEFAULTS —— 那里是唯一真相，
   * 组件的 readParams() 也读它，所以这里不重复写一遍字段。
   */
  render: {
    label: '室内渲染',
    defaultMode: 'gen',
    createData: () => ({
      label: '室内渲染',
      prompt: '',
      model: '',
      mode: AUTO_MODE,
      ...RENDER_DEFAULTS,
      viewOutputIds: [],
      viewErrors: [],
      expanded: true,
      ...baseRefData()
    })
  },
  /**
   * 查看型节点：两张图进、一个滑块出。
   *
   * 不生成、不产出，所以右侧没有输出口（NodeFrame 的 has-output）。它的「结果」
   * 就是卡片里那个对比视图本身 —— 没有可以往下游接的东西。
   *
   * `swap`：手动交换前后的标记。默认顺序由入边先后决定（先连上来的当「前」），
   * 用户按了「交换前后」就记在这里 —— 它是用户的判断，得跟着存档活下来。
   */
  compare: {
    label: '图片对比',
    defaultMode: 'hold',
    createData: () => ({
      label: '图片对比',
      mode: AUTO_MODE,
      swap: false,
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

/**
 * 该节点当前的模式定义（含 label / accepts / roles）
 *
 * 不传 sourceKinds 时按「无上游」推断，所以调用方在能拿到入边时应当把上游类型传进来，
 * 否则 auto 节点会被当成文生图/文生视频。`computeSlots` 是唯一需要精确的地方。
 */
export const getModeDef = (node, sourceKinds = []) => {
  const modes = NODE_MODES[node?.type]
  if (!modes) return null
  const key = resolveModeKey(node, sourceKinds)
  return modes[key] || modes[NODE_DEFINITIONS[node.type]?.defaultMode] || null
}

/** 该节点当前的模式 key */
export const getModeKey = (node, sourceKinds = []) => {
  const modes = NODE_MODES[node?.type]
  if (!modes) return null
  return resolveModeKey(node, sourceKinds) || NODE_DEFINITIONS[node.type]?.defaultMode || null
}

/** 某类型是否存在能接收 kind 的模式；返回可用的模式 key（拖线到空白新建时用） */
export const findModeAccepting = (type, kind) => {
  const modes = NODE_MODES[type]
  if (!modes) return null
  return Object.keys(modes).find(key => (modes[key].accepts?.[kind] || 0) > 0) || null
}

/**
 * 该类上游的容量上限 | Acceptance limit
 *
 * auto 节点取**所有模式里的最大容量**：模式已经不由用户选，就不能再拿某个具体模式的
 * 容量去挡连线 —— 那等于让一个用户看不见的模式拒绝他的操作。超额的上游仍然连得上，
 * 只是不占编号（落进 `idle`），这是原有的槽位机制，行为不变。
 */
export const getAcceptLimit = (node, kind, sourceKinds = []) => {
  const modes = NODE_MODES[node?.type]
  if (!modes) return 0
  const declared = node?.data?.[NODE_MODE_FIELD[node.type] || 'mode']
  if (declared && declared !== AUTO_MODE && modes[declared]) {
    return modes[declared].accepts?.[kind] || 0
  }
  const target = node?.type === 'task' ? taskTargetType(node) : node.type
  const pool = NODE_MODES[target] || modes
  return Math.max(0, ...Object.values(pool).map(mode => mode.accepts?.[kind] || 0))
}

/** 该上游在目标节点的某个序号上承担的角色（首帧 / 参考…） */
export const getSlotRole = (node, kind, index, sourceKinds = []) =>
  getModeDef(node, sourceKinds)?.roles?.[kind]?.[index] || '上下文'

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

  if (targetNode.type === 'render' && connection.targetHandle === 'in-text' && sourceNode.type !== 'text') {
    return { valid: false, reason: '文本输入点只接收文本节点' }
  }
  if (targetNode.type === 'render' && connection.targetHandle === INPUT_HANDLE && sourceNode.type !== 'image' &&
      !edges.some(edge => edge.source === connection.source && edge.target === connection.target)) {
    return { valid: false, reason: '图片输入点只接收图片节点' }
  }
  // 旧存档的 in 口可能连有文本，继续兼容；新的连线由 Canvas 分配到独立文本口。

  // Vue Flow 在重建受控 v-model:edges 时也会调 isValidConnection，
  // 那时候选边已在 edges 里，不能把它当成自己的重复项。
  const isDifferentEdge = edge => !connection.id || edge.id !== connection.id
  const duplicate = edges.some(edge =>
    isDifferentEdge(edge) && edge.source === connection.source && edge.target === connection.target
  )
  if (duplicate) return { valid: false, reason: '连接已经存在' }

  // task 不是可引用上游：task→图片 这类边表示「结果写到那里」，不是引用。
  // 引用容量只对真正带内容的节点有意义，所以不参与容量校验。
  const referenceable = isReferenceableType(sourceNode.type)

  if (referenceable) {
    const limit = getAcceptLimit(targetNode, sourceNode.type)
    if (limit === 0) {
      const modeDef = getModeDef(targetNode)
      const what = KIND_TITLE[sourceNode.type] || '内容'
      return {
        valid: false,
        reason: `「${modeDef?.label || '当前'}」模式不接受${what}上游`
      }
    }

    const used = edges.filter(edge =>
      isDifferentEdge(edge) && edge.target === targetNode.id && nodes.find(n => n.id === edge.source)?.type === sourceNode.type
    ).length
    if (used >= limit) {
      return { valid: false, reason: `最多接收 ${limit} 个同类上游，已达上限` }
    }
  }

  if (createsCycle(sourceNode.id, targetNode.id, edges)) {
    return { valid: false, reason: '连接会形成循环依赖' }
  }

  return { valid: true }
}
