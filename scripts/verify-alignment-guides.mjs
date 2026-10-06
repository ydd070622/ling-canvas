import assert from 'node:assert/strict'
import { alignmentGuides } from '../src/utils/alignmentGuides.js'
const target = {left:100,right:200,top:100,bottom:200}
for (const rect of [target,{left:100,right:180,top:100,bottom:180},{left:120,right:200,top:120,bottom:200},{left:125,right:175,top:125,bottom:175}]) {
  const before = JSON.stringify(rect)
  assert.equal(alignmentGuides([rect],[target]).length,2)
  assert.equal(JSON.stringify(rect),before)
}
assert.equal(alignmentGuides([{left:103,right:203,top:103,bottom:203}],[target]).length,0)
assert.equal(alignmentGuides([target],[]).length,0)
const near = {left:104,right:204,top:96,bottom:196}
const snap = alignmentGuides([near],[target],5)
assert.equal(snap.find(guide => guide.axis === 'x').offset,-4)
assert.equal(snap.find(guide => guide.axis === 'y').offset,4)
assert.equal(alignmentGuides([{left:106,right:206,top:106,bottom:206}],[target],5).length,0)
console.log('PASS: four edges, centers, screen tolerance and no position mutation')
