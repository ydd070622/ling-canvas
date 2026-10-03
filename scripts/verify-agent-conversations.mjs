import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import { JSDOM } from 'jsdom'
const dom=new JSDOM('',{url:'http://localhost'})
globalThis.window=dom.window; globalThis.localStorage=dom.window.localStorage
window.$message={error:message => { throw new Error(message) }}
let stored
globalThis.indexedDB={ open() {
  const request={result:{createObjectStore(){},close(){},transaction(_store,mode){
    const tx={ objectStore(){ return { get(){ const req={}; setTimeout(() => {req.result=stored;req.onsuccess?.();tx.oncomplete?.()},0);return req },put(value){stored=structuredClone(value);setTimeout(() => tx.oncomplete?.(),0)} } } }; return tx
  }}}
  setTimeout(() => request.onsuccess?.(),0); return request
}}
globalThis.agentRequests=new Map(); globalThis.agentCancelled=[]; globalThis.agentTestInvoke=(command,args) => command==='agent_cancel' ? (agentCancelled.push(args.requestId), Promise.resolve()) : new Promise(resolve => agentRequests.set(args.requestId,{...args,resolve}));
const server=await createServer({server:{middlewareMode:true},appType:'custom',plugins:[{name:'mock-agent-cli',enforce:'pre',transform(code,id){if(id.endsWith('/src/stores/agent.js')) return code.replace("import { invoke, Channel } from '@tauri-apps/api/core'","const invoke=globalThis.agentTestInvoke; class Channel {}")}}]})
try {
  setActivePinia(createPinia())
  const {useAgentStore}=await server.ssrLoadModule('/src/stores/agent.js')
  const agent=useAgentStore()
  await new Promise(resolve => setTimeout(resolve,150))
  assert.equal(agent.historyReady,true)
  const first=agent.activeConversationId
  agent.messages.push({id:'message',role:'user',content:'第一篇文案'})
  agent.draft='第一段草稿'; agent.sessionStarted=true
  agent.newConversation(); const second=agent.activeConversationId
  assert.notEqual(first,second);assert.equal(agent.messages.length,0);assert.equal(agent.draft,'')
  agent.draft='第二段草稿'
  agent.switchConversation(first)
  assert.equal(agent.draft,'第一段草稿');assert.equal(agent.messages[0].content,'第一篇文案');assert.equal(agent.sessionStarted,true)
  agent.closeConversation(first)
  assert.equal(agent.activeConversationId,second);assert.equal(agent.draft,'第二段草稿')
  assert.equal(agent.historyConversations[0].id,first)
  agent.switchConversation(first);assert.equal(agent.openConversations.length,2)
  const runA=agent.send('问题A'); const requestA=[...agentRequests.values()].at(-1);
  agent.newConversation(); const third=agent.activeConversationId; assert.notEqual(third,first);
  const runB=agent.send('问题B'); const requestB=[...agentRequests.values()].at(-1);
  requestA.onEvent.onmessage({kind:'line',line:JSON.stringify({type:'result',result:'A的结果'})});
  assert.equal(agent.activeConversationId,third);assert.equal(agent.messages.at(-1).content,'');
  agent.switchConversation(first);assert.equal(agent.running,true);assert.equal(agent.messages.at(-1).content,'A的结果');
  agent.switchConversation(third);await agent.cancel();assert.deepEqual(agentCancelled,[requestB.requestId]);
  requestA.onEvent.onmessage({kind:'done'});requestA.resolve();await runA;
  assert.equal(agent.activeConversationId,third);assert.equal(agent.running,true);
  requestB.onEvent.onmessage({kind:'line',line:JSON.stringify({type:'result',result:'B的结果'})});requestB.onEvent.onmessage({kind:'done'});requestB.resolve();await runB;
  assert.equal(agent.messages.at(-1).content,'B的结果');agent.switchConversation(first);assert.equal(agent.messages.at(-1).content,'A的结果');
  await agent.persistHistory()
  const history=await server.ssrLoadModule('/src/stores/agentHistory.js')
  const saved=await history.loadAgentHistory()
  assert.equal(saved.conversations.find(chat => chat.id===first).messages[0].content,'第一篇文案')
  assert.equal(saved.conversations.find(chat => chat.id===second).draft,'第二段草稿')
  const restored=useAgentStore(createPinia());for (let i=0;i<100 && !restored.historyReady;i++) await new Promise(resolve => setTimeout(resolve,20))
  assert.equal(restored.activeConversationId,first);assert.equal(restored.messages[0].content,'第一篇文案');assert.equal(restored.sessionStarted,true)
  console.log('PASS: create, switch, right-click close, history reopen, draft isolation, running guards, storage and restart restoration.')
} finally { await server.close();dom.window.close() }
