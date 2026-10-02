import assert from 'node:assert/strict'
import { promoteConnectedRenderNodes as promote } from '../src/utils/renderConnections.js'
const nodes = [
  ...['a', 'b', 'c'].map(id => ({ id, type: 'image', data: {} })),
  { id: 'text', type: 'text', data: {} },
  { id: 'render', type: 'render', data: { viewMode: 'single', prompt: 'keep', resolution: '2K' } }
]
const edge = source => ({ source, target: 'render' })
assert.equal(promote(nodes, [edge('a')], [edge('a')])[4].data.viewMode, 'single')
assert.equal(promote(nodes, [edge('a'), edge('text')], [edge('text')])[4].data.viewMode, 'single')
const connected = promote(nodes, [edge('a'), edge('b')], [edge('b')])
assert.deepEqual(connected[4].data, { viewMode: 'multi', prompt: 'keep', resolution: '2K' })
assert.equal(promote(nodes, ['a', 'b', 'c'].map(edge), ['a', 'b', 'c'].map(edge))[4].data.viewMode, 'multi')
assert.equal(promote(nodes, [edge('a'), edge('b')], [edge('text')])[4].data.viewMode, 'single')
assert.equal(promote(nodes, [edge('a'), edge('a')], [edge('a')])[4].data.viewMode, 'single')
console.log('PASS: one image, text input, second image, batch images, manual single mode, duplicate sources')
