import assert from 'node:assert/strict'
import fs from 'node:fs'
import {computed,ref,reactive} from 'vue'
const source=fs.readFileSync('src/views/Canvas.vue','utf8')
const body=source.split('const agentDisplayWidth = computed(() => {')[1].split('\n})')[0]
const agent=reactive({panelOpen:true,panelWidth:520}),visible=ref(false),width=ref(1400)
// Evaluate the real computed body on each state change.
const get=new Function('agent','composerVisible','canvasWindowWidth',body)
assert.equal(get(agent,visible,width),520)
visible.value=true;assert.equal(get(agent,visible,width),330);assert.equal(agent.panelWidth,520)
width.value=2000;assert.equal(get(agent,visible,width),520)
visible.value=false;assert.equal(get(agent,visible,width),520)
const panel=fs.readFileSync('src/components/agent/AgentPanel.vue','utf8')
const handler=panel.split('const sendPromptCards = (message,indices) => {')[1].split('\nconst messageNodeIds')[0].replace(/\r/g,'').replace(/\n}\s*$/,'')
let focused=0
const send=new Function('agent','nodes','emit',`return (message,indices)=>{${handler}}`)({sendPromptsToCanvas:()=>['new']},{value:[{id:'old'}]},()=>focused++)
send({prompts:[{}]},[0]);assert.equal(focused,0)
send({prompts:[{nodeId:'old'}]},[0]);assert.equal(focused,1)
send({prompts:[{nodeId:'old'},{}]},[0,1]);assert.equal(focused,1)
console.log('PASS: temporary width, restoration, wide window, send without focus and explicit locate')

