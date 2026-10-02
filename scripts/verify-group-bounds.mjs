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
