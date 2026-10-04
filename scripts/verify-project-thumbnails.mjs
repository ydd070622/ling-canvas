import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const media = new Map()
const writes = []
globalThis.__thumbnailTest = {
  saveImage: async (key, value) => { media.set(key, value); writes.push(key) },
  loadImageAsDataUrl: async key => media.get(key) || null,
  deleteImage: async key => media.delete(key),
  makeThumbDataUrl: async url => url.startsWith('data:image/') ? { dataUrl: 'data:image/webp;base64,cover' } : null
}
let source = await readFile(new URL('../src/stores/projectThumbnails.js', import.meta.url), 'utf8')
source = source.replace(/import \{ saveImage, loadImageAsDataUrl, deleteImage \} from '.\/imageStore'/,
  'const {saveImage, loadImageAsDataUrl, deleteImage} = globalThis.__thumbnailTest')
source = source.replace(/import \{ makeThumbDataUrl, DEFAULT_THUMB_MAX_EDGE, DEFAULT_THUMB_QUALITY \} from '..\/utils\/imageThumb'/,
  'const {makeThumbDataUrl} = globalThis.__thumbnailTest; const DEFAULT_THUMB_MAX_EDGE=512, DEFAULT_THUMB_QUALITY=.72')
const {syncProjectThumbnail, hydrateProjectThumbnails, flushProjectThumbnails} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const project = {id:'local', canvasData:{nodes:[{id:'photo',type:'image',data:{}}]}}
const liveNodes = [{id:'photo',type:'image',data:{url:'data:image/png;base64,photo'}}]
syncProjectThumbnail(project, liveNodes)
await flushProjectThumbnails()
assert.ok(project.thumbnail.startsWith('data:image/webp'))
assert.ok(media.has('local:__thumb__'))
const restarted = {...project,thumbnail:''}
await hydrateProjectThumbnails([restarted])
assert.equal(restarted.thumbnail,project.thumbnail)
media.set('old:photo','data:image/png;base64,original')
const old = {id:'old',thumbnail:'',canvasData:project.canvasData}
await hydrateProjectThumbnails([old])
assert.ok(old.thumbnail.startsWith('data:image/webp'))
assert.ok(writes.includes('old:__thumb__'))
syncProjectThumbnail(project, [])
await flushProjectThumbnails()
assert.equal(project.thumbnail,'')
assert.equal(media.has('local:__thumb__'),false)
delete globalThis.__thumbnailTest
console.log('PASS: local image cover, restart hydration, old missing-cover recovery, empty canvas cleanup')
