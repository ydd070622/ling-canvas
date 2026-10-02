import assert from 'node:assert/strict'
import { renderOutputOffsets, renderOutputSize } from '../src/utils/renderOutputLayout.js'
for (const ratios of [['3:4','3:4','3:4'],['9:16','1:1','21:9'],['9:21','16:9','2:3']]) {
  const offsets = renderOutputOffsets([0,300,500], ratios)
  for (let i=1;i<offsets.length;i++) assert.ok(offsets[i] >= offsets[i-1]+renderOutputSize(ratios[i-1]).height+48)
}
assert.equal(renderOutputOffsets([0,1000],['1:1','1:1'])[1],1000)
assert.ok(renderOutputSize('16:9',{width:500,height:400}).height>=400)
console.log('PASS: portrait, square, landscape rows and measured dimensions have separate space')
