import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {JSDOM} from 'jsdom'
const dom=new JSDOM('<body><div id="app"></div></body>',{url:'http://localhost'})
for(const key of ['window','document','Element','HTMLElement','SVGElement','Node','navigator'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true})
const vue=await import('vue')
const {parse,compileTemplate}=await import('@vue/compiler-sfc')
const source=readFileSync('src/components/canvas/CanvasComposer.vue','utf8')
const {descriptor}=parse(source)
let code=compileTemplate({source:descriptor.template.content,filename:'CanvasComposer.vue',id:'test'}).code
code=code.replace(/import \{([^}]+)\} from "vue"/,(_,items)=>`const {${items.replace(/ as /g,':')}}=vue`).replace('export function render','function render')
const render=new Function('vue',code+'\nreturn render')(vue)
const interaction=source.slice(source.indexOf('const toggleComposerExpanded ='),source.indexOf("const targetType ="))
let state
const component={render,setup(){const inputRef=vue.ref(null),text=vue.ref('long prompt\nsecond line'),composerExpanded=vue.ref(false)
 const actions=new Function('inputRef','composerExpanded','nextTick',interaction+'\nreturn {toggleComposerExpanded,onComposerEscape}')(inputRef,composerExpanded,vue.nextTick)
 state={inputRef,text,composerExpanded,...actions}
 return {...state,contextChips:[],mentionRefs:[],isParamlessNode:false,isCompareNode:false,isRenderNode:false,TARGET_TYPES:[],modelOptions:[],modelPanelOptions:[],mentionCandidates:[],resolutionOptions:[],ratioOptions:[],COUNTS:[],videoPresetOptions:[],onInput:()=>{},onKeydown:()=>{},updateMention:()=>{},closeMention:()=>{},send:()=>{},changeTargetType:()=>{}}}}
const app=vue.createApp(component)
for(const name of ['OptionPanel','PresetGallery','ParamPanel'])app.component(name,{render:()=>null})
app.config.warnHandler=()=>{}
app.mount('#app')
assert.equal(document.querySelector('.compose-attach'),null)
const input=state.inputRef.value
input.setSelectionRange(4,9)
document.querySelector('.compose-expand').click()
await vue.nextTick();await vue.nextTick()
assert.equal(state.composerExpanded.value,true)
assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-modal'),'true')
assert.equal(state.inputRef.value.value,'long prompt\nsecond line')
assert.equal(state.inputRef.value.selectionStart,4)
state.inputRef.value.value='edited while expanded'
state.inputRef.value.dispatchEvent(new window.Event('input',{bubbles:true}))
assert.equal(state.text.value,'edited while expanded')
state.inputRef.value.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
await vue.nextTick();await vue.nextTick()
assert.equal(state.composerExpanded.value,false)
assert.equal(state.inputRef.value.value,'edited while expanded')
assert.equal(document.querySelector('.compose-backdrop'),null)
console.log('PASS: real composer template, expand, shared prompt editing, caret retention, Escape collapse, plus removed')
app.unmount()
