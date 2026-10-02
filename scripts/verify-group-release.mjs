import assert from 'node:assert/strict'
import {fitNodeGroups,releaseGroupMembers,joinDroppedGroupMembers} from '../src/utils/groupBounds.js'
const bounds=new Map([['g',{x:100,y:100,width:400,height:400}]])
const base=[{id:'g',type:'group',position:{x:100,y:100},style:{width:'400px',height:'400px'},data:{memberIds:['a','b']}},{id:'a',parentNode:'g',extent:undefined,position:{x:28,y:28},dimensions:{width:100,height:100},data:{groupId:'g'}},{id:'b',parentNode:'g',position:{x:228,y:228},dimensions:{width:100,height:100},data:{groupId:'g'}}]
assert.equal(fitNodeGroups(base,28,new Set(['g'])),base,'Original group bounds stay frozen throughout drag')
assert.equal(releaseGroupMembers(base,new Set(['a']),bounds),base,'Inside release remains grouped')
for(const position of [{x:-100,y:28},{x:450,y:28},{x:28,y:-100},{x:28,y:450}]){
 const dragged=base.map(n=>n.id==='a'?{...n,position}:n)
 const next=releaseGroupMembers(dragged,new Set(['a']),bounds)
 const member=next.find(n=>n.id==='a')
 assert.equal(member.parentNode,undefined)
 assert.equal(member.data.groupId,undefined)
 assert.deepEqual(member.position,{x:position.x+100,y:position.y+100})
 assert.equal(next.find(n=>n.id==='b').parentNode,'g')
 assert.deepEqual(next.find(n=>n.id==='g').data.memberIds,['b'])
 const fitted=fitNodeGroups(next)
 const sibling=fitted.find(n=>n.id==='b'),group=fitted.find(n=>n.id==='g')
 assert.equal(sibling.position.x+group.position.x,328)
 assert.equal(sibling.position.y+group.position.y,328)
}
console.log('PASS: frozen drag bounds; inside release stays grouped; all four outside releases detach; sibling and world positions retained')

const root={id:'outside',type:'image',position:{x:180,y:180},dimensions:{width:100,height:100},data:{}}
const joined=joinDroppedGroupMembers([...base,root],new Set(['outside']))
assert.equal(joined.find(n=>n.id==='outside').parentNode,'g')
assert.deepEqual(joined.find(n=>n.id==='outside').position,{x:80,y:80})
assert.ok(joined.find(n=>n.id==='g').data.memberIds.includes('outside'))
assert.equal(joinDroppedGroupMembers([...base,root],new Set(['g','outside'])).find(n=>n.id==='outside').parentNode,undefined,'Moving whole group does not absorb unrelated nodes')
const far={...root,position:{x:800,y:800}}
const untouched=[...base,far]
assert.equal(joinDroppedGroupMembers(untouched,new Set(['outside'])),untouched)
console.log('PASS: outside drop joins; world coordinates retained; far drop ignored; moving group does not absorb nodes')

// Exactly one quarter across each edge joins even when center is outside.
for (const position of [{x:475,y:200},{x:25,y:200},{x:200,y:475},{x:200,y:25},{x:450,y:450}]) {
 const quarter={...root,position}
 const joined=joinDroppedGroupMembers([...base,quarter],new Set(['outside']))
 const member=joined.find(n=>n.id==='outside')
 assert.equal(member.parentNode,'g','25% overlap accepts edge/corner drop')
 const fitted=fitNodeGroups(joined),group=fitted.find(n=>n.id==='g'),child=fitted.find(n=>n.id==='outside')
 assert.equal(group.position.x+child.position.x,position.x)
 assert.equal(group.position.y+child.position.y,position.y)
 assert.ok(child.position.x>=28 && child.position.y>=28)
 assert.ok(child.position.x+100+28<=parseFloat(group.style.width))
 assert.ok(child.position.y+100+28<=parseFloat(group.style.height))
}
const below={...root,position:{x:475.1,y:200}}
const before=[...base,below]
assert.equal(joinDroppedGroupMembers(before,new Set(['outside'])),before,'Less than 25% does not join')
const exiting={...root,position:{x:475,y:200}}
assert.equal(joinDroppedGroupMembers([...base,exiting],new Set(['outside']),new Map([['outside','g']])).find(n=>n.id==='outside').parentNode,undefined,'Drag out cannot instantly rejoin old group')
console.log('PASS: quarter overlap on four edges and corner; adaptive full bounds; below threshold ignored; drag-out preserved')
