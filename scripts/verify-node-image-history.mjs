import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./alias-loader.mjs', import.meta.url)
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = { addEventListener() {}, $message: {} }
const { appendImageGeneration } = await import('../src/utils/imageGenerationHistory.js')
const { cleanNodeForStorage } = await import('../src/stores/projects.js')
const { imageGallerySlots } = await import('../src/utils/imageGallery.js')
let data = {}
for (const [index, count] of [4, 2, 4].entries()) {
  const urls = Array.from({ length: count }, (_, i) => `data:image/png;base64,batch${index}image${i}`)
  data = { ...data, url: urls[0], galleryUrls: urls, imageHistory: appendImageGeneration(data, urls, 1000 + index), mainImageIndex: 0 }
  assert.equal(imageGallerySlots(data).length, count)
}
assert.deepEqual(data.imageHistory.map(batch => batch.urls.length), [4, 2, 4])
assert.equal(data.imageHistory.flatMap(batch => batch.urls).length, 10)
const oldBatch = data.imageHistory[1]
const selected = { ...data, url: oldBatch.urls[1], galleryUrls: oldBatch.urls, mainImageIndex: 1 }
assert.equal(imageGallerySlots(selected)[0].url, oldBatch.urls[1])
assert.equal(selected.imageHistory.length, 3)
const stored = cleanNodeForStorage({ id: 'image-1', type: 'image', position: { x: 0, y: 0 }, data: selected })
assert.deepEqual(stored.data.imageHistory.map(batch => batch.urls.length), [4, 2, 4])
assert.ok(stored.data.imageHistory.every(batch => batch.urls.every(url => url === null)))
assert.ok(!JSON.stringify(stored).includes('data:image'))
assert.equal(data.imageHistory[1].urls[1], oldBatch.urls[1])
assert.equal(appendImageGeneration({ url: 'legacy', galleryUrls: ['legacy', 'legacy2'] }, ['new'], 2000).length, 2)
console.log('PASS: three batches 4/2/4, current gallery, historical main selection, storage metadata and legacy retention')
