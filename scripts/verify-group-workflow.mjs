import assert from 'node:assert/strict'
import { workflowOrder, instantiateGroupWorkflow } from '../src/utils/groupWorkflow.js'
import { fitNodeGroups } from '../src/utils/groupBounds.js'
const members = [{ id: 'b' }, { id: 'a' }, { id: 'c' }]
const edges = [{ id: 'e', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }]
assert.deepEqual(workflowOrder(members, edges).map(node => node.id), ['a','b','c'])
assert.throws(() => workflowOrder(members, [...edges,{ source:'c',target:'a' }]), /循环/)
const saved = { nodes: [{ id:'g',type:'group',position:{x:0,y:0},data:{memberIds:['a','b'],color:'#b64747'} },{id:'a',parentNode:'g',position:{x:28,y:28},data:{prompt:'原始提示词'}},{id:'b',parentNode:'g',position:{x:180,y:28},data:{refBindings:{e:{edgeId:'e',nodeId:'a'}},groupId:'g'}}],edges:[edges[0]] }
const restored = instantiateGroupWorkflow(saved,{x:500,y:600})
assert.equal(restored.nodes[1].parentNode,restored.nodes[0].id)
assert.equal(restored.nodes[2].data.refBindings[restored.edges[0].id].nodeId,restored.nodes[1].id)
assert.equal(restored.nodes[2].data.refBindings[restored.edges[0].id].edgeId,restored.edges[0].id)
assert.equal(restored.nodes[1].data.prompt,'原始提示词')
assert.equal(restored.nodes[0].data.color,'#b64747')
assert.deepEqual(restored.nodes[0].position,{x:500,y:600})
assert.equal(saved.nodes[0].id,'g')
let nodes=[{id:'g',type:'group',position:{x:100,y:100},style:{width:'900px',height:'800px'},data:{manualBounds:{x:0,y:0,width:900,height:800}}},{id:'a',parentNode:'g',position:{x:28,y:28},dimensions:{width:100,height:100}}]
assert.equal(fitNodeGroups(nodes),nodes,'Manual enlargement is retained')
nodes=nodes.map(node=>node.id==='a'?{...node,position:{x:-100,y:-100}}:node)
const fitted=fitNodeGroups(nodes)
assert.equal(fitted[0].position.x+fitted[1].position.x,0,'Automatic expansion preserves member world position')
assert.ok(parseFloat(fitted[0].style.width)>=900)
assert.equal(fitNodeGroups(fitted),fitted,'Manual and automatic bounds stabilize')
console.log('PASS: dependency order, cycle guard, remapped nodes/edges/references, prompts, colors, manual size retention and adaptive expansion')
