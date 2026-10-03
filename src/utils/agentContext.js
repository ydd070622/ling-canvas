/**
 * 画布上下文 | Canvas context for the agent
 *
 * 把当前画布"翻译"成一段中文说明塞进系统提示词，让画布里的智能体知道用户正在看什么。
 *
 * **纯函数**：显式接收 nodes / edges / selectedIds，不读 store、不碰 DOM —— 便于单独验证，
 * 也不会在构建上下文时意外改动画布。
 *
 * 取舍：**选中的节点给全，其余只报名字。** 用户问的几乎总是他选中的那几个；把整张画布的
 * 每段正文、每个参数都铺开既费 token 又稀释重点。未选中的节点仍列出来，好让智能体知道
 * 画布上还有什么 —— 用户问"我这张画布在做什么"时不至于两眼一抹黑。
 *
 * 素材（图片/视频/音频）只报"有没有出结果"，不报 url：url 是一长串 blob/ObjectURL，
 * 对理解语义毫无帮助，纯属噪声。
 */
import { KIND_TITLE, NODE_DEFINITIONS } from '../config/nodeRegistry'
import { computeSlots } from './promptRefs'
import { readParams } from './renderPrompt'

/** 单个文本片段的上限，超了截断 —— 一段几千字的正文没必要整段塞进提示词 */
const MAX_TEXT = 400
/** 未选中节点最多列这么多条，其余只报总数 */
const MAX_UNSELECTED = 40
/** 连线表最多列这么多条 */
const MAX_EDGES = 80

const clip = (text, limit = MAX_TEXT) => {
  const value = String(text ?? '').trim()
  return value.length > limit ? `${value.slice(0, limit)}…（已截断）` : value
}

/** 节点的类型名（图片 / 文本 / 室内渲染…） */
const typeLabel = (node) => NODE_DEFINITIONS[node?.type]?.label || node?.type || '节点'

/** 用户给节点起的名字。与类型名相同（即没改过）时视作无名。 */
const displayName = (node) => {
  const label = String(node?.data?.label || '').trim()
  return label && label !== typeLabel(node) ? label : ''
}

/** `室内渲染「客厅效果」` 或 `文本` */
const titleOf = (node) => {
  const name = displayName(node)
  return name ? `${typeLabel(node)}「${name}」` : typeLabel(node)
}

/** 「自定义」时用补充字段的值，照 renderPrompt 的 chosen() */
const chosen = (value, custom) => (
  value === '自定义' ? (String(custom || '').trim() || '【待填写】') : value
)

/**
 * 渲染节点的参数说成人话。
 *
 * 不复用 buildRenderPrompt：那里生成的是发给模型的整段中文指令（十好几行），
 * 塞进上下文太占地方。这里只要把"用户设了什么"列清楚就够。
 */
const renderParamsSummary = (data) => {
  const p = readParams(data)
  const parts = [
    `视角模式=${p.viewMode === 'single' ? '单视角' : '多视角'}`,
    `保持空间结构=${p.structure ? '是' : '否'}`,
    `封闭空间=${p.closed ? '是' : '否'}`
  ]
  parts.push(p.lights
    ? `室内灯光=开（${chosen(p.temperature, p.temperatureCustom)} / ${p.lightType}）`
    : '室内灯光=关')
  parts.push(`地点=${chosen(p.city, p.cityCustom)}`)
  parts.push(`时间=${chosen(p.time, p.timeCustom)}`)
  parts.push(`天气=${p.weather}`)
  if (!p.closed) parts.push(`外景=${chosen(p.outside, p.outsideCustom)}`)
  parts.push(`太阳光影=${p.sun}`)
  if (p.person) {
    const where = p.personLocation === '自定义位置'
      ? (String(p.personLocationCustom || '').trim() || '待填写')
      : p.personLocation
    parts.push(`人物=${where}·${p.personAction}${p.personBlur ? '·动态模糊' : ''}${p.personImage ? '' : '（缺参考图）'}`)
  }
  parts.push(`输出=${p.resolution}·${p.ratio === 'auto' ? '自动比例' : p.ratio}·${p.count}张`)
  const extra = String(p.extra || '').trim()
  if (extra) parts.push(`补充提示词=${clip(extra, 120)}`)
  return parts.join('，')
}

/** 素材节点的产出状态 —— 不谈 url */
const assetState = (node) => {
  if (node?.type === 'text') return '有正文'
  return node?.data?.url ? '已生成' : '未生成'
}

/** 收集进入某节点的上游，按槽位列出引用关系 */
const inputLines = (node, nodes, edges) => {
  const { slots, idle } = computeSlots(node, nodes, edges)
  return [
    ...slots.map(slot => {
      const src = nodes.find(n => n.id === slot.edge.source)
      return `  输入 ${slot.token}（${KIND_TITLE[slot.kind] || slot.kind}·角色：${slot.role}）← ${titleOf(src)}（id: ${slot.edge.source}）`
    }),
    ...idle.map(item => {
      const src = nodes.find(n => n.id === item.edge.source)
      return `  输入（当前模式用不到，闲置）← ${titleOf(src)}（id: ${item.edge.source}）`
    })
  ]
}

/** 某节点的正文/提示词 */
const bodyOf = (node) => {
  if (node?.type === 'text') {
    const content = clip(node.data?.content)
    return content ? `  正文：${content}` : '  正文：（空）'
  }
  const prompt = clip(node.data?.prompt)
  return prompt ? `  提示词：${prompt}` : '  提示词：（空）'
}

const describeNode = (node, nodes, edges) => {
  const lines = [`${titleOf(node)}（id: ${node.id}）`]

  if (node.type === 'text' || node.type === 'image' || node.type === 'video' || node.type === 'audio') {
    lines.push(`  状态：${assetState(node)}`)
    lines.push(bodyOf(node))
  } else if (node.type === 'task') {
    lines.push(`  产出类型：${node.data?.targetType || 'image'}`)
    lines.push(bodyOf(node))
  } else if (node.type === 'render') {
    lines.push(`  参数：${renderParamsSummary(node.data)}`)
  } else if (node.type === 'compare') {
    lines.push(`  顺序：${node.data?.swap ? '已交换前后' : '按连线先后'}`)
  } else if (node.type === 'group') {
    const members = (node.data?.memberIds || [])
      .map(id => nodes.find(n => String(n.id) === String(id)))
      .filter(Boolean)
      .map(titleOf)
    lines.push(`  组内节点：${members.length ? members.join('、') : '（空）'}`)
  }

  const inputs = inputLines(node, nodes, edges)
  if (inputs.length) lines.push(...inputs)
  return lines.join('\n')
}

/**
 * 构建完整系统提示词：角色说明 + 画布上下文。
 *
 * @param {{ nodes: Array, edges: Array, selectedIds: Array<string>, projectName?: string }} input
 * @returns {string}
 */
export const buildAgentSystemPrompt = ({ nodes = [], edges = [], selectedIds = [], projectName = '' } = {}) => {
  const ids = new Set(selectedIds.map(String))
  const selected = nodes.filter(node => ids.has(String(node.id)))
  const others = nodes.filter(node => !ids.has(String(node.id)))

  const sections = []

  sections.push([
    '你是嵌在一款无限画布绘图工具里的写作与创作助手。用户正在这张画布上做 AI 图像 / 视频生成。',
    '下面是这张画布此刻的真实状态，供你理解和回答用户的问题。',
    '当前接入已启用 Skill、Read、Glob、Grep。不要沿用旧会话中“没有 Read”的结论。需要技能资料时实际调用 Read；只有工具真实返回错误后才能报告读取失败，并说明错误。',
    '你没有修改画布或文件的能力，只能对话 —— 用户若要改动，需要他自己在画布上动手。',
    '用户会把画布上的图片直接发给你：那是真实的图像内容，你能看到，不用去读文件、也不要当成可有可无的附件。用户常要你据此写小红书笔记或文案，请认真看图再动笔。',
    '用户让你起标题或写文案时，先调用相关本地技能，家装内容优先考虑 xhs-ti。遵循技能对适用场景的限制：只改标题或写既定选题正文时，不擅自扩展成完整选题规划。技能引用的资料用 Read 读取。若工具或资料不可用，明确告知用户，不能声称已经完整遵循技能。',
    '回答用中文，简洁直接。用户问画布相关的问题时，以上下文为准，不要凭空编造不存在的节点或参数。',
    '用户要求写文案或小红书笔记时，默认只输出可直接发布的正文和相关标签。不要输出开场说明、分析过程、技能调用说明、分隔线，也不要追加封面方案、评论区引导、私信承接、评分、待办清单或“三件要你处理的事”。用户只要标题时只输出标题。缺少城市、面积、项目情况时不要编造，不要在成稿里插入【待确认】或补信息任务；案例文案开头固定保留四行项目资料，顺序为📍坐标、建筑面积、项目情况、改造风格；已知值填入，未知值留空供用户补充，不删字段。技能里的扩展交付仅在用户明确要求时提供。工具真正失败且影响完成任务时，简短说明，不能假装成功。'
  ].join('\n'))

  const overview = [
    `画布概况：${nodes.length} 个节点、${edges.length} 条连线` +
      (projectName ? `（项目：${projectName}）` : '') +
      `，当前选中 ${selected.length} 个节点。`
  ].join('')
  sections.push(overview)

  if (selected.length) {
    sections.push(['【选中的节点】（用户此刻正在关注这些）', ...selected.map(n => describeNode(n, nodes, edges))].join('\n'))
  } else {
    sections.push('【选中的节点】（无 —— 用户当前没有选中任何节点）')
  }

  if (others.length) {
    const listed = others.slice(0, MAX_UNSELECTED).map(node => `- ${titleOf(node)}（id: ${node.id}）`)
    const more = others.length > MAX_UNSELECTED ? `\n（另有 ${others.length - MAX_UNSELECTED} 个节点未列出）` : ''
    sections.push([`【其他节点】共 ${others.length} 个：`, ...listed].join('\n') + more)
  }

  if (edges.length) {
    const byId = new Map(nodes.map(node => [String(node.id), node]))
    const lines = edges.slice(0, MAX_EDGES).map((edge) => {
      const from = byId.get(String(edge.source))
      const to = byId.get(String(edge.target))
      return `- ${from ? titleOf(from) : edge.source}（id: ${edge.source}）→ ${to ? titleOf(to) : edge.target}（id: ${edge.target}）`
    })
    const more = edges.length > MAX_EDGES ? `\n（另有 ${edges.length - MAX_EDGES} 条连线未列出）` : ''
    sections.push(['【连线关系】', ...lines].join('\n') + more)
  }

  return sections.join('\n\n')
}
