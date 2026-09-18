import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchClip,validateAudioSource,analyzeAudio,parseAudioResponse} from '../background/audio.mjs';
const audio={kind:'native-mp3',url:'https://cnow.apps.ng.cengage.com/ilrn/books/hb1ml06h/synthetic_clip_a.mp3'};
const q={id:'synthetic-order-item_question',question:'Which synthetic excerpt contains the described pattern?',audio,choices:[{answer:'A',text:'first'},{answer:'B',text:'second'}]};
const bytes=new Uint8Array(256);bytes.set([73,68,51]);
const answer={audibleEvidence:['Specific mock audible sequence.'],answer:'B',answerText:'second',explanation:'Mock explanation.',confidence:0.8};
const completion=value=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
test('only the observed Cengage native MP3 mechanism is accepted',()=>{
  assert.equal(validateAudioSource(audio),audio.url);
  for(const changed of [{kind:'unsupported'}, {url:'blob:test'},{url:audio.url+'#t=1,2'},{url:audio.url.replace('cnow.apps.ng.cengage.com','example.com')},{url:audio.url.replace('hb1ml06h','other')}]) assert.throws(()=>validateAudioSource({...audio,...changed}),{code:'AUDIO_UNAVAILABLE'});
});
test('clip fetch is associated with its exact URL and never receives OpenAI credentials',async()=>{
  const result=await fetchClip(audio,new AbortController().signal,async(url,init)=>{
    assert.equal(url,audio.url);assert.equal(init.credentials,'include');assert.equal(init.headers,undefined);assert.equal(init.redirect,'follow');
    return new Response(bytes,{headers:{'Content-Type':'audio/mpeg'}});
  });
  assert.equal(result.byteLength,256);assert.equal(result.sha256.length,64);assert.equal(atob(result.base64).length,256);
});
test('login HTML, missing audio and oversized downloads stop before model call',async()=>{
  for(const response of [new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}),new Response('missing',{status:404}),new Response(bytes,{headers:{'Content-Length':'20000000'}})]){
    let calls=0;
    await assert.rejects(analyzeAudio(q,{apiKey:'sk-placeholder',audioModel:'gpt-audio'},new AbortController().signal,async()=>{calls++;return response;}),{code:'AUDIO_UNAVAILABLE'});
    assert.equal(calls,1);
  }
});
test('audio bytes and all choices are sent to the audio model with no text fallback',async()=>{
  let calls=0;
  const result=await analyzeAudio(q,{apiKey:'sk-placeholder',audioModel:'gpt-audio'},new AbortController().signal,async(url,init)=>{
    calls++;
    if(calls===1)return new Response(bytes);
    assert.equal(url,'https://api.openai.com/v1/chat/completions');
    const body=JSON.parse(init.body);const content=body.messages[1].content;
    assert.deepEqual(JSON.parse(content[0].text),{question:q.question,choices:q.choices});
    assert.equal(content[1].type,'input_audio');assert.equal(content[1].input_audio.format,'mp3');assert.equal(atob(content[1].input_audio.data).length,bytes.length);
    assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,'Bearer sk-placeholder');assert.ok(!init.body.includes('sk-placeholder'));
    return new Response(JSON.stringify(completion(answer)));
  });
  assert.equal(calls,2);assert.equal(result.suggestion.answer,'B');assert.equal(result.audio.sha256.length,64);
});
test('insufficient audio, no audible evidence and malformed model output show no answer',()=>{
  assert.throws(()=>parseAudioResponse(completion({status:'insufficient_audio_evidence'}),q),{code:'insufficient_audio_evidence'});
  assert.throws(()=>parseAudioResponse(completion({...answer,audibleEvidence:[]}),q),{code:'AUDIO_RESPONSE_INVALID'});
  assert.throws(()=>parseAudioResponse(completion({...answer,answer:'Z'}),q),{code:'RESPONSE_INVALID'});
  assert.throws(()=>parseAudioResponse({choices:[{finish_reason:'length'}]},q),{code:'AUDIO_ANALYSIS_FAILED'});
});

test('audio response rejects multiple completions, tools, extra fields and malformed JSON',()=>{
  const two=completion(answer);two.choices.push(two.choices[0]);
  assert.throws(()=>parseAudioResponse(two,q),{code:'AUDIO_RESPONSE_INVALID'});
  const tool=completion(answer);tool.choices[0].message.tool_calls=[{}];
  assert.throws(()=>parseAudioResponse(tool,q),{code:'AUDIO_ANALYSIS_FAILED'});
  assert.throws(()=>parseAudioResponse(completion({...answer,extra:true}),q),{code:'RESPONSE_INVALID'});
  const bad=completion(answer);bad.choices[0].message.content='```json {} ```';
  assert.throws(()=>parseAudioResponse(bad,q),{code:'AUDIO_RESPONSE_INVALID'});
});
test('audio HTTP failures never use the text endpoint or expose raw API errors',async()=>{
  let calls=0;
  await assert.rejects(analyzeAudio(q,{apiKey:'sk-placeholder',audioModel:'gpt-audio'},new AbortController().signal,async(url)=>{
    calls++;
    if(calls===1)return new Response(bytes);
    assert.equal(url,'https://api.openai.com/v1/chat/completions');
    return new Response('sk-placeholder',{status:400});
  }),e=>e.code==='AUDIO_HTTP_400'&&!e.message.includes('sk-placeholder'));
  assert.equal(calls,2);
});

test('both comparison models receive identical audio, choices, prompt and request settings',async()=>{
  const bodies=[];
  for(const model of ['gpt-audio','gpt-audio-1.5']) {
    const result=await analyzeAudio(q,{apiKey:'sk-placeholder',audioModel:model},new AbortController().signal,async(url,init)=>{
      if(url===audio.url)return new Response(bytes);
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(completion(answer)));
    });
    assert.equal(result.promptVersion,'listening-evidence-v3');
    assert.deepEqual(result.audibleEvidence,answer.audibleEvidence);
  }
  assert.equal(bodies[0].model,'gpt-audio');assert.equal(bodies[1].model,'gpt-audio-1.5');
  const {model:a,...first}=bodies[0], {model:b,...second}=bodies[1];
  assert.deepEqual(first,second);
});
test('audibleEvidence is optional but invalid evidence or mixed abstention/answer is rejected',()=>{
  const {audibleEvidence,...concise}=answer;
  assert.deepEqual(parseAudioResponse(completion(concise),q),{suggestion:concise});
  for(const invalid of [null,'voices',[],[''],[3],Array(6).fill('voices'),['x'.repeat(201)]]) {
    assert.throws(()=>parseAudioResponse(completion({...concise,audibleEvidence:invalid}),q),{code:'AUDIO_RESPONSE_INVALID'});
  }
  assert.throws(()=>parseAudioResponse(completion({...concise,status:'insufficient_audio_evidence'}),q),{code:'AUDIO_RESPONSE_INVALID'});
  assert.throws(()=>parseAudioResponse(completion({status:'unknown'}),q),{code:'AUDIO_RESPONSE_INVALID'});
  assert.throws(()=>parseAudioResponse(completion({...concise,reasoning:'unrequested deliberation'}),q),{code:'RESPONSE_INVALID'});
});
test('insufficient evidence stops after the audio response without guessing or fallback',async()=>{
  let calls=0;
  await assert.rejects(analyzeAudio(q,{apiKey:'sk-placeholder',audioModel:'gpt-audio-1.5'},new AbortController().signal,async(url)=>{
    calls++;
    return url===audio.url ? new Response(bytes) : new Response(JSON.stringify(completion({status:'insufficient_audio_evidence'})));
  }),{code:'insufficient_audio_evidence'});
  assert.equal(calls,2);
});

test('synthetic filename in the second supported directory passes the validator and diagnostics preserve HTTP outcomes',async()=>{
  const source={kind:'native-mp3',url:'https://cnow.apps.ng.cengage.com/ilrn/books/hb2ml06h/synthetic_clip_b.mp3'};
  assert.equal(validateAudioSource(source),source.url);
  const clip=await fetchClip(source,new AbortController().signal,async()=>new Response(bytes,{headers:{'content-type':'audio/mpeg'}}));
  assert.equal(clip.diagnostics.fetchHTTPStatus,200);assert.equal(clip.diagnostics.contentType,'audio/mpeg');
  assert.equal(clip.diagnostics.finalRedirectedURL,source.url);assert.equal(clip.diagnostics.failureStage,null);
  await assert.rejects(fetchClip(source,new AbortController().signal,async()=>new Response('denied',{status:403})),e=>e.diagnostics.fetchHTTPStatus===403&&e.diagnostics.failureStage==='fetch-http');
  await assert.rejects(fetchClip(source,new AbortController().signal,async()=>{throw Error('cookie=secret');}),e=>e.diagnostics.failureStage==='fetch-network'&&!JSON.stringify(e.diagnostics).includes('secret'));
  await assert.rejects(fetchClip({...source,url:source.url+'?token=secret'},new AbortController().signal,async()=>assert.fail('must not fetch')),e=>e.diagnostics.failureStage==='source-validation'&&!JSON.stringify(e.diagnostics).includes('secret'));
});
test('redirected media requires a supported final URL; HTML is diagnosed without parsing',async()=>{
  const response=new Response(bytes,{headers:{'content-type':'audio/mpeg'}});
  Object.defineProperties(response,{url:{value:'https://example.com/audio.mp3'},redirected:{value:true}});
  await assert.rejects(fetchClip(audio,new AbortController().signal,async()=>response),e=>e.diagnostics.failureStage==='redirect-validation'&&e.diagnostics.redirected===true);
  await assert.rejects(fetchClip(audio,new AbortController().signal,async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})),e=>e.diagnostics.failureStage==='content-type'&&e.diagnostics.contentType==='text/html');
});
