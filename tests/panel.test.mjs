import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../content/content.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness() {
  const nodes=new Map();
  const node=()=>({textContent:'',hidden:false,disabled:false,style:{},classList:{toggle(){}},addEventListener(){},setAttribute(){},append(){},replaceChildren(){}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const shadow={getElementById:get,querySelector:()=>node()};
  const host={...node(),attachShadow:()=>shadow,contains:()=>false};
  let observed,timer,question;
  const requests=[];
  const mediaHandlers={}; const player={addEventListener:(event,handler)=>{mediaHandlers[event]=handler;}};
  const scope={console:{info(){},warn(){}},crypto:{randomUUID:()=>String(requests.length)},QA_BUILD_VERSION:'0.6.1',
    document:{createElement:tag=>tag==='div'?host:node(),documentElement:{append(){}},body:{}},
    window:{addEventListener(){}},
    setInterval:()=>1,clearInterval(){},clearTimeout(){},setTimeout:(fn,ms)=>{if(ms===200)timer=fn;return 1;},
    MutationObserver:class {constructor(fn){observed=fn;}observe(){}disconnect(){}},
    qaEnableDragging:()=>({hasPreferredPosition:()=>true,reclamp(){}}),
    qaReadQuestion:()=>question,
    qaCreateMessaging:()=>({check:()=>true,send:message=>{
      if(message.type==='QA_HELLO')return Promise.resolve({ok:true,version:'0.6.1',frameId:7});
      if(message.type==='QA_ANALYZE')return new Promise(resolve=>requests.push({message,resolve}));
      return Promise.resolve({ok:true});
    }})};
  const set=clip=>{const data={id:'question',question:'Listen',choices:[{answer:'A',text:'first'},{answer:'B',text:'second'}],audio:{kind:'native-mp3',url:`https://cnow.apps.ng.cengage.com/ilrn/books/hb1ml06h/${clip}.mp3`}};question={ok:true,data,fingerprint:JSON.stringify(data),players:[player],audioDiagnostics:{src:data.audio.url,currentSrc:data.audio.url,readyState:4,networkState:1,duration:12.5},elements:[]};};
  set('first');vm.runInNewContext(source,scope);
  const reply=(index,url=requests[index].message.question.audio.url)=>requests[index].resolve({ok:true,model:'gpt-audio',suggestion:{answer:'B',answerText:'second',explanation:'Audible entry order',confidence:0.8},audibleEvidence:['Three audible entries'],diagnostics:{resolvedMediaURL:url,failureStage:null},audio:{url,byteLength:256,sha256:'a'.repeat(64)}});
  return {get,requests,set,reply,setSources(sources){const data={...question.data,audioSources:sources};question={...question,data,fingerprint:JSON.stringify(data)};},media:event=>mediaHandlers[event](),mutate(){observed([{target:{}}]);},scan(){timer?.();}};
}
test('panel renders audio answer/evidence/source and ignores irrelevant DOM mutations',async()=>{
  const h=harness();await flush();assert.equal(h.requests.length,1);
  h.mutate();h.scan();await flush();assert.equal(h.requests.length,1);
  h.reply(0);await flush();
  assert.equal(h.get('status').textContent,'Ready');assert.equal(h.get('result').hidden,false);
  assert.equal(h.get('answer').textContent,'B');assert.equal(h.get('explanation').textContent,'Audible entry order');assert.equal(h.get('confidence').textContent,'80%');
  assert.match(h.get('audio-source').textContent,/first\.mp3/);
  h.mutate();h.scan();await flush();assert.equal(h.requests.length,1);
});
test('audio-only change clears results immediately and discards late old-clip answers',async()=>{
  const h=harness();await flush();h.set('second');h.mutate();
  assert.equal(h.get('result').hidden,true);h.scan();await flush();assert.equal(h.requests.length,2);
  h.reply(0);await flush();assert.equal(h.get('result').hidden,true);
  h.reply(1);await flush();assert.equal(h.get('status').textContent,'Ready');assert.match(h.get('audio-source').textContent,/second\.mp3/);
});
test('panel rejects a worker result for another MP3',async()=>{
  const h=harness();await flush();h.reply(0,'https://example.com/wrong.mp3');await flush();
  assert.equal(h.get('result').hidden,true);assert.match(h.get('status').textContent,/Audio unavailable/);
});

test('audio debug is optional and abstention does not display an answer',async()=>{
  const h=harness();await flush();
  h.reply(0);await flush();assert.equal(h.get('audio-debug').hidden,false);assert.equal(h.get('audio-debug').open,false);
  assert.match(h.get('audio-evidence').textContent,/audibleEvidence/);
  h.set('second');h.mutate();h.scan();await flush();
  h.requests[1].resolve({ok:false,error:{code:'insufficient_audio_evidence',message:'insufficient_audio_evidence — cannot distinguish choices'}});await flush();
  assert.equal(h.get('result').hidden,true);assert.equal(h.get('audio-debug').hidden,false);
  assert.equal(h.get('answer').textContent,'');assert.match(h.get('status').textContent,/insufficient_audio_evidence/);
});

test('metadata/canplay/play update diagnostics without duplicate analysis; new clip invalidates',async()=>{
  const h=harness();await flush();h.reply(0);await flush();
  for(const event of ['loadedmetadata','canplay','play']) h.media(event);
  await flush();assert.equal(h.requests.length,1);assert.equal(h.get('result').hidden,false);
  const diagnostic=JSON.parse(h.get('audio-diagnostics').textContent);
  assert.equal(diagnostic.duration,12.5);assert.equal(diagnostic.networkState,1);
  assert.deepEqual(diagnostic.mediaEvents.slice(-3).map(e=>e.event),['loadedmetadata','canplay','play']);
  h.set('new-clip');h.media('loadedmetadata');await flush();
  assert.equal(h.requests.length,2);assert.equal(h.get('result').hidden,true);
});
test('fetch failure exposes safe structured diagnostics even without a suggestion',async()=>{
  const h=harness();await flush();
  h.requests[0].resolve({ok:false,error:{code:'AUDIO_UNAVAILABLE',message:'Audio unavailable'},diagnostics:{fetchHTTPStatus:403,contentType:'text/html',finalRedirectedURL:'https://cnow.apps.ng.cengage.com/login',failureStage:'fetch-http'}});
  await flush();assert.equal(h.get('result').hidden,true);assert.equal(h.get('audio-debug').hidden,false);assert.equal(h.get('audio-debug').open,true);
  const d=JSON.parse(h.get('audio-diagnostics').textContent);assert.equal(d.fetchHTTPStatus,403);assert.equal(d.failureStage,'fetch-http');assert.equal(d.duration,12.5);
});

test('multi-audio panel refuses a response missing the second verified clip',async()=>{
 const h=harness();await flush();
 const first=h.requests[0].message.question.audio;
 h.setSources([{...first,id:'excerpt-1',label:'Excerpt 1'},{...first,id:'excerpt-2',label:'Excerpt 2',url:first.url.replace('first','second')}]);
 h.mutate();h.scan();await flush();h.reply(1);await flush();
 assert.equal(h.get('result').hidden,true);assert.match(h.get('status').textContent,/not all question excerpts/);
});
