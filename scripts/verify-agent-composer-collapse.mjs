import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reactive, ref, watch, nextTick } from 'vue'
const source = readFileSync('src/components/canvas/CanvasComposer.vue','utf8')
const start = source.indexOf('watch(() => props.agentOpen,')
const end = source.indexOf('watch(composerCollapsed,', start)
const props = reactive({agentOpen:false})
const refs = Array.from({length:5},()=>ref(true))
let closed = 0
new Function('watch','props','composerExpanded','composerCollapsed','paramOpen','modelOpen','presetOpen','closeMention',source.slice(start,end))(
  watch,props,...refs,()=>closed++)
refs[1].value = false
props.agentOpen = true
await nextTick()
assert.deepEqual(refs.map(item=>item.value),[false,true,false,false,false])
assert.equal(closed,1)
refs[1].value = false // Manual expansion while the agent remains open.
await nextTick()
assert.equal(refs[1].value,false)
props.agentOpen = false
await nextTick()
props.agentOpen = true
await nextTick()
assert.equal(refs[1].value,true)
console.log('PASS: auto collapse, manual expansion, reopen collapse and popup cleanup')
