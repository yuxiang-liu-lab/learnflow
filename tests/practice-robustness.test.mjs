import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {validateQuestion,buildRequest} from '../background/openai.mjs';
import {analyzeAudio} from '../background/audio.mjs';
const scope=vm.createContext({URL});vm.runInContext(fs.readFileSync(new URL('../content/parser.js',import.meta.url),'utf8'),scope);
function fixture({count=2,clips=0,labels=true,described=false,long=false}={}){
 const visible={getClientRects:()=>[{}]};
 const players=Array.from({length:clips},(_,i)=>({...visible,src:'/ilrn/books/hb2ml06h/clip'+i+'.mp3',getAttribute(name){return name==='src'?this.src:name==='aria-label'&&labels?'Excerpt '+String.fromCharCode(65+i):null;},querySelectorAll:()=>[]}));
 const prompt={...visible,id:'prompt',innerText:clips?'Compare the excerpts. Which has triple meter?':'Which statement is correct?',contains:p=>players.includes(p)};
 const choiceLabels=Array.from({length:count},(_,i)=>({...visible,innerText:String.fromCharCode(65+i)+'. '+(long?'A long alternative that is not True or False. '.repeat(8):'Alternative '+(i+1))}));
 const inputs=choiceLabels.map((label,i)=>({...visible,id:'i'+i,name:'answer',labels:[label],getAttribute:()=>described?'prompt':null}));
 const root={...visible,contains:node=>choiceLabels.includes(node),querySelectorAll:s=>s==='.problemTypes'?[prompt]:s==='audio'?players:inputs};
 const doc={baseURI:'https://cnow.apps.ng.cengage.com/ilrn/takeAssignment/test',defaultView:{getComputedStyle:()=>({visibility:'visible'})},querySelectorAll:()=>[root]};
 return {read:()=>scope.qaReadQuestion(doc),players,prompt,inputs,root,doc};
}
test('two legitimate scoped radio choices without redundant prompt ARIA are supported',()=>{
 const result=fixture().read();assert.equal(result.ok,true,result.reason);assert.equal(result.data.choices.length,2);
 const request=buildRequest(validateQuestion(result.data),'text');assert.equal(JSON.parse(request.input).choices.length,2);
});
test('two long alternatives and 3/4/5 options retain their actual text and count',()=>{
 for(const count of [2,3,4,5]){const result=fixture({count,long:true}).read();assert.equal(result.ok,true,result.reason);assert.equal(validateQuestion(result.data).choices.length,count);assert.match(result.data.choices[0].text,/long alternative/);}
});
test('one, two and three players become distinct ordered sources with explicit or fallback labels',()=>{
 for(const clips of [1,2,3])for(const labels of [true,false]){const result=fixture({clips,labels,described:true}).read();assert.equal(result.ok,true);assert.equal(result.data.audioSources.length,clips);assert.ok(result.data.audioSources.every(s=>s.kind==='native-mp3'));assert.equal(result.data.audioSources[0].label,labels?'Excerpt A':'Excerpt 1');}
});

const success={answer:'A',answerText:'Alternative 1',explanation:'The first excerpt has the audible feature.',confidence:0.8};
const mp3=i=>{const bytes=new Uint8Array(256);bytes.set([73,68,51,i]);return bytes;};
const reply=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(success)}}]}));
test('2 and 3 clips keep identity, exact options and distinct bytes in the audio request',async()=>{
 for(const count of [2,3]){
  const question=validateQuestion(fixture({clips:count,described:true}).read().data);let apiCalls=0;
  const result=await analyzeAudio(question,{apiKey:'sk-test-placeholder',audioModel:'gpt-audio'},new AbortController().signal,async(url,init)=>{
   if(url.endsWith('.mp3'))return new Response(mp3(Number(url.match(/clip(\d)/)[1])));
   apiCalls++;const content=JSON.parse(init.body).messages[1].content;
   assert.equal(JSON.parse(content[0].text).choices.length,2);
   for(let i=0;i<count;i++){assert.equal(JSON.parse(content[1+i*2].text).label,'Excerpt '+String.fromCharCode(65+i));assert.equal(content[2+i*2].input_audio.data,Buffer.from(mp3(i)).toString('base64'));}
   return reply();
  });assert.equal(apiCalls,1);assert.equal(result.audioSources.length,count);assert.equal(new Set(result.audioSources.map(s=>s.sha256)).size,count);
 }
});
test('missing or rejected second clip never reaches the model and reports 1 of 2',async()=>{
 for(const missingPlayer of [false,true]){
  const f=fixture({clips:2,labels:false,described:true});
  if(missingPlayer){f.players.pop();f.prompt.innerText='Compare the two excerpts.';}else f.players[1].src='';
  const question=validateQuestion(f.read().data);let calls=0;
  await assert.rejects(analyzeAudio(question,{audioModel:'gpt-audio'},new AbortController().signal,async url=>{calls++;assert.ok(url.endsWith('.mp3'));return new Response(mp3(1));}),error=>error.code==='AUDIO_UNAVAILABLE'&&/1 of 2/.test(error.message));
  assert.equal(calls,1);
 }
});
test('second-clip network failure is diagnosed and no API fallback occurs',async()=>{
 const question=validateQuestion(fixture({clips:2,described:true}).read().data);let requests=[];
 await assert.rejects(analyzeAudio(question,{},new AbortController().signal,async url=>{requests.push(url);return url.includes('clip1')?new Response('Unavailable',{status:403}):new Response(mp3(0));}),error=>error.diagnostics.sources[1].fetchHTTPStatus===403&&/1 of 2/.test(error.message));
 assert.equal(requests.length,2);assert.ok(requests.every(url=>url.endsWith('.mp3')));
});
test('ambiguous duplicate labels and unmatched excerpt references abstain before API',()=>{
 const f=fixture({clips:2,described:true});f.players[1].getAttribute=name=>name==='src'?f.players[1].src:name==='aria-label'?'Excerpt A':null;
 assert.throws(()=>validateQuestion(f.read().data),{code:'AUDIO_MAPPING_AMBIGUOUS'});
 const g=fixture({clips:2,labels:false,described:true});g.prompt.innerText='Compare Excerpt A and Excerpt B.';
 assert.throws(()=>validateQuestion(g.read().data),{code:'AUDIO_MAPPING_AMBIGUOUS'});
});
test('any excerpt URL, label or ordering change invalidates the fingerprint; playback does not',()=>{
 const f=fixture({clips:3,described:true});const first=f.read().fingerprint;
 f.players[2].currentTime=4;f.players[1].readyState=4;assert.equal(f.read().fingerprint,first);
 f.players[1].src='/ilrn/books/hb2ml06h/new.mp3';const changed=f.read().fingerprint;assert.notEqual(changed,first);
 f.players.reverse();assert.notEqual(f.read().fingerprint,changed);
});

test('visible figure captions and choice-owned players preserve labels and associations',()=>{
 const f=fixture({clips:2,labels:false,described:true});
 const captions=f.players.map((p,i)=>({innerText:'Recording '+(i+1),getClientRects:()=>[{}]}));const contains=f.root.contains;
 f.root.contains=node=>captions.includes(node)||contains(node);
 f.players.forEach((p,i)=>p.closest=()=>({querySelector:()=>captions[i]}));
 assert.deepEqual(Array.from(f.read().data.audioSources,s=>s.label),['Recording 1','Recording 2']);
 f.players.forEach(p=>delete p.closest);f.prompt.contains=()=>false;
 f.inputs.forEach((input,i)=>input.labels[0].contains=node=>node===f.players[i]);
 assert.deepEqual(Array.from(f.read().data.audioSources,s=>s.choiceAnswer),['A','B']);
 assert.ok(f.read().data.audioSources.every(s=>s.kind==='native-mp3'));
});
