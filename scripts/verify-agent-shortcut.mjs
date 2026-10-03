import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { handleAgentShortcut } from '../src/utils/agentShortcut.js'

const { window } = new JSDOM('<aside><textarea></textarea><button>Close</button></aside>')
let toggles = 0
let canvasEvents = 0
window.document.querySelector('aside').addEventListener('keydown', event => event.stopPropagation())
const listener = event => handleAgentShortcut(event, () => toggles++)
window.addEventListener('keydown', listener, true)
window.addEventListener('keydown', () => canvasEvents++)
const send = (target, options = {}) => {
  const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'KeyQ', key: 'q', altKey: true, ...options })
  target.dispatchEvent(event)
  return event
}
for (const target of [window.document.body, window.document.querySelector('textarea'), window.document.querySelector('button')]) {
  assert.equal(send(target).defaultPrevented, true)
}
assert.equal(toggles, 3, 'Canvas, composer and panel buttons all toggle')
send(window.document.body, { repeat: true })
assert.equal(toggles, 3, 'Holding the shortcut cannot repeatedly toggle')
assert.equal(canvasEvents, 0, 'Shortcut cannot also activate canvas panning')
send(window.document.querySelector('textarea'), { code: '', key: 'q' })
assert.equal(toggles, 4, 'Q key fallback works')
send(window.document.body, { altKey: false })
assert.equal(toggles, 4, 'Plain Q retains canvas behavior')
assert.equal(canvasEvents, 1)
send(window.document.querySelector('textarea'), { key: 'Q' })
assert.equal(toggles, 5, 'Alt+Q works inside the composer')
send(window.document.querySelector('button'), { repeat: true })
assert.equal(toggles, 5, 'Alternate shortcut also suppresses repeats')
window.removeEventListener('keydown', listener, true)
send(window.document.body)
assert.equal(toggles, 5, 'Unmount cleanup removes the shortcut')
console.log('PASS: capture routing, panel input/buttons, repeat suppression, key fallback, plain Space and cleanup')
