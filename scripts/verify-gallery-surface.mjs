import fs from 'node:fs'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
const css = fs.readFileSync('src/styles/flow-nodes.css', 'utf8')
for (const state of ['is-compact', 'is-expanded is-focused']) {
  const dom = new JSDOM(`<style>${css}</style><div class="canvas-flow"><div class="vue-flow__node selected"><div class="flow-node-outer flow-node-image ${state}"><div class="flow-card"><div class="flow-card-body"><div class="flow-stage"><div class="flow-image-gallery"><div class="flow-image-gallery-item"></div></div></div></div></div></div></div></div>`)
  const style = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector))
  assert.equal(style('.flow-card').backgroundColor, 'rgba(0, 0, 0, 0)')
  assert.equal(style('.flow-card-body').padding, '0px')
  assert.equal(style('.flow-stage').backgroundColor, 'rgba(0, 0, 0, 0)')
  console.log(`PASS gallery canvas gaps: ${state}`)
}
assert.ok(!fs.readFileSync('src/components/nodes/SimpleImageNode.vue', 'utf8').includes('flow-history-preview'))
console.log('PASS overlapping history hover preview removed')
