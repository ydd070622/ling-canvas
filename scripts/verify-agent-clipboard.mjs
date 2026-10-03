import assert from 'node:assert/strict'
import { normalizeClipboardText, copySelectionAsPlainText, copyAgentText } from '../src/utils/agentClipboard.js'
const source='📍 坐标：深圳\r\n建筑面积：80㎡\r\n\r\n🏠 客餐厅\r\n\r\n▪ 第一段\r\n\r\n▪ 第二段'
const expected=source.replaceAll('\r\n','\n')
assert.equal(normalizeClipboardText(source),expected)
const entries=new Map(); let prevented=false
copySelectionAsPlainText({preventDefault(){prevented=true},clipboardData:{setData:(type,value)=>entries.set(type,value)}},source)
assert.equal(prevented,true)
assert.deepEqual([...entries.keys()],['text/plain'])
assert.equal(entries.get('text/plain'),expected)
let copied
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>{copied=value}}}})
await copyAgentText(source)
assert.equal(copied,expected)
console.log('PASS: paragraph breaks, blank lines, emoji, bullets and plain-text copy preserved')
