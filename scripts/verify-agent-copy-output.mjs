import assert from 'node:assert/strict'
import { cleanCopyOutput, copyRequestPrompt } from '../src/utils/agentCopyOutput.js'
const body = '🏠 客餐厅连成一条线。\n\n■ 圆桌与岛台，动线更顺。\n\n#室内设计 #意式极简'
const raw = `这是意式极简线，正文按案例图文走，只写画面里看得见的空间。\n\n**标题**：客餐厅一体化\n---\n📍 坐标：【待确认城市】\n建筑面积：【待确认】㎡\n\n${body}\n---\n**【封面】** 主钩子\n**【评论区引导】** 首评\n**待确认三件**：\n1. 请确认城市`
assert.equal(cleanCopyOutput(raw),body)
assert.equal(cleanCopyOutput(body),body)
const projectDetails = '📍 坐标：深圳\n建筑面积：89㎡\n改造风格：意式极简\n项目情况：二手房改造'
assert.equal(cleanCopyOutput(`${projectDetails}\n\n${body}`),`${projectDetails}\n\n${body}`)
assert.equal(cleanCopyOutput(`${body}\n\n**待确认三件**：\n文件不能落盘`),body)
assert.match(copyRequestPrompt('用这个标题写文案'),/本轮交付要求/)
assert.equal(copyRequestPrompt('为什么读取失败？'),'为什么读取失败？')
console.log('PASS: screenshot-style preface, title, unknown metadata and extra deliverables removed; body and tags preserved.')
