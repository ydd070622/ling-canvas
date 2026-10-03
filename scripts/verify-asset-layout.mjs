import assert from 'node:assert/strict'
import { layoutAssetImages } from '../src/utils/assetLayout.js'
import { cardWidthForRatio } from '../src/utils/ratio.js'

const ratios = [2.48, 0.75, 1, 0.4, 3]
const positions = layoutAssetImages(ratios, { x: -120, y: 80 })
assert.deepEqual(positions[0], { x: -120, y: 80 })
assert.equal(positions[0].y, positions[1].y)
assert.equal(positions[2].y, positions[3].y)
for (let i = 0; i < ratios.length; i++) {
  for (let j = i + 1; j < ratios.length; j++) {
    const a = positions[i], b = positions[j]
    const aw = cardWidthForRatio(ratios[i]), ah = aw / ratios[i]
    const bw = cardWidthForRatio(ratios[j]), bh = bw / ratios[j]
    assert.ok(a.x + aw < b.x || b.x + bw < a.x || a.y + ah < b.y || b.y + bh < a.y)
  }
}
assert.equal(layoutAssetImages([0, NaN], { x: 0, y: 0 })[1].x, 377)
assert.deepEqual(layoutAssetImages([], { x: 0, y: 0 }), [])
console.log('Asset layout verified: mixed ratios, two columns, gaps, missing metadata.')
