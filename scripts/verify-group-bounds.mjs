import assert from 'node:assert/strict'
import { fitNodeGroups } from '../src/utils/groupBounds.js'
let nodes=[{id:'g',type:'group',position:{x:100,y:100},style:{width:'400px',height:'300px'}},
{id:'a',parentNode:'g',extent:'parent',position:{x:28,y:28},dimensions:{width:100,height:160}},
{id:'b',parentNode:'g',extent:'parent',position:{x:200,y:28},dimensions:{width:100,height:160}}]
const absolute=list=>list.filter(n=>n.parentNode).map(n=>({id:n.id,x:list[0].position.x+n.position.x,y:list[0].position.y+n.position.y}))
nodes=fitNodeGroups(nodes)
assert.equal(nodes[1].extent,undefined)
for(const position of [{x:-200,y:-140},{x:900,y:700},{x:28,y:28}]) {
  nodes=nodes.map(n=>n.id==='a'?{...n,position}:n)
  const expected=absolute(nodes)
  nodes=fitNodeGroups(nodes)
  assert.deepEqual(absolute(nodes),expected,'Resizing group preserves world coordinates')
  assert.equal(fitNodeGroups(nodes),nodes,'Bounds stabilize without update loops')
  for(const child of nodes.slice(1)) {
    assert.ok(child.position.x>=28 && child.position.y>=28)
    assert.ok(child.position.x+child.dimensions.width+28<=parseFloat(nodes[0].style.width))
  }
}
console.log('PASS: remove parent constraint, left/up/right/down movement, adaptive bounds, stable world positions')

const origin = { ...nodes[0].position }
for (const position of [{x:-300,y:-200},{x:900,y:700},{x:28,y:28}]) {
  nodes=nodes.map(n=>n.id==='a'?{...n,position}:n)
  const expected=absolute(nodes)
  nodes=fitNodeGroups(nodes,28,new Set(['g']))
  assert.deepEqual(nodes[0].position,origin,'Live fitting never moves the drag origin')
  assert.deepEqual(absolute(nodes),expected,'Live fitting preserves all member positions')
  const frame=nodes[0].data.dragBounds
  for(const child of nodes.slice(1)) {
    assert.ok(child.position.x>=frame.x+28 && child.position.y>=frame.y+28)
    assert.ok(child.position.x+child.dimensions.width+28<=frame.x+frame.width)
    assert.ok(child.position.y+child.dimensions.height+28<=frame.y+frame.height)
  }
  assert.equal(fitNodeGroups(nodes,28,new Set(['g'])),nodes,'Live bounds stabilize')
}
const before=absolute(nodes)
nodes=fitNodeGroups(nodes)
assert.deepEqual(absolute(nodes),before,'Release fitting preserves positions')
assert.equal(nodes[0].data.dragBounds,undefined,'Release clears temporary frame')
console.log('PASS: continuous drag bounds in every direction, stable drag origin, release cleanup')
