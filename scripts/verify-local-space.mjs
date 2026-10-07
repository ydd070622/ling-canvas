import assert from 'node:assert/strict'
import { register } from 'node:module'
import { JSDOM } from 'jsdom'
register('./alias-loader.mjs', import.meta.url)
const dom = new JSDOM('', { url: 'http://localhost' })
globalThis.window = dom.window; globalThis.CustomEvent = dom.window.CustomEvent; globalThis.localStorage = dom.window.localStorage
const { projects } = await import('../src/stores/projects.js')
const { saveImagesToFolder, autoSaveNodeImages } = await import('../src/stores/localSpace.js')
const writes = []; let fail = false, retried = null
window.__TAURI_INTERNALS__ = { invoke: async (command, args) => { assert.equal(command, 'save_local_image'); if (fail) throw '目录离线'; writes.push(args); return `D:/output/${args.fileName}` } }
window.$message = { warning() {} }; window.addEventListener('ling-save-local', e => retried = e.detail)
const urls = ['data:image/jpeg;base64,YWJj', 'data:image/png;base64,ZGVm']
const result = await saveImagesToFolder(urls, { id:'folder-1', relative:'效果图' }, '客厅/方案')
assert.equal(result.paths.length, 2); assert.equal(writes[0].dataBase64, 'YWJj'); assert.ok(writes[0].fileName.endsWith('.jpg')); assert.equal(writes[0].relative, '效果图'); assert.ok(!writes[0].fileName.includes('/'))
projects.value = [{ id:'a', canvasData:{ localOutput:{ id:'folder-1', relative:'效果图', auto:true } } }, { id:'b', canvasData:{ localOutput:{ id:'folder-2', auto:false } } }]
await autoSaveNodeImages('b', urls, '客厅'); assert.equal(writes.length, 2)
await autoSaveNodeImages('a', urls, '客厅'); assert.equal(writes.length, 4); assert.equal(writes.at(-1).id, 'folder-1')
fail = true; await autoSaveNodeImages('a', urls, '客厅'); assert.deepEqual(retried.urls, urls)
console.log('PASS: original bytes, MIME extension, filename cleaning, per-canvas auto-save isolation, offline retry')
dom.window.close()
