/**
 * 智能体输入行离线验证 | Offline verification of the agent CLI input line
 *
 * `buildAgentInputLine` 是这次唯一改动 CLI 协议的地方：一行 JSONL，形状错了整条链路
 * 就哑了（CLI 读不懂 → 没有任何输出）。所以要有一条断言把它钉住，别只在真机上靠肉眼。
 *
 * 运行：node scripts/verify-agent-input.mjs
 */

import { register } from 'node:module'
import assert from 'node:assert/strict'

// 必须早于源码的解析：ESM 的静态 import 会被提升，所以下面用动态 import。
register('./alias-loader.mjs', import.meta.url)

const { buildAgentInputLine } = await import('../src/utils/agentImage.js')

const parse = (line) => JSON.parse(line)

/* 有图：图片块在前、文字块在后，让模型先看图再读要求 */
const withImages = parse(buildAgentInputLine({
  text: '帮我写一篇小红书笔记',
  images: [
    { dataBase64: 'AAAA', mime: 'image/webp' },
    { dataBase64: 'BBBB', mime: 'image/jpeg' }
  ]
}))

assert.equal(withImages.type, 'user')
assert.equal(withImages.message.role, 'user')
assert.ok(Array.isArray(withImages.message.content), 'content 应是块数组')

const blocks = withImages.message.content
assert.equal(blocks.length, 3, '两张图 + 一段文字 = 3 个块')
assert.equal(blocks[0].type, 'image')
assert.equal(blocks[0].source.type, 'base64')
assert.equal(blocks[0].source.media_type, 'image/webp')
assert.equal(blocks[0].source.data, 'AAAA')
assert.equal(blocks[1].type, 'image', '第二张图仍应在文字之前')
assert.equal(blocks[1].source.media_type, 'image/jpeg')
assert.equal(blocks[1].source.data, 'BBBB')
assert.equal(blocks[2].type, 'text')
assert.equal(blocks[2].text, '帮我写一篇小红书笔记')

/* 无附件：只有一段文字块 —— 有图无图同一条路径，不该另开分支 */
const textOnly = parse(buildAgentInputLine({ text: '这张画布在做什么' }))
assert.equal(textOnly.message.content.length, 1)
assert.equal(textOnly.message.content[0].type, 'text')
assert.equal(textOnly.message.content[0].text, '这张画布在做什么')

/* 缺 mime 时兜底成 image/png，别把 undefined 写进 JSON */
const noMime = parse(buildAgentInputLine({ text: '', images: [{ dataBase64: 'CCCC' }] }))
assert.equal(noMime.message.content[0].source.media_type, 'image/png')

/* 转义：引号 / 换行 / 反斜杠必须能被 JSON.parse 原样还回来，不能被"手工拼串"弄坏 */
const tricky = '他说"你好"\n第二行\t带制表符 \\ 和反斜杠'
const escaped = parse(buildAgentInputLine({ text: tricky }))
assert.equal(escaped.message.content[0].text, tricky)

/* 未给 images 时按空数组处理，不炸 */
const noArgs = parse(buildAgentInputLine({}))
assert.equal(noArgs.message.content.length, 1)
assert.equal(noArgs.message.content[0].text, '')

/* 产出必须是单行 —— CLI 按行读，多一个换行就多一条残破消息 */
const line = buildAgentInputLine({ text: 'a\nb', images: [{ dataBase64: 'X', mime: 'image/webp' }] })
assert.equal(line.includes('\n'), false, '输入行里不能有裸换行（\\n 之外）')

console.log('PASS: agent input line — user type, image blocks before text, base64 source, mime fallback, escaping, single line')
