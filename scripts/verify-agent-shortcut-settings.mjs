import assert from 'node:assert/strict'
globalThis.localStorage={getItem:()=>JSON.stringify({code:'KeyJ',key:'j',ctrlKey:true}),setItem(){}}
const settings=await import('../src/stores/agentShortcut.js')
assert.equal(settings.agentShortcutLabel.value,'Alt + Q')
const restored=await import('../src/stores/agentShortcut.js?restart')
assert.equal(restored.agentShortcutLabel.value,'Alt + Q')
console.log('PASS: fixed Alt+Q ignores legacy customization and survives restart')