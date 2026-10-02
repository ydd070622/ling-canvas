import {JSDOM} from 'jsdom'
import assert from 'node:assert/strict'
const dom = new JSDOM('<html><head><style>.vue-flow__pane{z-index:1}</style></head><body><div id="app"></div></body></html>', {url:'http://localhost'})
for (const key of ['window','document','Element','HTMLElement','SVGElement','Node','navigator','MutationObserver']) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true})
globalThis.requestAnimationFrame = window.requestAnimationFrame = fn => setTimeout(fn,0)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame = clearTimeout
window.DOMMatrixReadOnly = class {constructor(){this.m22=1}}
const observers=[]
globalThis.ResizeObserver = window.ResizeObserver = class {
 constructor(cb){this.cb=cb;this.targets=new Set();observers.push(this)}
 observe(target){this.targets.add(target);setTimeout(()=>this.targets.has(target)&&this.cb([{target}]),0)}
 unobserve(target){this.targets.delete(target)} disconnect(){this.targets.clear()}
}
Object.defineProperty(HTMLElement.prototype,'offsetWidth',{get(){return this.classList.contains('vue-flow__node')?300:1000}})
Object.defineProperty(HTMLElement.prototype,'offsetHeight',{get(){return this.classList.contains('vue-flow__node')?220:800}})
HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,left:0,top:0,right:this.offsetWidth,bottom:this.offsetHeight,width:this.offsetWidth,height:this.offsetHeight}}
const {createApp,defineComponent,h,ref,nextTick,watch,markRaw}=await import('vue')
const {VueFlow,useVueFlow}=await import('@vue-flow/core')
const {useCanvasFlowSync,applyFlowNodeChanges}=await import('../src/composables/useCanvasFlowSync.js')
const {toCanvasNode}=await import('../src/utils/nodePayload.js')
const nodes=ref([{id:'old',type:'test',position:{x:0,y:0},data:{loading:false}}])
const edges=ref([])
let flow
const TestNode=defineComponent({props:['id','data'],setup:props=>()=>h('div',{'data-content-id':props.id},props.data.loading?'loading':props.data.url||'empty')})
const remountKey=ref(0)
const legacy=process.argv.includes('--legacy')
let sync
const app=createApp(defineComponent({setup(){flow=useVueFlow('regression');if(!legacy)sync=useCanvasFlowSync(nodes,edges,flow);return ()=>h(VueFlow,{id:'regression',key:remountKey.value,...(legacy?{nodes:nodes.value,edges:edges.value,'onUpdate:nodes':v=>nodes.value=v,'onUpdate:edges':v=>edges.value=v}:{onNodesChange:sync.onNodesChange,onEdgesChange:sync.onEdgeSelectionChange}),nodeTypes:{test:markRaw(TestNode),group:markRaw(TestNode)},nodesDraggable:false,panOnDrag:false,zoomOnScroll:false,deleteKeyCode:null})}}))
app.config.warnHandler=()=>{}
app.mount('#app')
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,10));await nextTick()}
await settle()
let failures=0
let triggered=false
const stop=watch(flow.nodes,()=>{
 if(triggered||!flow.findNode('new'))return
 triggered=true
 // 模拟业务更新在 Vue Flow 回传节点数组的同一个更新周期发生。
 nodes.value=[...nodes.value.filter(n=>n.id!=='old').map(n=>n.id==='new'?{...n,data:{loading:false,url:'result'}}:n),{id:'generated',type:'test',position:{x:800,y:0},data:{url:'generated-result'}}]
},{flush:'post'})
nodes.value=[...nodes.value,{id:'new',type:'test',position:{x:400,y:0},data:{loading:true}}]
await settle()
console.log('TRACE', {business:nodes.value.map(n=>({id:n.id,data:n.data})),internal:flow.nodes.value.map(n=>({id:n.id,data:n.data})),dom:document.querySelector('[data-id="new"]')?.textContent})
if(nodes.value.length!==flow.nodes.value.length||nodes.value.find(n=>n.id==='new')?.data.url!==flow.findNode('new')?.data.url)failures++
stop()
console.log('RESULT', {failures,iterations:1})
assert.equal(failures,0,'Graph must receive business updates made in the same tick as internal graph updates')
assert.ok(document.querySelector('[data-id="generated"]'),'New result must have a DOM node')
for(let i=0;i<60;i++){
 const id='cycle'+i
 nodes.value=[...nodes.value,{id,type:'test',position:{x:800,y:i},data:{loading:true}}]
 await nextTick()
 nodes.value=nodes.value.filter(n=>n.id!==(i===0?'generated':'cycle'+(i-1)))
 nodes.value=nodes.value.map(n=>n.id===id?{...n,data:{url:'result'+i,loading:false}}:n)
 await settle()
 assert.ok(document.querySelector('[data-id="'+id+'"]'))
 assert.equal(flow.findNode(id).data.url,'result'+i)
 assert.equal(document.querySelector('[data-id="'+id+'"]')?.style.visibility,'visible')
 sync.onNodesChange([{id,type:'position',position:{x:900,y:i},dragging:false},{id,type:'select',selected:true}])
 assert.equal(nodes.value.find(n=>n.id===id).position.x,900)
 assert.equal(nodes.value.find(n=>n.id===id).selected,true)
 assert.equal(nodes.value.find(n=>n.id===id).data.url,'result'+i)
}
// A legacy document contains an old engine cache. A data-only update must
// never move the DOM back to that cached position after a drag.
await settle()
const last = nodes.value.find(n=>n.id==='cycle59')
nodes.value=nodes.value.map(n=>n.id===last.id?{...n,computedPosition:{x:400,y:0,z:0}}:n)
assert.equal(flow.findNode(last.id).computedPosition.x,900,'Business writes must not reset engine coordinates even for one frame')
await settle()
const transform=document.querySelector('[data-id="cycle59"]').style.transform
assert.equal(transform,'translate(900px,59px)','Stale engine coordinates must not override the real node position')
const saved=toCanvasNode({...nodes.value.find(n=>n.id===last.id),dragging:true,handleBounds:{source:[]},dimensions:{width:300,height:220}})
assert.equal(saved.computedPosition,undefined)
assert.equal(saved.dragging,undefined)
assert.equal(saved.handleBounds,undefined)
assert.deepEqual(saved.position,{x:900,y:59})
// Use the engine's actual movement and release hooks, including its default
// change handler, rather than calling the business patch function alone.
for (let i=0;i<30;i++) {
 const position={x:950+i*7,y:120+i*3}
 flow.updateNodePositions([{id:last.id,position,from:flow.findNode(last.id).position}],true,true)
 await settle()
 flow.updateNodePositions([{id:last.id,position,from:flow.findNode(last.id).position}],false,false)
 await settle()
 assert.deepEqual(nodes.value.find(n=>n.id===last.id).position,position,'Release retains the final drag position')
 assert.equal(document.querySelector('[data-id="cycle59"]').style.transform,`translate(${position.x}px,${position.y}px)`,'Release does not snap the DOM back')
}

const {fitNodeGroups,releaseGroupMembers,joinDroppedGroupMembers}=await import('../src/utils/groupBounds.js')
let groupFrame=null
const stopFit=watch(nodes,()=>{if(groupFrame!==null)return;groupFrame=requestAnimationFrame(()=>{groupFrame=null;const fitted=fitNodeGroups(nodes.value);if(fitted!==nodes.value)nodes.value=fitted})},{deep:true,flush:'post'})
nodes.value=[...nodes.value,
 {id:'group',type:'group',position:{x:100,y:100},style:{width:'756px',height:'276px'},data:{}},
 {id:'memberA',type:'test',parentNode:'group',extent:'parent',position:{x:28,y:28},data:{}},
 {id:'memberB',type:'test',parentNode:'group',extent:'parent',position:{x:428,y:28},data:{}}]
await settle()
const world=id=>{const n=nodes.value.find(n=>n.id===id),g=nodes.value.find(candidate=>candidate.id===n.parentNode);return {x:n.position.x+g.position.x,y:n.position.y+g.position.y}}
const stationary=world('memberB')
for(const position of [{x:-200,y:128},{x:-200,y:-150},{x:1100,y:-150},{x:1100,y:850}]){
 flow.updateNodePositions([{id:'memberA',parentNode:'group',position,from:flow.findNode('memberA').position}],true,true)
 await settle()
 flow.updateNodePositions([{id:'memberA',parentNode:'group',position,from:flow.findNode('memberA').position}],false,false)
 await settle()
 assert.deepEqual(world('memberA'),position,'Group drag preserves target world position after release')
 assert.deepEqual(world('memberB'),stationary,'Resizing does not move other group members')
 assert.equal(flow.findNode('memberA').extent,undefined,'Parent boundary must be removed from engine')
 assert.equal(document.querySelector('[data-id="memberA"]').style.transform,`translate(${position.x}px,${position.y}px)`)
}
stopFit()
const group=nodes.value.find(n=>n.id==='group')
const beforeDetach=world('memberA')
const bounds=new Map([['group',{x:group.position.x,y:group.position.y,width:200,height:200}]])
nodes.value=releaseGroupMembers(nodes.value,new Set(['memberA']),bounds)
await settle()
assert.equal(flow.findNode('memberA').parentNode,undefined,'Engine must clear parent on detach')
assert.deepEqual(nodes.value.find(n=>n.id==='memberA').position,beforeDetach)
assert.equal(document.querySelector('[data-id="memberA"]').style.transform,`translate(${beforeDetach.x}px,${beforeDetach.y}px)`,'Detach does not jump node')
console.log('PASS: release outside detaches engine parent without world position jump')
const targetWorld={x:group.position.x+40,y:group.position.y+40}
nodes.value=nodes.value.map(n=>n.id==='memberA'?{...n,position:targetWorld}:n)
nodes.value=joinDroppedGroupMembers(nodes.value,new Set(['memberA']))
await settle()
assert.equal(flow.findNode('memberA').parentNode,'group')
assert.equal(document.querySelector('[data-id="memberA"]').style.transform,`translate(${targetWorld.x}px,${targetWorld.y}px)`,'Joining preserves world position')
assert.equal(nodes.value.find(n=>n.id==='memberA').data.groupId,'group')
console.log('PASS: dropping back into group updates engine parent without jumping')
console.log('PASS: real engine group movement and release in all four directions, stationary sibling, unconstrained members')

remountKey.value++
await settle()
assert.ok(document.querySelector('[data-id="cycle59"]'),'Project canvas remount retains graph state')
console.log('PASS: pause-window deletion, new-result visibility, 60 result/position/select cycles, stale-coordinate isolation, storage projection, 30 engine movement/release cycles, canvas remount')
sync.stop()
app.unmount()
