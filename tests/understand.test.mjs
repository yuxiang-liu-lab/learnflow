import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildUnderstandRequest,parseUnderstandResponse,validateSelection,understandSelection} from '../background/understand.mjs';
import {readSelection,chooseSelection} from '../popup/selection.mjs';
const data = value => ({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('Understand validates bounded selection and gives each action a distinct task',()=>{
  const requests=['explain','simple','summarize'].map(action=>buildUnderstandRequest({action,text:'  Polyphony  '},'configured-model'));
  assert.equal(new Set(requests.map(x=>x.instructions)).size,3);
  for(const r of requests){assert.equal(r.model,'configured-model');assert.equal(r.store,false);assert.equal(r.text.format.strict,true);assert.deepEqual(JSON.parse(r.input),{selectedText:'Polyphony'});assert.match(r.instructions,/untrusted/);}
  for(const value of [null,{action:'other',text:'x'},{action:'__proto__',text:'x'},{action:'explain',text:''},{action:'simple',text:'x'.repeat(12001)}])assert.throws(()=>validateSelection(value),{code:'SELECTION_INVALID'});
});
test('Understand refuses malformed, ambiguous, empty, incomplete and refused output',()=>{
  assert.deepEqual(parseUnderstandResponse(data({response:' Clear explanation '})),{response:'Clear explanation'});
  for(const value of [{response:''},{response:1},{response:'x',extra:1},[],null])assert.throws(()=>parseUnderstandResponse(data(value)),{code:'RESPONSE_INVALID'});
  const multiple=data({response:'x'});multiple.output.push(multiple.output[0]);assert.throws(()=>parseUnderstandResponse(multiple),{code:'RESPONSE_INVALID'});
  assert.throws(()=>parseUnderstandResponse({status:'incomplete'}),{code:'RESPONSE_INCOMPLETE'});
  assert.throws(()=>parseUnderstandResponse({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]}),{code:'REFUSAL'});
});
test('Understand reuses fixed text endpoint, configured model and sanitized errors',async()=>{
  const config={apiKey:'sk-test-placeholder',model:'gpt-5.4-mini'},signal=new AbortController().signal;
  assert.deepEqual(await understandSelection({action:'simple',text:'Polyphony'},config,signal,async(url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.credentials,'omit');assert.equal(JSON.parse(init.body).model,config.model);assert.ok(!init.body.includes(config.apiKey));return {ok:true,json:async()=>data({response:'Several melodies together.'})};
  }),{response:'Several melodies together.'});
  await assert.rejects(understandSelection({action:'explain',text:'x'},config,signal,async()=>({ok:false,status:401})),{code:'HTTP_401'});
});
test('selection capture excludes editable fields and rejects empty, oversized or ambiguous frames',()=>{
  const oldDoc=globalThis.document,oldWindow=globalThis.window;
  try {globalThis.document={activeElement:{matches:()=>false}};globalThis.window={getSelection:()=> 'Selected passage'};assert.equal(readSelection(),'Selected passage');globalThis.document.activeElement.matches=()=>true;assert.equal(readSelection(),'');} finally {globalThis.document=oldDoc;globalThis.window=oldWindow;}
  assert.equal(chooseSelection([{result:''},{result:' passage '}]),'passage');
  for(const results of [[],[{result:'x'.repeat(12001)}],[{result:'a'},{result:'b'}]])assert.throws(()=>chooseSelection(results));
});
test('worker permits Understand only from popup; rejects duplicate calls and cancels on settings change',async()=>{
  const oldChrome=globalThis.chrome,oldFetch=globalThis.fetch;
  let listener,release,calls=0;
  const saved={apiKey:'sk-test-placeholder',model:'gpt-5.4-mini',audioModel:'gpt-audio'};
  globalThis.chrome={runtime:{id:'understand-test',getURL:p=>'chrome-extension://understand-test/'+p,getManifest:()=>({version:'0.6.1'}),onMessage:{addListener:fn=>listener=fn}},storage:{local:{setAccessLevel:async()=>{},get:async defaults=>({...defaults,...saved}),remove:async key=>delete saved[key]}}};
  globalThis.fetch=async()=>{calls++;await new Promise(resolve=>release=resolve);return {ok:true,json:async()=>data({response:'Explanation'})};};
  try {
    await import('../background/service-worker.js?understand-test');
    const popup={id:'understand-test',url:'chrome-extension://understand-test/popup/popup.html'};
    const send=(message,sender=popup)=>new Promise(resolve=>listener(message,sender,resolve));
    const message={type:'UA_ANALYZE',selection:{action:'explain',text:'A passage'}};
    assert.equal((await send(message,{...popup,url:'https://example.org',tab:{id:1}})).error.code,'SENDER_INVALID');
    assert.equal((await send({type:'QA_SAVE_CONFIG'})).error.code,'MESSAGE_INVALID');
    const first=send(message);await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await send(message)).error.code,'BUSY');assert.equal(calls,1);release();assert.equal((await first).response,'Explanation');
    const pending=send(message);await new Promise(resolve=>setImmediate(resolve));
    await send({type:'QA_CLEAR_KEY'},{...popup,url:'chrome-extension://understand-test/options/options.html'});release();assert.equal((await pending).error.code,'CANCELLED');
    assert.equal((await send(message)).error.code,'KEY_MISSING');assert.equal(calls,2);
  } finally {globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;}
});
test('popup captures without API calls, renders all actions as text and blocks double clicks',async()=>{
  const nodes=new Map();const node=()=>({textContent:'',hidden:false,disabled:true,dataset:{},handlers:{},addEventListener(event,fn){this.handlers[event]=fn;},setAttribute(){}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const buttons=['explain','simple','summarize'].map(action=>({...node(),dataset:{action},textContent:action}));
  let calls=0,release;const messages=[];
  const context={document:{getElementById:get,querySelectorAll:()=>buttons},readSelection,chooseSelection,chrome:{tabs:{query:async()=>[{id:1,url:'https://example.org'}]},scripting:{executeScript:async()=>[{result:'Polyphony'}]},runtime:{sendMessage:async message=>{messages.push(message);if(message.type==='QA_GET_CONFIG')return {ok:true,config:{model:'configured',hasKey:true}};calls++;await new Promise(resolve=>release=resolve);return {ok:true,response:'<b>Plain text</b>',model:'configured'};}}}};
  vm.runInNewContext(fs.readFileSync(new URL('../popup/popup.js',import.meta.url),'utf8').split('\n').slice(1).join('\n'),context);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);assert.equal(get('selection').textContent,'Polyphony');
  for(const button of buttons){const pending=button.handlers.click();await button.handlers.click();assert.equal(messages.filter(m=>m.type==='UA_ANALYZE').length,calls);release();await pending;assert.equal(get('result').textContent,'<b>Plain text</b>');assert.equal(button.disabled,false);}
  assert.deepEqual(messages.filter(m=>m.type==='UA_ANALYZE').map(m=>m.selection.action),['explain','simple','summarize']);
  get('practice-tab').handlers.click();assert.equal(get('understand').hidden,true);assert.equal(get('practice').hidden,false);
});
