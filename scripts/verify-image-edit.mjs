import assert from 'node:assert/strict'
import { normalizedRect, pixelCrop, fitCropRatio } from '../src/utils/imageEditGeometry.js'
const rect = normalizedRect({x:.8,y:.9},{x:.2,y:.1})
assert.ok(Math.abs(rect.width-.6)<1e-10)
assert.deepEqual(pixelCrop({x:.25,y:.1,width:.5,height:.8},3840,2560),{x:960,y:256,width:1920,height:2048})
for (const [width,height] of [[3840,2560],[2881,3840]]) {
  for (const ratio of [1,3/4,4/3,16/9,9/16]) {
    const fitted = fitCropRatio({x:.05,y:.05,width:.9,height:.9},ratio,width,height)
    const crop = pixelCrop(fitted,width,height)
    assert.ok(Math.abs(crop.width/crop.height-ratio)<.003)
    assert.ok(crop.x>=0 && crop.y>=0 && crop.x+crop.width<=width && crop.y+crop.height<=height)
  }
}
assert.deepEqual(pixelCrop({x:1,y:1,width:1,height:1},100,100),{x:99,y:99,width:1,height:1})
console.log('PASS: original-pixel crop coordinates, landscape/portrait ratios and bounds.')
