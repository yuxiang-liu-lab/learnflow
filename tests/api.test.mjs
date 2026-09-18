import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuestion, buildRequest, parseResponse, analyzeQuestion, DEFAULT_MODEL} from '../background/openai.mjs';

const question = validateQuestion({id:'synthetic-text-item_question', question:'Which structure connects parent and child nodes?', choices:['A sequence.', 'A tree.', 'A counter.', 'A scalar.', 'A flag.'].map((text,i)=>({answer:String.fromCharCode(65+i),text}))});
const suggestion = {answer:'B',answerText:'A tree.',explanation:'A tree connects parent and child nodes.',confidence:0.96};
const responseData = value => ({status:'completed', output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});

test('request includes prompt and every choice, strict schema, no stored response', () => {
  const request = buildRequest(question, DEFAULT_MODEL);
  assert.deepEqual(JSON.parse(request.input), {question:question.question,choices:question.choices});
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.equal(request.store, false);
  assert.equal(request.tools, undefined);
});
test('ordinary text questions are accepted; explicit missing listening media fails closed', () => {
  const text=validateQuestion({...question,id:'new-id',question:'Synthetic tree structures',audioStatus:'none'});
  assert.equal(text.question,'Synthetic tree structures');assert.equal(text.audio,undefined);
  assert.throws(()=>validateQuestion({...question,audioStatus:'required'}),{code:'AUDIO_UNAVAILABLE'});
});
test('valid structured answer is accepted and canonical choice text is returned', () => {
  assert.deepEqual(parseResponse(responseData(suggestion),question),suggestion);
});
test('invalid letter, mismatched text, invalid confidence and extra fields fail closed', () => {
  for (const patch of [{answer:'Z'},{answerText:'A sequence.'},{confidence:1.1},{confidence:'0.9'},{explanation:''},{extra:true}]) {
    assert.throws(() => parseResponse(responseData({...suggestion,...patch}), question), {code:'RESPONSE_INVALID'});
  }
});
test('refusal, incomplete response, malformed JSON and no output never become answers', () => {
  assert.throws(() => parseResponse({status:'incomplete'},question), {code:'RESPONSE_INCOMPLETE'});
  assert.throws(() => parseResponse({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]},question), {code:'REFUSAL'});
  assert.throws(() => parseResponse({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not JSON'}]}]},question), {code:'RESPONSE_INVALID'});
  assert.throws(() => parseResponse({status:'completed',output:[]},question), {code:'RESPONSE_INVALID'});
});
test('API request uses fixed OpenAI endpoint and authorization header; raw errors are suppressed', async () => {
  const config = {apiKey:'sk-test-placeholder',model:DEFAULT_MODEL};
  const signal = new AbortController().signal;
  const result = await analyzeQuestion(question,config,signal,async (url, init) => {
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization,`Bearer ${config.apiKey}`);
    assert.equal(init.redirect,'error');
    assert.equal(init.credentials,'omit');
    assert.ok(!init.body.includes(config.apiKey));
    return {ok:true,json:async()=>responseData(suggestion)};
  });
  assert.deepEqual(result,suggestion);
  await assert.rejects(analyzeQuestion(question,config,signal,async()=>({ok:false,status:401,json:async()=>({error:{message:config.apiKey}})})), error => error.code==='HTTP_401' && !error.message.includes(config.apiKey));
});
test('aborted fetch gives a safe retryable error', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(analyzeQuestion(question,{apiKey:'placeholder'},controller.signal,async()=>{throw Error('raw error');}), {code:'CANCELLED'});
});

test('service worker security, key lifecycle, duplicate suppression, cache and manual retry', async () => {
  const saved = {};
  let listener, calls=0, release;
  const held = new Promise(resolve=>{release=resolve;});
  let access;
  globalThis.chrome = {
    runtime:{id:'test-extension',getManifest:()=>({version:'0.6.1'}),getURL:path=>`chrome-extension://test-extension/${path}`,openOptionsPage:async()=>{},onMessage:{addListener:fn=>{listener=fn;}}},
    action:{onClicked:{addListener:()=>{}}},
    storage:{local:{
      setAccessLevel:async value=>{access=value.accessLevel;},
      get:async defaults=>({...defaults,...saved}),set:async values=>Object.assign(saved,values),remove:async key=>{delete saved[key];}
    }}
  };
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;await held;return {ok:true,json:async()=>responseData(suggestion)};};
  try {
    await import('../background/service-worker.js');
    const options={id:'test-extension',url:'chrome-extension://test-extension/options/options.html'};
    const quiz={id:'test-extension',url:'https://cnow.apps.ng.cengage.com/ilrn/takeAssignment/takeAssignmentMain.do',tab:{id:1},frameId:2,documentId:'doc'};
    const send=(message,sender=quiz)=>new Promise(resolve=>listener({clientVersion:'0.6.1',...message},sender,resolve));
    assert.equal((await send({type:'QA_HELLO',clientVersion:'0.3.1'})).error.code,'CONTEXT_STALE');
    assert.deepEqual(await send({type:'QA_HELLO'}),{ok:true,version:'0.6.1',frameId:2,origin:'https://cnow.apps.ng.cengage.com'});
    assert.equal(access,'TRUSTED_CONTEXTS');
    const message={type:'QA_ANALYZE',question,requestId:'test-1'};
    assert.equal((await send(message)).error.code,'KEY_MISSING');
    assert.equal(calls,0);
    assert.equal((await send({type:'QA_SAVE_CONFIG',apiKey:'sk-test-placeholder',model:DEFAULT_MODEL})).error.code,'MESSAGE_INVALID');
    const result=await send({type:'QA_SAVE_CONFIG',apiKey:'sk-test-placeholder',model:DEFAULT_MODEL},options);
    assert.deepEqual(result.config,{hasKey:true,model:DEFAULT_MODEL,audioModel:"gpt-audio"});
    assert.ok(!JSON.stringify(result).includes('sk-test-placeholder'));
    assert.equal((await send({type:'QA_GET_POSITION'})).position,null);
    assert.equal((await send({type:'QA_SAVE_POSITION',position:{x:120,y:80,apiKey:'ignore'}})).ok,true);
    const layout=await send({type:'QA_GET_POSITION'});
    assert.deepEqual(layout,{ok:true,position:{x:120,y:80}});
    assert.equal(saved.apiKey,'sk-test-placeholder');
    for (const position of [{x:-1,y:1},{x:Infinity,y:0},{x:'12',y:0},null]) {
      assert.equal((await send({type:'QA_SAVE_POSITION',position})).error.code,'POSITION_INVALID');
    }
    assert.equal((await send({type:'QA_GET_POSITION'},{...quiz,url:'https://example.com/'})).error.code,'SENDER_INVALID');
    assert.equal((await send({type:'QA_GET_CONFIG'})).ok,false);
    assert.equal((await send(message,{...quiz,url:'https://example.com/'})).error.code,'SENDER_INVALID');
    assert.equal((await send({...message,question:{...question,audioStatus:'required'}})).error.code,'AUDIO_UNAVAILABLE');
    const first=send(message); const duplicate=send({...message,requestId:'test-2'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,1); release();
    assert.deepEqual((await first).suggestion,suggestion);
    assert.deepEqual((await duplicate).suggestion,suggestion);
    assert.equal((await send(message)).ok,true); assert.equal(calls,1);
    assert.equal((await send({...message,force:true})).ok,true); assert.equal(calls,2);
    await send({type:'QA_SAVE_CONFIG',apiKey:'',model:DEFAULT_MODEL},options);
    assert.equal(saved.apiKey,'sk-test-placeholder');
    await send({type:'QA_SAVE_CONFIG',model:DEFAULT_MODEL,audioModel:'gpt-audio'},options);
    assert.equal(saved.model,DEFAULT_MODEL);
    const audioQuestion={...question,audio:{kind:'native-mp3',url:'https://cnow.apps.ng.cengage.com/ilrn/books/hb1ml06h/synthetic_clip_a.mp3'}};
    const mp3=new Uint8Array(256);mp3.set([73,68,51]);
    let audioCalls=0,finishAudio;
    const audioHeld=new Promise(resolve=>{finishAudio=resolve;});
    globalThis.fetch=async(url,init)=>{
      audioCalls++;
      if(url===audioQuestion.audio.url)return new Response(mp3);
      assert.equal(url,'https://api.openai.com/v1/chat/completions');
      assert.equal(JSON.parse(init.body).model,'gpt-audio');
      await audioHeld;
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...suggestion,audibleEvidence:['Mock audible evidence']})}}]}));
    };
    const audioFirst=send({...message,question:audioQuestion,requestId:'audio-1'});
    const audioDuplicate=send({...message,question:audioQuestion,requestId:'audio-2'});
    await new Promise(resolve=>setTimeout(resolve,20));finishAudio();
    const audioResult=await audioFirst;
    assert.equal(audioResult.ok,true);assert.equal(audioResult.audio.url,audioQuestion.audio.url);
    assert.equal(audioResult.model,'gpt-audio');
    assert.deepEqual(await audioDuplicate,audioResult);assert.equal(audioCalls,2);
    const badAudio=await send({...message,question:{...audioQuestion,audio:{kind:'unsupported',url:null}}});
    assert.equal(badAudio.error.code,'AUDIO_UNAVAILABLE');assert.equal(audioCalls,2);
    const comparisonConfig=await send({type:'QA_SAVE_CONFIG',model:DEFAULT_MODEL,audioModel:'gpt-audio-1.5'},options);
    assert.equal(comparisonConfig.config.audioModel,'gpt-audio-1.5');
    assert.equal(comparisonConfig.config.model,DEFAULT_MODEL);assert.equal(saved.apiKey,'sk-test-placeholder');
    await send({type:'QA_CLEAR_KEY'},options);
    assert.equal(saved.apiKey,undefined);
    assert.equal((await send(message)).error.code,'KEY_MISSING');
  } finally {globalThis.fetch=oldFetch; delete globalThis.chrome;}
});
