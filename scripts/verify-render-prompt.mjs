import assert from 'node:assert/strict'
import { readParams, buildRenderPrompt, buildRenderImages } from '../src/utils/renderPrompt.js'
const params = readParams({ personImage: 'person', outsideImage: 'outside' })
assert.deepEqual(buildRenderImages('base', params), ['base'])
assert.deepEqual(buildRenderImages('base', { ...params, person: true, outside: '参考图' }), ['base', 'person', 'outside'])
assert.deepEqual(buildRenderImages('base', { ...params, person: true, outside: '参考图', closed: true }), ['base', 'person'])
const prompt = buildRenderPrompt({ ...params, person: true }).join('\n')
assert.match(prompt, /照片级写实/)
assert.match(prompt, /去除黑色描边/)
assert.match(prompt, /保留的是几何布局/)
assert.match(prompt, /人物和外景是附加要求/)
console.log('PASS: photorealistic objective, geometry/style distinction, enabled-only references in base/person/outside order')
