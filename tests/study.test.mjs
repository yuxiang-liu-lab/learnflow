import test from 'node:test';
import assert from 'node:assert/strict';
import {emptySession,offerSelection,replaceContext,beginTurn,finishTurn,createSessionStore} from '../background/study-session.mjs';
import {createStudyWorkspace,installStudyMenus} from '../background/study-workspace.mjs';
import {understandConversation} from '../background/understand.mjs';
const source={sourceText:'A continuous function has an antiderivative.',pageTitle:'Calculus',pageUrl:'https://example.org/lesson?token=private#fragment',action:'explain'};
function memory(){const values={};return {values,get:async key=>structuredClone({[key]:values[key]}),set:async patch=>Object.assign(values,structuredClone(patch)),remove:async key=>delete values[key]};}
const selected=()=>replaceContext(offerSelection(emptySession(),source));
const config={apiKey:'sk-test-placeholder',model:'gpt-5.4-mini'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('session replacement is explicit, resets messages and strips URL query/fragment',()=>{
  const first=finishTurn(beginTurn(selected(),{action:'explain'}),{response:'An explanation',model:'text'});
  const offered=offerSelection(first,{...source,sourceText:'New passage'});
  assert.equal(offered.messages.length,2);assert.equal(offered.source.sourceText,source.sourceText);
  assert.equal(offered.source.pageUrl,'https://example.org/lesson');
  const next=replaceContext(offered);assert.equal(next.source.sourceText,'New passage');assert.equal(next.messages.length,0);assert.notEqual(next.id,first.id);
  assert.throws(()=>replaceContext({...offered,busy:true}),{code:'STUDY_INVALID'});
});
test('session limits reject empty follow-ups and prevent unbounded histories',()=>{
  assert.throws(()=>beginTurn(selected(),{question:'Why?'}),{code:'STUDY_INVALID'});
  const first=finishTurn(beginTurn(selected(),{action:'simple'}),{response:'Explanation',model:'text'});
  for(const question of ['', 'x'.repeat(2001)])assert.throws(()=>beginTurn(first,{question}),{code:'STUDY_INVALID'});
  assert.throws(()=>beginTurn({...first,messages:Array(20).fill({content:'x'})},{question:'Why?'}),{code:'STUDY_INVALID'});
  assert.equal(beginTurn(first,{question:'Why?'}).source.action,'simple');
});
test('follow-up API request contains original selection, all previous turns and current question, not page metadata',async()=>{
  const first=finishTurn(beginTurn(selected(),{action:'explain'}),{response:'Previous explanation',model:'text'});
  const session=beginTurn(first,{question:'Can you give me an example?'});
  const result=await understandConversation(session,config,new AbortController().signal,async(url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body),input=JSON.parse(body.input);
    assert.equal(input.selectedText,source.sourceText);assert.deepEqual(input.messages,first.messages);assert.equal(input.currentQuestion,'Can you give me an example?');assert.equal(body.store,false);assert.ok(!init.body.includes('example.org'));assert.ok(!init.body.includes(config.apiKey));
    return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({response:'A useful example'})}]}]})};
  });assert.equal(result.response,'A useful example');
});
test('session store serializes edits, isolates windows and survives worker recreation',async()=>{
  const storage=memory(),store=createSessionStore(storage);
  await Promise.all([store.update(1,s=>offerSelection(s,source)),store.update(1,replaceContext)]);
  const restored=await createSessionStore(storage).update(1,s=>s);assert.equal(restored.source.sourceText,source.sourceText);
  assert.equal((await store.update(2,s=>s)).source,null);await store.remove(1);assert.equal(storage.values['study:1'],undefined);
});
test('offer/get/dismiss never analyze; explicit run uses shared pipeline and records turns',async()=>{
  let calls=0;const workspace=createStudyWorkspace({storage:memory(),getConfig:async()=>config,analyze:async()=>{calls++;return {response:'Explanation'};}});
  const send=(type,rest={})=>workspace.handle({type,windowId:1,...rest});
  await send('STUDY_OFFER',{source});await send('STUDY_GET');assert.equal(calls,0);
  await send('STUDY_REPLACE');assert.equal(calls,0);
  const {state}=await send('STUDY_RUN',{action:'explain'});assert.equal(state.messages.length,2);assert.equal(calls,1);
  await send('STUDY_OFFER',{source:{...source,sourceText:'New'}});await send('STUDY_DISMISS');assert.equal((await send('STUDY_GET')).state.source.sourceText,source.sourceText);assert.equal(calls,1);
});
test('busy requests cannot duplicate or replace active context; late results after cancellation are rejected',async()=>{
  let release;const workspace=createStudyWorkspace({storage:memory(),getConfig:async()=>config,analyze:async()=>{await new Promise(resolve=>release=resolve);return {response:'Late answer'};}});
  const send=(type,rest={})=>workspace.handle({type,windowId:1,...rest});
  await send('STUDY_OFFER',{source});await send('STUDY_REPLACE');
  const pending=send('STUDY_RUN',{action:'explain'});await flush();
  await assert.rejects(send('STUDY_RUN',{action:'simple'}),{code:'BUSY'});
  await send('STUDY_OFFER',{source:{...source,sourceText:'Another'}});await assert.rejects(send('STUDY_REPLACE'),{code:'STUDY_INVALID'});
  workspace.cancel();release();await assert.rejects(pending,{code:'CANCELLED'});
  const {state}=await send('STUDY_GET');assert.equal(state.messages.length,0);assert.equal(state.busy,false);assert.match(state.error,/cancelled/);assert.equal(state.pending.sourceText,'Another');
});
test('worker restart recovers interrupted session, and missing-key errors preserve source',async()=>{
  const storage=memory();await storage.set({'study:1':beginTurn(selected(),{action:'explain'})});
  const workspace=createStudyWorkspace({storage,getConfig:async()=>({apiKey:''})});
  let {state}=await workspace.handle({type:'STUDY_GET',windowId:1});assert.equal(state.busy,false);assert.match(state.error,/interrupted/);
  await assert.rejects(workspace.handle({type:'STUDY_RUN',windowId:1,action:'explain'}),{code:'KEY_MISSING'});
  ({state}=await workspace.handle({type:'STUDY_GET',windowId:1}));assert.equal(state.source.sourceText,source.sourceText);assert.equal(state.messages.length,0);
});
test('context menus open panel from gesture, route all actions and preserve existing conversation',async()=>{
  let installed,clicked;const menus=[],events=[];let hasSource=false;
  const api={runtime:{onInstalled:{addListener:fn=>installed=fn}},contextMenus:{removeAll:fn=>fn(),create:menu=>menus.push(menu),onClicked:{addListener:fn=>clicked=fn}},sidePanel:{open:async()=>events.push('open')}};
  const workspace={handle:async message=>{events.push(message.type+':'+(message.action||message.source?.action||''));return {state:{source:hasSource?source:null}};}};
  installStudyMenus(api,workspace);installed();assert.equal(menus.length,4);
  for(const action of ['explain','simple','summarize']){events.length=0;clicked({menuItemId:'study-'+action,selectionText:'Selected',pageUrl:'https://example.org'},{windowId:1});assert.equal(events[0],'open');await flush();assert.deepEqual(events,['open','STUDY_OFFER:'+action,'STUDY_REPLACE:','STUDY_RUN:'+action]);}
  hasSource=true;events.length=0;clicked({menuItemId:'study-simple',selectionText:'New'},{windowId:1});await flush();assert.deepEqual(events,['open','STUDY_OFFER:simple']);
  events.length=0;clicked({menuItemId:'study-explain',selectionText:'Secret',editable:true},{windowId:1});assert.equal(events.length,0);
});

test('actual worker authorizes exact Side Panel URL and rejects page study messages',async()=>{
  const oldChrome=globalThis.chrome;let listener;const storage=memory();
  globalThis.chrome={runtime:{id:'study-test',getURL:p=>'chrome-extension://study-test/'+p,onMessage:{addListener:fn=>listener=fn},sendMessage:async()=>{}},storage:{session:storage,local:{setAccessLevel:async()=>{},get:async defaults=>({...defaults,...config})}}};
  try{
    await import('../background/service-worker.js?study-panel-routing');
    const panel={id:'study-test',url:'chrome-extension://study-test/sidepanel/panel.html'};
    const send=(message,sender=panel)=>new Promise(resolve=>listener(message,sender,resolve));
    assert.equal((await send({type:'STUDY_OFFER',windowId:1,source})).ok,true);
    assert.equal((await send({type:'STUDY_GET',windowId:1})).state.pending.sourceText,source.sourceText);
    assert.equal((await send({type:'STUDY_GET',windowId:1},{...panel,url:'https://example.org'})).error.code,'SENDER_INVALID');
    assert.equal((await send({type:'STUDY_GET',windowId:1},{...panel,id:'other'})).error.code,'SENDER_INVALID');
    assert.equal((await send({type:'STUDY_GET',windowId:-1})).error.code,'STUDY_INVALID');
    assert.equal((await send({type:'QA_SAVE_CONFIG'})).error.code,'MESSAGE_INVALID');
    const publicConfig=await send({type:'QA_GET_CONFIG'});assert.ok(!JSON.stringify(publicConfig).includes(config.apiKey));
  }finally{globalThis.chrome=oldChrome;}
});
test('closing a window during an API request does not recreate its session',async()=>{
  const storage=memory();let release;const workspace=createStudyWorkspace({storage,getConfig:async()=>config,analyze:async()=>{await new Promise(resolve=>release=resolve);return {response:'Late'};}});
  await workspace.handle({type:'STUDY_OFFER',windowId:1,source});await workspace.handle({type:'STUDY_REPLACE',windowId:1});
  const pending=workspace.handle({type:'STUDY_RUN',windowId:1,action:'explain'});await flush();await workspace.remove(1);release();await assert.rejects(pending,{code:'CANCELLED'});assert.equal(storage.values['study:1'],undefined);
});

test('Side Panel renders conversation safely, submits follow-ups, copies responses and keeps transport errors visible',async()=>{
  const fs=await import('node:fs'),vm=await import('node:vm');
  const nodes=new Map();const node=()=>({textContent:'',value:'',hidden:false,disabled:false,children:[],handlers:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(name,fn){this.handlers[name]=fn;}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const buttons=['explain','simple','summarize'].map(action=>({...node(),dataset:{action}}));
  const workspace=createStudyWorkspace({storage:memory(),getConfig:async()=>config,analyze:async()=>({response:'<b>Plain text explanation</b>'})});
  await workspace.handle({type:'STUDY_OFFER',windowId:1,source});await workspace.handle({type:'STUDY_REPLACE',windowId:1});await workspace.handle({type:'STUDY_RUN',windowId:1,action:'explain'});
  let copied='',offline=false;const sent=[];
  const context={document:{getElementById:get,querySelectorAll:()=>buttons,createElement:()=>node()},navigator:{clipboard:{writeText:async text=>copied=text}},chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async message=>{sent.push(message);if(offline)throw Error('Worker disconnected');try{return {ok:true,...await workspace.handle(message)};}catch(error){return {ok:false,error:{message:error.message}};}}},windows:{getCurrent:async()=>({id:1})}},readSelection(){},chooseSelection(){}};
  vm.runInNewContext(fs.readFileSync(new URL('../sidepanel/panel.js',import.meta.url),'utf8').split('\n').slice(1).join('\n'),context);await flush();
  assert.equal(get('context').textContent,source.sourceText);assert.equal(get('conversation').children.length,2);
  const card=get('conversation').children[1];assert.equal(card.children[1].textContent,'<b>Plain text explanation</b>');await card.children[2].handlers.click();assert.equal(copied,'<b>Plain text explanation</b>');
  get('question').value='Why?';await get('followup').handlers.submit({preventDefault(){}});assert.equal(get('conversation').children.length,4);assert.equal(get('question').value,'');assert.equal(sent.find(m=>m.question).question,'Why?');
  let keyboardSubmit=false;get('followup').requestSubmit=()=>keyboardSubmit=true;get('question').handlers.keydown({key:'Enter',ctrlKey:true,preventDefault(){}});assert.equal(keyboardSubmit,true);
  offline=true;await buttons[0].handlers.click();assert.equal(get('status').textContent,'Worker disconnected');assert.equal(buttons[0].disabled,false);
});
