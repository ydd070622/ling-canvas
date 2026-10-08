import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const source = fs.readFileSync('src/stores/agent.js','utf8')
const helper = source.slice(source.indexOf('  function inheritedReferences'),source.indexOf('  const sendPromptsToCanvas'))
const context=vm.createContext({});vm.runInContext(helper,context)
const initial={role:'assistant',projectId:'one',referenceNodeIds:['a','b']}
const followup={role:'user',content:'生成提示词'}
assert.equal(JSON.stringify(context.inheritedReferences([initial,followup],'one')),JSON.stringify(['a','b']))
assert.equal(context.inheritedReferences([initial,followup],'two').length,0)
assert.equal(context.inheritedReferences([initial,{role:'user',images:['external']}],'one').length,0)
assert.equal(JSON.stringify(context.inheritedReferences([initial,{role:'assistant',projectId:'one',referenceNodeIds:['new']}],'one')),JSON.stringify(['new']))
console.log('PASS: follow-up inherits references, project isolation, replacement image boundary')
