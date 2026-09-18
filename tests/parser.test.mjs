import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const scope = vm.createContext({URL});
vm.runInContext(fs.readFileSync(new URL('../content/parser.js',import.meta.url),'utf8'),scope);
function fixture() {
  const visible = {getClientRects:()=>[{}]};
  const player = {src:'/ilrn/books/hb1ml06h/synthetic_clip_a.mp3',getAttribute(){return this.src;}};
  const prompt = {...visible,id:'question',innerText:'Listen to the excerpt.',contains:el=>el===player};
  const labels = ['A. first','B. second'].map(innerText=>({...visible,innerText}));
  const inputs = labels.map((label,i)=>({...visible,id:`input${i}`,name:'group',labels:[label],getAttribute:()=>prompt.id}));
  const players = [player];
  const root = {...visible,contains:el=>labels.includes(el),querySelectorAll:selector=>selector==='.problemTypes'?[prompt]:selector==='audio'?players:inputs};
  const doc = {baseURI:'https://media.example.test/ilrn/takeAssignment/test',defaultView:{getComputedStyle:()=>({visibility:'visible'})},querySelectorAll:selector=>{assert.equal(selector,'#task_div .questionWrapper');return [root];}};
  return {doc,player,prompt,labels,inputs,players,read:()=>scope.qaReadQuestion(doc)};
}
test('parser reads only the question wrapper and associates MP3 with its prompt',()=>{
  const f=fixture(), result=f.read();
  assert.equal(result.ok,true);
  assert.equal(result.data.audio.url,'https://media.example.test/ilrn/books/hb1ml06h/synthetic_clip_a.mp3');
  assert.deepEqual(Array.from(result.data.choices,c=>c.text),['first','second']);
  f.prompt.contains=()=>false;
  assert.equal(f.read().data.audio.kind,'unsupported');
  f.players.push(f.player);
  assert.equal(f.read().data.audio.kind,'unsupported');
});
test('prompt, choices and MP3 changes invalidate identity; playback and regenerated input IDs do not',()=>{
  const f=fixture(), original=f.read().fingerprint;
  f.player.currentTime=9;f.player.duration=8.5;f.inputs[0].checked=true;f.inputs[0].id='regenerated';
  assert.equal(f.read().fingerprint,original);
  f.player.currentSrc='https://media.example.test/ilrn/books/hb1ml06h/old.mp3';
  f.player.src='/ilrn/books/hb1ml06h/next.mp3';
  assert.notEqual(f.read().fingerprint,original);
  const audioChanged=f.read().fingerprint;
  f.prompt.innerText='Another prompt';assert.notEqual(f.read().fingerprint,audioChanged);
  const promptChanged=f.read().fingerprint;
  f.labels[0].innerText='A. different';assert.notEqual(f.read().fingerprint,promptChanged);
});
test('missing native source remains audio-required and cannot become text analysis',()=>{
  const f=fixture();f.player.src='';
  assert.equal(f.read().data.audioStatus,'required');
  assert.equal(f.read().data.audio.kind,'unsupported');
});

test('synthetic relative MP3 has stable fingerprint after playback',()=>{
  const sample=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic-audio-source.json',import.meta.url),'utf8'));
  const f=fixture();f.doc.baseURI=sample.src;f.prompt.id=sample.id;f.prompt.innerText=sample.question;f.player.src=sample.srcAttribute;
  f.player.currentSrc=sample.currentSrc;f.player.duration=sample.duration;f.player.readyState=sample.readyState;
  f.player.networkState=1;
  const first=f.read();
  assert.equal(first.data.audio.url,sample.src);assert.equal(first.data.audio.kind,'native-mp3');
  assert.equal(first.audioDiagnostics.duration,sample.duration);assert.equal(first.audioDiagnostics.readyState,4);
  f.player.currentTime=sample.duration;
  assert.equal(f.read().fingerprint,first.fingerprint);
});
test('nested source and currentSrc-only delivery resolve without selecting a global player',()=>{
  const f=fixture();f.player.src='';
  const url='/ilrn/books/hb2ml06h/synthetic_clip_b.mp3';
  f.player.querySelectorAll=()=>[{getAttribute:name=>name==='src'?url:'audio/mpeg'}];
  const before=f.read();assert.ok(before.data.audio.url.endsWith(url));
  f.player.currentSrc=before.data.audio.url;f.player.readyState=4;
  assert.equal(f.read().fingerprint,before.fingerprint);
  f.player.querySelectorAll=()=>[];
  assert.equal(f.read().data.audio.url,before.data.audio.url);
});
test('ambiguous sources and blob media fail closed; diagnostic URLs redact secrets',()=>{
  const f=fixture();f.player.src='';f.player.querySelectorAll=()=>['a','b'].map(v=>({getAttribute:n=>n==='src'?`/${v}.mp3`:''}));
  assert.equal(f.read().data.audio.kind,'unsupported');
  f.player.currentSrc='https://media.example.test/b.mp3';
  assert.equal(f.read().data.audio.url,f.player.currentSrc);
  f.player.src='blob:https://media.example.test/private-id';
  assert.equal(f.read().data.audio.kind,'unsupported');
  f.player.src='https://user:password@media.example.test/a.mp3?token=secret#private';
  f.player.currentSrc='';f.player.querySelectorAll=()=>[];
  const diagnostic=JSON.stringify(f.read().audioDiagnostics);
  assert.ok(!/password|secret|private|user:/.test(diagnostic));assert.match(diagnostic,/redacted/);
});
