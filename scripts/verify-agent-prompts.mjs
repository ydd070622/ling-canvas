import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parseAgentPrompts,agentPromptRatio} from '../src/utils/agentPrompts.js'
assert.equal(agentPromptRatio({title:'客厅 | 3:4 竖向全景'}),'3:4')
assert.equal(agentPromptRatio({prompt:'3：2 横幅'}),'3:2')
assert.equal(agentPromptRatio({ratio:'1:1',title:'3:4'}),'1:1')
assert.equal(agentPromptRatio({prompt:'相机高度1.2米，16:25拍摄'}),null)
const payload=[{title:'客厅',group:'A组',prompt:'完整提示词\n参考图片1至图片7'}]
const parsed=parseAgentPrompts('已整理\n```canvas-prompts\n'+JSON.stringify(payload)+'\n```')
assert.equal(parsed.text,'已整理');assert.deepEqual(parsed.prompts,payload)
assert.equal(parseAgentPrompts('```canvas-prompts\n[{"prompt":""}]\n```').prompts.length,0)
const source=fs.readFileSync(new URL('../src/stores/agent.js',import.meta.url),'utf8').replace(/\r/g,'')
const body=source.split('  const sendPromptsToCanvas = (message, indices) => {')[1].split('\n  return {')[0].replace(/\n  }\s*$/,'')
const nodes={value:Array.from({length:7},(_,index)=>({id:'ref'+index,type:'image',position:{x:index%2*320,y:Math.floor(index/2)*350}}))}
const edges=[],selected={value:[]};let counter=0,batches=0
const send=new Function('nodes','currentProject','addNode','addEdge','startBatchOperation','endBatchOperation','selectedNodeIds','persistHistory','agentPromptRatio','updateNode',`return (message,indices)=>{${body}}`)(nodes,{value:{id:'project'}},(type,position,data)=>{const id='new'+counter++;nodes.value.push({id,type,position,data});return id},edge=>edges.push(edge),()=>batches++,()=>batches--,selected,()=>{},agentPromptRatio,(id,data)=>Object.assign(nodes.value.find(node=>node.id===id).data,data))
const message={projectId:'project',referenceNodeIds:nodes.value.map(node=>node.id),prompts:parsed.prompts}
const ids=send(message,[0]);assert.equal(edges.length,7);assert.equal(nodes.value.at(-1).type,'image');assert.equal(nodes.value.at(-1).data.prompt,payload[0].prompt);assert.deepEqual(selected.value,ids)
assert.deepEqual(send(message,[0]),ids);assert.equal(edges.length,7);assert.equal(batches,0)
message.prompts[0].title='客厅 3:4';send(message,[0]);assert.equal(nodes.value.at(-1).data.ratio,'3:4')
assert.throws(()=>send({...message,projectId:'other'},[0]),/画布/)
nodes.value.shift();assert.throws(()=>send(message,[0]),/参考图/)
console.log('PASS: prompt extraction, seven references, existing image node, duplicate prevention and project isolation')
