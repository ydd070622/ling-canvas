import fs from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { ref, watch } from 'vue'
const source = await fs.readFile('src/components/local/LocalFolderView.vue','utf8')
const handler = source.slice(source.indexOf('function imageKey(event)'), source.indexOf('async function viewText'))
const window = new EventTarget(), imageViewer=ref(false), imageUrl=ref('')
const moves=[]
vm.runInNewContext(handler, {window,imageViewer,imageUrl,imageEpoch:0,watch,stepImage:n=>moves.push(n)})
function key(value) {const e=new Event('keydown',{cancelable:true});Object.defineProperty(e,'key',{value});window.dispatchEvent(e);return e}
key('ArrowRight'); assert.deepEqual(moves,[])
imageViewer.value=true
assert.equal(key('ArrowRight').defaultPrevented,true)
key('ArrowLeft'); assert.deepEqual(moves,[1,-1])
imageViewer.value=false
key('ArrowRight'); assert.deepEqual(moves,[1,-1])
console.log('PASS: window keys switch images while open and detach on close')
