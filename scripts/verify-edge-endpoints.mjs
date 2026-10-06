import assert from 'node:assert/strict'
import fs from 'node:fs'
const source=fs.readFileSync('src/components/edges/FlowEdge.vue','utf8').replace(/\r/g,'')
const body=source.split('const cardEndpointX = (id, x, position) => {')[1].split('\n}\n')[0]
const node={computedPosition:{x:100},dimensions:{width:280}}
const endpoint=new Function('findNode','pullInsideCard',`return (id,x,position)=>{${body}}`)(()=>node,(x,p)=>x-(p==='right'?1:-1)*34)
assert.equal(endpoint('n',414,'right'),380)
assert.equal(endpoint('n',66,'left'),100)
node.dimensions.width=420;assert.equal(endpoint('n',414,'right'),520)
node.computedPosition.x=700;assert.equal(endpoint('n',414,'right'),1120)
node.dimensions.width=0;assert.equal(endpoint('n',414,'right'),380)
console.log('PASS: endpoints follow actual node bounds, resizing, movement and unmeasured fallback')

