import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync('src/main.js','utf8')
const handler=source.match(/window\.addEventListener\('error', event => \{[\s\S]*?\n\}\)/)[0]
let callback;const messages=[]
vm.runInNewContext(handler,{window:{addEventListener:(_,fn)=>callback=fn},showFatal:text=>messages.push(text)})
callback({message:'ResizeObserver loop completed with undelivered notifications.'})
callback({message:'ResizeObserver loop limit exceeded'})
assert.equal(messages.length,0)
callback({message:'onBeforeUnmount is not defined',error:new ReferenceError('onBeforeUnmount is not defined')})
assert.equal(messages.length,1)
assert.match(messages[0],/ReferenceError/)
const css=readFileSync('src/styles/flow-nodes.css','utf8')
assert.match(css,/\.flow-error-dialog \{ position: fixed; inset: 0; margin: auto;/)
console.log('PASS: layout notices do not show fatal overlay; real runtime errors retained; dialog explicit viewport centering')
