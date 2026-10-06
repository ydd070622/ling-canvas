import assert from 'node:assert/strict'
import { imageGallerySlots } from '../src/utils/imageGallery.js'
assert.equal(imageGallerySlots({ loading:true, count:4 }).length, 4)
assert.ok(imageGallerySlots({ loading:true, count:4, galleryUrls:['old'] }).every(item => item.pending))
const partial = imageGallerySlots({ loading:true, generationCount:2, count:4, generationUrls:['done'] })
assert.equal(partial.length,2)
assert.equal(partial[0].url,'done')
assert.ok(partial[1].pending)
assert.deepEqual(imageGallerySlots({galleryUrls:['a','b'],mainImageIndex:1}).map(item=>item.url),['b','a'])
assert.equal(imageGallerySlots({url:'single'}).length,1)
console.log('PASS: requested slots, partial results, regeneration and main-image order')
