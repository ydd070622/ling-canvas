import assert from 'node:assert/strict'
import { isEdgeRunning } from '../src/utils/edgeRunState.js'
const render = { type: 'render', data: { loading: true } }
assert.equal(isEdgeRunning(render, { data: { loading: true } }), true)
assert.equal(isEdgeRunning(render, { data: { loading: false, error: 'failed' } }), false)
assert.equal(isEdgeRunning(render, { data: { loading: false, url: 'complete' } }), false)
assert.equal(isEdgeRunning({ data: {} }, { data: { loading: true } }), true)
assert.equal(isEdgeRunning({ data: {} }, { data: { loading: false } }), false)
console.log('PASS: active edge animates; failed/completed result edges stop independently')
