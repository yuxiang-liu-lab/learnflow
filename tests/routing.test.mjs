import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const parser=fs.readFileSync(new URL('../content/parser.js',import.meta.url),'utf8');
const panel=fs.readFileSync(new URL('../content/content.js',import.meta.url),'utf8');

// Run the actual parser -> panel -> worker -> API mock -> panel path.
// Fixture players outside the current question are available only to page-wide queries.
function page({listening=false,globalAudio=false,missing=false,choiceCount=5,audioCount=1},send) {
  const nodes=new Map();
  const node=()=>({textContent:'',hidden:false,style:{},classList:{toggle(){}},addEventListener(){},setAttribute(){},append(){},replaceChildren(){},getClientRects:()=>[{}]});
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const player={getAttribute:()=>'/ilrn/books/hb1ml06h/synthetic_clip_a.mp3'};
  const players=Array.from({length:audioCount},(_,i)=>i?{getAttribute:()=>'/ilrn/books/hb1ml06h/extra'+i+'.mp3'}:player);
  const textbook={getAttribute:()=>'/textbook-long-recording.mp3'};
  const prompt={...node(),id:'ordinary-new-id',innerText:listening||missing?'Listen to the excerpt.':'Synthetic tree structures',contains:el=>players.includes(el)};
  const labels=['A. first','B. second','C. third','D. fourth','E. fifth'].slice(0,choiceCount).map(innerText=>({...node(),innerText}));
  const inputs=labels.map((label,i)=>({...node(),id:`choice${i}`,name:'choices',labels:[label],getAttribute:()=>prompt.id,checked:false}));
  const root={...node(),contains:el=>labels.includes(el),querySelectorAll:selector=>selector==='.problemTypes'?[prompt]:selector==='audio'?(listening?players:[]):inputs};
  const shadow={getElementById:get,querySelector:()=>node()};
  const host={...node(),attachShadow:()=>shadow,contains:()=>false};
  const doc={baseURI:'https://cnow.apps.ng.cengage.com/ilrn/takeAssignment/test',defaultView:{getComputedStyle:()=>({visibility:'visible'})},
    querySelectorAll:selector=>selector==='#task_div .questionWrapper'?[root]:selector==='audio'?[...(listening?players:[]),...(globalAudio?[textbook]:[])]:[],
    createElement:tag=>tag==='div'?host:node(),documentElement:{append(){}},body:{}};
  let sequence=0;
  const scope=vm.createContext({document:doc,URL,console:{info(){},warn(){}},crypto:{randomUUID:()=>String(++sequence)},QA_BUILD_VERSION:'0.6.1',
    window:{addEventListener(){}},setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
    MutationObserver:class{observe(){}disconnect(){}},qaEnableDragging:()=>({hasPreferredPosition:()=>true,reclamp(){}}),
    qaCreateMessaging:()=>({check:()=>true,send})});
  vm.runInContext(parser,scope);
  const extracted=scope.qaReadQuestion();
  vm.runInContext(panel,scope);
  return {get,extracted,inputs};
}

test('real classifier/worker/panel: text, text with global player, listening, and missing clip',async()=>{
  const oldChrome=globalThis.chrome,oldFetch=globalThis.fetch;
  let listener;
  const config={apiKey:'sk-test-placeholder',model:'gpt-5.4-mini',audioModel:'gpt-audio-1.5'};
  globalThis.chrome={runtime:{id:'routing-test',getManifest:()=>({version:'0.6.1'}),getURL:path=>`chrome-extension://routing-test/${path}`,onMessage:{addListener:fn=>listener=fn}},
    action:{onClicked:{addListener(){}}},storage:{local:{setAccessLevel:async()=>{},get:async defaults=>({...defaults,...config})}}};
  try {
    await import('../background/service-worker.js?routing-regression');
    let tabId=10;
    for(const fixture of [{},{choiceCount:2},{choiceCount:4},{globalAudio:true},{listening:true,globalAudio:true},{listening:true,audioCount:2,choiceCount:2,globalAudio:true},{listening:true,audioCount:3,choiceCount:3},{missing:true,globalAudio:true}]) {
      const calls=[];
      const answer={answer:'B',answerText:'second',explanation:'A concise explanation.',confidence:0.8};
      const mp3=new Uint8Array(256);mp3.set([73,68,51]);
      globalThis.fetch=async(url,init)=>{
        calls.push({url,init});
        if(url.endsWith('.mp3'))return new Response(mp3);
        if(url.endsWith('/responses'))return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer)}]}]}));
        if(url.endsWith('/chat/completions'))return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]}));
        assert.fail(`Unexpected endpoint ${url}`);
      };
      const sender={id:'routing-test',url:'https://cnow.apps.ng.cengage.com/ilrn/takeAssignment/test',tab:{id:tabId++},frameId:2};
      const send=message=>new Promise(resolve=>listener({...message,clientVersion:'0.6.1'},sender,resolve));
      const h=page(fixture,send);
      for(let i=0;i<50;i++) {
        await new Promise(resolve=>setTimeout(resolve,2));
        if(h.get('status').textContent==='Ready'||h.get('status').textContent.startsWith('Audio unavailable'))break;
      }
      if(fixture.missing) {
        assert.equal(calls.length,0);assert.equal(h.get('result').hidden,true);
        assert.match(h.get('status').textContent,/Audio unavailable/);
        continue;
      }
      assert.equal(h.get('status').textContent,'Ready');assert.equal(h.get('result').hidden,false);
      assert.equal(h.get('answer').textContent,'B');assert.equal(h.get('answer-text').textContent,'second');
      assert.equal(h.get('explanation').textContent,answer.explanation);assert.equal(h.get('confidence').textContent,'80%');
      assert.ok(h.inputs.every(input=>!input.checked));
      if(fixture.listening) {
        assert.equal(h.extracted.data.audioStatus,'required');assert.equal(calls.length,(fixture.audioCount||1)+1);
        assert.equal(calls[0].url,h.extracted.data.audio.url);
        assert.equal(calls.at(-1).url,'https://api.openai.com/v1/chat/completions');
        const body=JSON.parse(calls.at(-1).init.body);assert.equal(body.model,config.audioModel);
        const audioParts=body.messages[1].content.filter(part=>part.type==='input_audio');assert.equal(audioParts.length,fixture.audioCount||1);for(const part of audioParts)assert.equal(part.input_audio.data,btoa(String.fromCharCode(...mp3)));
        assert.equal(h.get('model-used').textContent,`Model: ${config.audioModel}`);
      } else {
        assert.equal(h.extracted.data.audioStatus,'none');assert.equal(h.extracted.data.audio,undefined);
        assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
        assert.equal(JSON.parse(calls[0].init.body).model,config.model);
        assert.equal(h.get('model-used').textContent,`Model: ${config.model}`);
        assert.equal(h.get('audio').textContent,'Audio detected: No — text question');
      }
    }
  } finally {globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;}
});
