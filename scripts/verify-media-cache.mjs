import assert from 'node:assert/strict'
import {createMediaCache} from '../src/utils/mediaCache.js'
const cache = createMediaCache(20)
let reads = 0, complete
const reader = () => { reads++; return new Promise(resolve => {complete = resolve}) }
const first = cache.load('image', reader)
const second = cache.load('image', reader)
await Promise.resolve()
assert.equal(reads,1)
complete('old')
assert.deepEqual(await Promise.all([first,second]),['old','old'])
assert.equal(await cache.load('image',reader),'old')
assert.equal(reads,1)
cache.remove('image')
const stale = cache.load('image',reader)
await Promise.resolve()
cache.put('image','new')
complete('stale')
await stale
assert.equal(cache.peek('image'),'new','In-flight reads must not overwrite a new upload')
cache.put('other','12345678')
assert.equal(cache.peek('image'),null,'Cache evicts old media under its byte limit')
cache.put('oversize','12345678901')
assert.equal(cache.peek('oversize'),null)
let misses = 0
await cache.load('missing',async () => {misses++; return null})
await cache.load('missing',async () => {misses++; return null})
assert.equal(misses,2,'Missing files remain retryable')
console.log('PASS: shared reads, warm reuse, upload invalidation, bounded eviction, retryable missing media')
