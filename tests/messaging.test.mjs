import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const scope=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../content/messaging.js',import.meta.url),'utf8'),scope);
const create=scope.qaCreateMessaging;
test('missing runtime fails asynchronously with explicit lifecycle notification',async()=>{
  let notices=0;
  const transport=create(()=>notices++,()=>undefined);
  const request=transport.send({type:'QA_HELLO'});
  await assert.rejects(request,{code:'CONTEXT_UNAVAILABLE'});
  await assert.rejects(transport.send({type:'QA_ANALYZE'}),{code:'CONTEXT_UNAVAILABLE'});
  assert.equal(notices,1);
});
test('synchronous invalidation throw is classified and permanently stops old transport',async()=>{
  let notices=0,calls=0;
  const transport=create(()=>notices++,()=>({id:'id',sendMessage(){calls++;throw Error('Extension context invalidated.');}}));
  await assert.rejects(transport.send({}),{code:'CONTEXT_UNAVAILABLE'});
  await assert.rejects(transport.send({}),{code:'CONTEXT_UNAVAILABLE'});
  assert.equal(notices,1);assert.equal(calls,1);
});
test('in-flight reply is rejected if the isolated extension world disappeared',async()=>{
  let resolve,notices=0;
  let runtime={id:'id',sendMessage:()=>new Promise(done=>resolve=done)};
  const transport=create(()=>notices++,()=>runtime);
  const request=transport.send({});runtime=undefined;resolve({ok:true});
  await assert.rejects(request,{code:'CONTEXT_UNAVAILABLE'});assert.equal(notices,1);
});
test('temporary worker failure remains retryable',async()=>{
  let calls=0;
  const transport=create(()=>assert.fail('Must not invalidate'),()=>({id:'id',sendMessage:async()=>{if(!calls++)throw Error('Could not establish connection. Receiving end does not exist.');return {ok:true};}}));
  await assert.rejects(transport.send({}));assert.equal((await transport.send({})).ok,true);
});
test('load, analyze, invalidate, recreate content context, handshake and analyze',async()=>{
  let runtime={id:'id',sendMessage:async message=>({ok:true,type:message.type,version:message.clientVersion})};
  const old=create(()=>{},()=>runtime);
  assert.equal((await old.send({type:'QA_HELLO'})).version,'0.6.1');
  assert.equal((await old.send({type:'QA_ANALYZE'})).ok,true);
  runtime=undefined;assert.equal(old.check(),false);
  runtime={id:'id',sendMessage:async()=>({ok:true})};
  await assert.rejects(old.send({}),{code:'CONTEXT_UNAVAILABLE'});
  const fresh=create(()=>assert.fail('Fresh context should work'),()=>runtime);
  assert.equal((await fresh.send({type:'QA_HELLO'})).ok,true);
  assert.equal((await fresh.send({type:'QA_ANALYZE'})).ok,true);
});
test('version mismatch marks old script as unusable',async()=>{
  let notices=0;
  const transport=create(()=>notices++,()=>({id:'id',sendMessage:async()=>({ok:false,error:{code:'CONTEXT_STALE'}})}));
  await assert.rejects(transport.send({}),{code:'CONTEXT_UNAVAILABLE'});assert.equal(notices,1);
});
