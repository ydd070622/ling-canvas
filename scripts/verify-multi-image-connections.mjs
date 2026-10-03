import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const { createDefaultNodeData, validateCanvasConnection } = await server.ssrLoadModule('/src/config/nodeRegistry.js')
const { computeSlots } = await server.ssrLoadModule('/src/utils/promptRefs.js')

for (const count of [5, 12]) {
  const target = { id: 'target', type: 'image', data: createDefaultNodeData('image') }
  const sources = Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, type: 'image', data: { url: `image-${i}` } }))
  const nodes = [...sources, target], edges = []
  sources.forEach((source, i) => {
    const edge = { id: `edge-${i}`, source: source.id, target: target.id, data: { order: i + 1 } }
    assert.equal(validateCanvasConnection(edge, nodes, edges).valid, true)
    edges.push(edge)
  })
  const { slots, idle } = computeSlots(target, nodes, edges)
  assert.equal(slots.length, count)
  assert.equal(idle.length, 0)
  assert.deepEqual(slots.map(slot => slot.index), sources.map((_, i) => i + 1))
  assert.equal(validateCanvasConnection({ source: sources[0].id, target: target.id }, nodes, edges).valid, false)
}
console.log('PASS: all 5 and 12 images connect, remain usable references, and retain ordering; duplicates rejected.')
await server.close()
