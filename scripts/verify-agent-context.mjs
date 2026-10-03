/**
 * 画布智能体上下文离线验证 | Offline verification of the agent's canvas context
 *
 * 目的：不启动 Tauri、不连 Claude，单独确认「画布 → 系统提示词」这段翻译是对的：
 *   - 概况数字、项目名
 *   - 选中节点给全（正文 / 参数 / 上游引用编号），未选中只报名
 *   - 渲染参数说成人话，且封闭空间下不吐外景
 *   - 素材的 url 绝不进提示词（对理解语义是纯噪声）
 *   - 连线关系表
 *
 * 运行：node scripts/verify-agent-context.mjs
 */

import { register } from 'node:module'
import assert from 'node:assert/strict'

// 必须早于源码的解析：ESM 的静态 import 会被提升，所以下面用动态 import。
// 源码里有大量无扩展名的相对导入（`from './models'`），要 loader 补扩展名。
register('./alias-loader.mjs', import.meta.url)

const { buildAgentSystemPrompt } = await import('../src/utils/agentContext.js')
const { createDefaultNodeData } = await import('../src/config/nodeRegistry.js')

const text = {
  id: 'n1',
  type: 'text',
  data: { ...createDefaultNodeData('text'), label: '风格要求', content: '奶油风，暖色调，木地板' }
}
const image = {
  id: 'n2',
  type: 'image',
  data: { ...createDefaultNodeData('image'), label: 'SU截图', url: 'blob:should-not-appear' }
}
const render = {
  id: 'n3',
  type: 'render',
  data: {
    ...createDefaultNodeData('render'),
    label: '客厅效果',
    city: '上海',
    time: '傍晚',
    closed: true,
    outside: '海景'
  }
}

const nodes = [text, image, render]
const edges = [
  { id: 'e1', source: 'n2', target: 'n3', data: { order: 0 } },
  { id: 'e2', source: 'n1', target: 'n3', data: { order: 1 } }
]

const prompt = buildAgentSystemPrompt({
  nodes,
  edges,
  selectedIds: ['n2', 'n3'],
  projectName: '测试项目'
})

// 概况
assert.match(prompt, /3 个节点、2 条连线/, '概况应报出节点/连线总数')
assert.match(prompt, /项目：测试项目/, '应带出项目名')
assert.match(prompt, /选中 2 个节点/)

// 选中的渲染节点：参数说人话
assert.match(prompt, /室内渲染「客厅效果」/, '应带出类型名与自定义名')
assert.match(prompt, /地点=上海/)
assert.match(prompt, /时间=傍晚/)
assert.match(prompt, /封闭空间=是/)
assert.match(prompt, /视角模式=多视角/)

// 封闭空间下「外景」整组失效，不该出现在提示词里
assert.doesNotMatch(prompt, /外景=海景/, '封闭空间不应吐出外景')

// 上游引用：图片与文本各自的槽位编号和角色
assert.match(prompt, /@图片1/)
assert.match(prompt, /角色：视角/)
assert.match(prompt, /@文本1/)
assert.match(prompt, /角色：补充/)
assert.match(prompt, /图片「SU截图」/)

// 选中的素材节点：报"已生成"状态，但不带 url
assert.match(prompt, /状态：已生成/)
assert.doesNotMatch(prompt, /blob:should-not-appear/, '素材 url 是噪声，不该进提示词')

// 未选中的节点只报名，不铺开正文 —— 这是"选中给全、未选给摘要"的核心取舍
assert.match(prompt, /【其他节点】共 1 个/)
assert.match(prompt, /文本「风格要求」/)
assert.doesNotMatch(prompt, /奶油风，暖色调，木地板/, '未选中节点的正文不该铺进上下文')

// 反证：把同一个文本节点选中，它的正文就该出现了
const textSelected = buildAgentSystemPrompt({ nodes, edges, selectedIds: ['n1'] })
assert.match(textSelected, /奶油风，暖色调，木地板/)
assert.match(textSelected, /状态：有正文/)

// 连线关系表
assert.match(prompt, /【连线关系】/)
assert.match(prompt, /图片「SU截图」.*→.*室内渲染「客厅效果」/s)

// 空画布不该炸
const empty = buildAgentSystemPrompt({ nodes: [], edges: [], selectedIds: [] })
assert.match(empty, /0 个节点、0 条连线/)
assert.match(empty, /没有选中任何节点/)
assert.doesNotMatch(empty, /【连线关系】/)

console.log('PASS: canvas overview, selected-node detail, render params, reference slots, url redaction, edge list')
