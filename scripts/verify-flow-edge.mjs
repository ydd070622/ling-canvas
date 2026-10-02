import { JSDOM } from 'jsdom'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost' })
for (const key of ['window','document','Element','HTMLElement','SVGElement','Node','navigator']) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true})
const { parse, compileScript } = await import('@vue/compiler-sfc')
const source = await readFile('src/components/edges/FlowEdge.vue','utf8')
const { descriptor } = parse(source)
let code = compileScript(descriptor, { id:'edge-test', inlineTemplate:true }).content
code = code.replaceAll("'@vue-flow/core'", "'./core.mjs'")
  .replaceAll("'../../stores/canvas'", "'./state.mjs'")
  .replaceAll("'../../composables/useEdgeFocus'", "'./state.mjs'")
  .replaceAll("'../../utils/edgeRunState'", "'../../src/utils/edgeRunState.js'")
await mkdir('artifacts/edge-regression',{recursive:true})
await writeFile('artifacts/edge-regression/component.mjs',code)
await writeFile('artifacts/edge-regression/core.mjs', `
import {h,ref} from 'vue'
export {BaseEdge,getBezierPath} from '@vue-flow/core'
export const EdgeLabelRenderer={setup:(_,ctx)=>()=>h('div',ctx.slots.default?.())}
export const useVueFlow=()=>({viewport:ref({zoom:.4}),screenToFlowCoordinate:({x,y})=>({x:x/.4,y:y/.4})})
`)
await writeFile('artifacts/edge-regression/state.mjs', `
import {ref} from 'vue'
export const nodes=ref([{id:'source',type:'image',selected:true,data:{}},{id:'target',type:'render',data:{loading:true}}])
export const edges=ref([{id:'edge',source:'source',target:'target'}])
export const activeEdgeId=ref('')
export const focusEdge=id=>activeEdgeId.value=id
export const clearEdgeFocus=()=>activeEdgeId.value=''
export const nodeSlots=()=>({idle:[]})
export const cutEdge=id=>edges.value=edges.value.filter(e=>e.id!==id)
`)
const { createApp,h,ref,nextTick } = await import('vue')
const {default:FlowEdge}=await import('../artifacts/edge-regression/component.mjs')
const state=await import('../artifacts/edge-regression/state.mjs')
const selected=ref(false)
const app=createApp({setup:()=>()=>h(FlowEdge,{id:'edge',source:'source',target:'target',sourceX:0,sourceY:0,targetX:500,targetY:300,sourcePosition:'right',targetPosition:'left',selected:selected.value})})
app.mount('#app')
assert.equal(document.querySelectorAll('.vue-flow__edge-interaction').length,0,'BaseEdge must not cover our hit path')
const hit=document.querySelector('.flow-edge-hit')
assert.equal(hit.getAttribute('vector-effect'),'non-scaling-stroke')
hit.dispatchEvent(new window.MouseEvent('mouseenter',{clientX:80,clientY:100}))
await nextTick()
assert.ok(document.querySelector('.flow-edge-scissors'),'Hover reveals scissors')
assert.match(document.querySelector('.flow-edge-actions').style.transform,/translate\(200px, 250px\)/)
hit.dispatchEvent(new window.MouseEvent('click',{bubbles:true}))
assert.equal(state.edges.value[0].selected,true,'Click selects even when target is running')
assert.equal(state.nodes.value[0].selected,false)
state.clearEdgeFocus()
hit.dispatchEvent(new window.MouseEvent('mouseleave'))
await new Promise(resolve=>setTimeout(resolve,260))
selected.value=true
await nextTick()
assert.ok(document.querySelector('.flow-edge-scissors'),'Box-selected edge reveals scissors')
document.querySelector('.flow-edge-scissors').click()
assert.equal(state.edges.value.length,0,'Scissors disconnects edge')
app.unmount()
dom.window.close()
console.log('PASS: actual FlowEdge + BaseEdge, no duplicate hit path, hover position, active-task selection, box-selection scissors, disconnect')
