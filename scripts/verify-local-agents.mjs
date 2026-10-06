import fs from 'node:fs'
import assert from 'node:assert/strict'
import { codexErrorText } from '../src/utils/codexError.js'
const source=fs.readFileSync(new URL('../src/stores/agent.js',import.meta.url),'utf8').replace(/\r/g,'')
const body=source.split('  const handleCodexLine = line => {')[1].split('\n  const handleEvent =')[0].replace(/\n  }\s*$/, '')
const messages={value:[{role:'assistant',content:''}]}, approvals={value:[]}, results=[]
let status=''
const decode=new Function('messages','approvalRequests','setStatus','handleLine','clearStatus','codexErrorText',`return line => {${body}}`)(messages,approvals,s=>status=s,line=>results.push(JSON.parse(line)),()=>status='',codexErrorText)
const event=(method,params)=>decode(JSON.stringify({method,params}))
event('item/agentMessage/delta',{delta:'你好'})
event('item/agentMessage/delta',{delta:'，画布'})
assert.equal(messages.value[0].content,'你好，画布')
event('turn/completed',{turn:{status:'completed'}})
assert.equal(results.at(-1).result,'你好，画布')
const count=results.length
event('turn/completed',{turn:{status:'interrupted'}})
assert.equal(results.length,count,'cancelled partial reply must not execute canvas actions')
decode(JSON.stringify({type:'codex_request',rpcId:8,requestId:'request',method:'item/commandExecution/requestApproval',params:{command:'test'}}))
assert.equal(approvals.value.length,1)
event('serverRequest/resolved',{requestId:8})
assert.equal(approvals.value.length,0)
event('turn/completed',{turn:{status:'failed',error:{message:'model not available'}}})
assert.equal(results.at(-1).is_error,true)
assert.equal(results.at(-1).result,'model not available')
const enableBody=source.split('  const enableProvider = provider => {')[1].split('\n  const handleCodexLine')[0].replace(/\n  }\s*$/,'')
const settings={active:'claude'}, running={value:false}, ready={value:true}
let newChats=0
const enable=new Function('anyRunning','historyReady','agentSettings','saveAgentSettings','newConversation',`return provider=>{${enableBody}}`)(running,ready,settings,()=>{},()=>newChats++)
enable('codex');assert.equal(settings.active,'codex');assert.equal(newChats,1)
enable('codex');assert.equal(newChats,1,'same provider preserves conversation')
running.value=true;assert.throws(()=>enable('claude'));assert.equal(settings.active,'codex')
console.log('PASS: provider exclusivity, stream, approvals, failure and cancellation events')

assert.ok(codexErrorText(JSON.stringify({error:{message:"The model is not supported"}})).startsWith("当前账户不支持"))
