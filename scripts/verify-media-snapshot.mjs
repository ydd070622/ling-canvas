import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cloneMediaSnapshot, equalMediaSnapshots } from '../src/utils/mediaSnapshot.js'

const source = process.argv[2]
const urls = source
  ? fs.readdirSync(source).filter(name => /\.png$/i.test(name)).map(name =>
    `data:image/png;base64,${fs.readFileSync(path.join(source, name)).toString('base64')}`)
  : ['data:image/png;base64,' + 'A'.repeat(1000000)]
const nodes = urls.map((url, index) => ({ id: String(index), position: { x: index * 50, y: 0 }, data: { url, base64: url, galleryUrls: [url], prompt: '保留提示词' } }))
let start = performance.now()
const legacy = JSON.parse(JSON.stringify(nodes))
const legacyMs = performance.now() - start
start = performance.now()
const snapshot = cloneMediaSnapshot(nodes)
const optimizedMs = performance.now() - start
assert.deepEqual(snapshot, legacy)
assert.ok(equalMediaSnapshots(nodes, snapshot))
snapshot[0].position.x++
assert.ok(!equalMediaSnapshots(nodes, snapshot))
snapshot[0].position.x--
snapshot[0].data.url = 'data:image/png;base64,different'
assert.ok(!equalMediaSnapshots(nodes, snapshot))
assert.equal(nodes[0].data.url, urls[0])
console.log(JSON.stringify({ images: urls.length, originalBytes: urls.reduce((sum, url) => sum + url.length, 0), legacyMs, optimizedMs, speedup: legacyMs / optimizedMs }))
