import fs from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const records = new Map(); let reads = 0
const database = { transaction() { const tx = { objectStore: () => ({ get(key) { const r = {}; queueMicrotask(() => { r.result = records.get(key); r.onsuccess() }); return r }, put(row) { records.set(row.key, row); queueMicrotask(() => tx.oncomplete()) } }) }; return tx } }
const source = (await fs.readFile('src/utils/localThumbCache.js','utf8')).replace(/^import .*\r?\n/gm,'').replace('export function','function') + '\n globalThis.thumbnail = localThumbnail'
const context = vm.createContext({ Map, Promise, JSON, indexedDB: { open() { const r = {}; queueMicrotask(() => { r.result = database; r.onsuccess() }); return r } }, localCall: async () => { reads++; return 'data:image/png;base64,AA==' }, canvasPreview: async () => ({blob: 'small-preview'}), fetch })
vm.runInContext(source, context)
const props = {folderId:'one',relative:'a.jpg',modifiedAt:1,byteLength:100}
await Promise.all([context.thumbnail(props),context.thumbnail(props)]); assert.equal(reads,1)
await context.thumbnail(props); assert.equal(reads,1)
await context.thumbnail({...props,modifiedAt:2}); assert.equal(reads,2)
await context.thumbnail({...props,modifiedAt:2,cacheVersion:1}); assert.equal(reads,3)
await context.thumbnail({...props,modifiedAt:2}); assert.equal(reads,3)
await context.thumbnail({...props,folderId:'two'}); assert.equal(reads,4)
console.log('PASS: reuse, deduplication, modification invalidation, refresh, folder isolation')
