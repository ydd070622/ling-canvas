import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./alias-loader.mjs', import.meta.url)
globalThis.localStorage = { getItem: () => null, setItem() {} }
const { computeSlots, renumberRefs } = await import('../src/utils/promptRefs.js')
const target = { id:'target',type:'image',data:{ prompt:'@图片1 和 @图片2',refBindings:{图片1:'a',图片2:'b'} } }
const nodes=[target,{id:'one',type:'image',data:{}},{id:'two',type:'image',data:{}}]
const edges=[{id:'a',source:'one',target:'target',data:{order:2,referenceIndex:1}},{id:'b',source:'two',target:'target',data:{order:1,referenceIndex:2}}]
const slots=computeSlots(target,nodes,edges).slots
assert.deepEqual(slots.map(s=>[s.src.id,s.token]),[['two','@图片1'],['one','@图片2']])
const result=renumberRefs(target,nodes,edges)
assert.equal(result.prompt,'@图片2 和 @图片1')
assert.deepEqual(result.refBindings,{图片2:'a',图片1:'b'})
console.log('PASS: reorder renumbers labels and preserves prompt image bindings')
