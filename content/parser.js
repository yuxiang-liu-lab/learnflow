"use strict";
function qaSafeMediaURL(value, base) {
  if (!value) return '';
  try {const u=new URL(value,base); if(u.protocol==='blob:')return 'blob:[redacted]'; if(!['https:','http:'].includes(u.protocol))return u.protocol+'[redacted]';return u.origin+u.pathname+(u.search?'?[redacted]':'')+(u.hash?'#[redacted]':'');} catch {return '[invalid URL]';}
}
// Based on the rendered Chapter 9 question, 2026-09-16.
function qaReadQuestion(doc = document) {
  const visible = el => !!el && el.getClientRects().length > 0 && doc.defaultView.getComputedStyle(el).visibility !== "hidden";
  const clean = text => text.replace(/\s+/g, " ").trim();
  const roots = [...doc.querySelectorAll("#task_div .questionWrapper")].filter(visible);
  const describe=el=>({tag:el.tagName||null,id:el.id||null,className:typeof el.className==='string'?el.className:null});
  const parserDiagnostics={diagnosticsVersion:'prompt-inspection-1',parsedQuestion:null,containerSelector:'#task_div .questionWrapper',containerCount:roots.length,containers:roots.slice(0,5).map(describe),optionCount:0,promptCandidates:[]};
  const reject=reason=>({ok:false,reason,parserDiagnostics:{...parserDiagnostics,failureReason:reason}});
  if (roots.length !== 1) return reject("Waiting for one unambiguous question area");
  const root = roots[0];
  let inputs = [...root.querySelectorAll('.choiceTable input[type="radio"]')].filter(visible);
  const legacyCandidates=[...root.querySelectorAll('.problemTypes')];
  const visibleCandidates=legacyCandidates.filter(visible);
  // Observed Cengage layout: statement <item>_question, answers submitForm_<item>.
  // The class also occurs on surrounding/answer TDs, so class uniqueness is insufficient.
  const associations=visibleCandidates.flatMap(candidate=>{
    const match=/^(.+)_question$/.exec(candidate.id||'');
    if(!match)return [];
    const group=doc.getElementById?.('submitForm_'+match[1]);
    if(!group||!root.contains(group)||candidate.contains?.(group)||group.contains?.(candidate))return [];
    const radios=[...group.querySelectorAll('input[type="radio"]')].filter(visible);
    if(radios.length<2||radios.length>26||!radios[0].name||new Set(radios.map(input=>input.name)).size!==1||radios.some(input=>!(input.getAttribute('aria-describedby')||'').split(/\s+/).includes(candidate.id)))return [];
    return [{prompt:candidate,group,inputs:radios}];
  });
  const prompts=associations.length?associations.map(item=>item.prompt):visibleCandidates;
  if(associations.length===1)inputs=associations[0].inputs;
  parserDiagnostics.promptAssociation=associations.length===1?'matched Cengage item ID + scoped radio aria-describedby':'legacy .problemTypes uniqueness';
  parserDiagnostics.associatedAnswerContainer=associations.length===1?describe(associations[0].group):null;
  parserDiagnostics.optionCount=inputs.length;
  parserDiagnostics.options=inputs.map((input,index)=>({index:index+1,input:describe(input),group:input.name,
    ariaDescribedBy:input.getAttribute('aria-describedby')||'',ariaLabelledBy:input.getAttribute('aria-labelledby')||'',
    labels:[...(input.labels||[])].map(label=>({text:label.innerText||'',visible:visible(label),insideQuestion:root.contains(label)}))}));
  const pathToRoot=el=>{const path=[];for(let node=el;node&&path.length<12;node=node.parentElement){path.push(describe(node));if(node===root)break;}return path;};
  parserDiagnostics.radioPaths=inputs.map(input=>pathToRoot(input));
  parserDiagnostics.radioGroups=[...new Set(inputs.map(input=>input.name))];

  parserDiagnostics.promptSelector='.problemTypes';
  parserDiagnostics.visiblePromptCount=visibleCandidates.length;
  parserDiagnostics.selectedPromptCount=prompts.length;
  // Inspection only: these extra blocks are never used as prompts automatically.
  const inspection=[...(root.querySelectorAll?.('p, legend, [role="heading"], div, span')||[])];
  const allCandidates=[...new Set([...legacyCandidates,...inspection])];
  const candidates=allCandidates.slice(0,60);
  parserDiagnostics.candidateCount=allCandidates.length;
  parserDiagnostics.candidatesTruncated=allCandidates.length>60;
  parserDiagnostics.promptCandidates=candidates.map(el=>{
    const rawText=el.innerText||'',text=clean(rawText).slice(0,12000),isLegacy=legacyCandidates.includes(el);
    const reason=!visible(el)?'Rejected: hidden':!text?'Rejected: empty':associations.length===1?(el===prompts[0]?'Accepted: item ID matches answer container and all radios reference this prompt':'Rejected: not the radio-associated statement'):!isLegacy?'Inspection only: not a verified prompt association':prompts.length!==1?'Rejected: multiple visible .problemTypes candidates':'Accepted: sole visible .problemTypes block';
    const common=[];
    for(const input of inputs){let ancestor=el;while(ancestor&&ancestor!==root&&!ancestor.contains?.(input))ancestor=ancestor.parentElement;common.push(ancestor?describe(ancestor):null);}
    return {...describe(el),text,textTruncated:clean(rawText).length>12000,reason,
      relation:{pathToQuestion:pathToRoot(el),containsRadioIndexes:inputs.flatMap((input,index)=>el.contains?.(input)?[index+1]:[]),
        referencedByRadioIndexes:inputs.flatMap((input,index)=>el.id&&['aria-describedby','aria-labelledby'].some(attr=>(input.getAttribute(attr)||'').split(/\s+/).includes(el.id))?[index+1]:[]),
        sharesParentWithRadioIndexes:inputs.flatMap((input,index)=>el.parentElement&&el.parentElement===input.parentElement?[index+1]:[]),commonAncestorsWithRadios:common}};
  });
  if (prompts.length !== 1) return reject("Question prompt is ambiguous or missing");
  const prompt = prompts[0];
  if (inputs.length < 2 || inputs.length > 26) return reject("Expected 2–26 visible radio choices");
  if (!inputs[0].name || new Set(inputs.map(input => input.name)).size !== 1 || inputs.some(input => {const refs=input.getAttribute("aria-describedby");return refs && !refs.split(/\s+/).includes(prompt.id);})) return reject("Choices do not belong to one verified prompt");
  const labels = inputs.map(input => [...input.labels].filter(label => root.contains(label) && visible(label)));
  if (labels.some(group => group.length !== 1)) return reject("Choice labels are ambiguous or missing");
  const choices = labels.map((group, index) => ({answer:String.fromCharCode(65 + index), text:clean(group[0].innerText).replace(/^[a-z][.)]\s+/i, ""), inputId:inputs[index].id}));
  const question = clean(prompt.innerText);
  if (!question || choices.some(choice => !choice.text)) return reject("Question or choice text is empty");
  // Cengage boundary: native players in the prompt or a verified choice label.
  // Never take a player from the surrounding textbook/parent frame.
  const players = [...root.querySelectorAll('audio')];
  const audioSources=[], diagnostics=[];
  for(const [index,player] of players.entries()) {
    const absolute = value => {try {return value ? new URL(value,doc.baseURI).href : '';}catch{return '';}};
    const declared = absolute(player.getAttribute('src'));
    const currentSrc = absolute(player.currentSrc);
    const sources = [...(player.querySelectorAll?.('source') || [])].map(source=>({src:absolute(source.getAttribute('src')),type:source.getAttribute('type') || ''}));
    const candidates = [...new Set(sources.map(source=>source.src).filter(Boolean))];
    const url = declared || (candidates.includes(currentSrc) ? currentSrc : candidates.length===1 ? candidates[0] : !candidates.length ? currentSrc : '') || null;
    const owners=labels.map((group,i)=>group.some(label=>label.contains?.(player))?i:-1).filter(i=>i>=0);
    const associated=(prompt.contains(player)||owners.length===1)&&owners.length<=1;
    const labelledBy=(player.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>doc.getElementById?.(id)).filter(el=>el&&root.contains(el)&&visible(el)).map(el=>el.innerText).join(' ');
    const caption=player.closest?.('figure')?.querySelector('figcaption');
    const aria=player.getAttribute('aria-label');
    const explicit=clean(labelledBy || (caption&&root.contains(caption)&&visible(caption)?caption.innerText:'') || (aria&&aria!==player.getAttribute('src')?aria:'') || '');
    const label=explicit || (owners.length===1?choices[owners[0]].text:'Excerpt '+(index+1));
    const source={id:'excerpt-'+(index+1),label:label.slice(0,300),kind:associated&&url&&/^https:/i.test(url)?'native-mp3':'unsupported',url,...(owners.length===1?{choiceAnswer:choices[owners[0]].answer}:{})};
    audioSources.push(source);
    const safe=value=>qaSafeMediaURL(value,doc.baseURI);
    diagnostics.push({id:source.id,label:source.label,choiceAnswer:source.choiceAnswer||null,srcAttribute:safe(player.getAttribute('src')),src:safe(player.src),currentSrc:safe(player.currentSrc),nestedSources:sources.map(source=>({src:safe(source.src),type:source.type.slice(0,100)})),readyState:player.readyState??null,networkState:player.networkState??null,duration:Number.isFinite(player.duration)?player.duration:null,resolvedMediaURL:safe(url),failureStage:!associated?'question-association':!url?'source-resolution':source.kind==='unsupported'?'source-protocol':null});
  }
  const numbered=(question.match(/\b(\d+|two|three|four|five|six)\s+(?:audio\s+)?(?:excerpts|clips|recordings)\b/i)||[])[1];
  const words={two:2,three:3,four:4,five:5,six:6};
  const refs=[...(question+' '+choices.map(c=>c.text).join(' ')).matchAll(/\b(?:excerpt|clip|audio)\s+([a-z]|\d+)\b/gi)].map(m=>m[1].toLowerCase());
  const expected=Math.max(players.length,words[numbered?.toLowerCase()]||Number(numbered)||0,new Set(refs).size);
  // Missing players remain explicit required sources; never analyze a partial set.
  for(let i=audioSources.length;i<Math.min(expected,7);i++){
    audioSources.push({id:'excerpt-'+(i+1),label:'Excerpt '+(i+1),kind:'unsupported',url:null});
    diagnostics.push({id:'excerpt-'+(i+1),label:'Excerpt '+(i+1),failureStage:'missing-player'});
  }
  let mappingError=null;
  if(new Set(audioSources.map(s=>s.label.toLowerCase())).size!==audioSources.length)mappingError='Duplicate excerpt labels make the audio mapping ambiguous.';
  const references=refs;
  if(audioSources.length>1&&references.some(ref=>!audioSources.some(s=>new RegExp('(?:^|\\s)'+ref+'$','i').test(s.label)||s.choiceAnswer?.toLowerCase()===ref)))mappingError='The question references excerpts that cannot be mapped to the player labels.';
  if(mappingError)for(const source of audioSources)source.kind='unsupported';
  let audio=audioSources.length?{kind:audioSources.some(s=>s.kind==='unsupported')?'unsupported':'native-mp3',url:audioSources[0].url}:null;
  let audioDiagnostics=players.length?{...diagnostics[0],playerCount:players.length,optionCount:choices.length,sources:diagnostics,mappingError}:null;
  // Explicit references to a supplied clip must not silently become text-only
  // while its player is missing/loading. Inspect this prompt, never page text.
  const needsClip = expected>0 || /\blisten\s+to\b|\b(?:this|the|following|supplied|provided)\s+(?:(?:audio|musical|music|sound)\s+)?(?:excerpt|clip|recording)\b|\b(?:heard|hearing)\s+in\b/i.test(question);
  if (!audio && needsClip) audio = {kind:'unsupported',url:null};
  if(audio&&!audioSources.length)audioSources.push({id:'excerpt-1',label:'Excerpt 1',...audio});
  const data = {id:prompt.id, question, choices, audioSources, ...(mappingError?{audioMappingError:mappingError}:{}), audioStatus:audio ? 'required' : 'none', ...(audio ? {audio} : {})};
  // Fingerprint content and the declared clip URL, never transient input IDs,
  // selection, playback position, or metadata loading. A replaced src wins
  // over currentSrc, which may still describe the previous resource.
  // Presentation-only sanitized copy. It never enters data sent to the worker.
  parserDiagnostics.parsedQuestion={...data,choices:choices.map(({answer,text})=>({answer,text})),
    audioSources:audioSources.map(source=>({...source,url:qaSafeMediaURL(source.url,doc.baseURI)})),
    ...(audio?{audio:{...audio,url:qaSafeMediaURL(audio.url,doc.baseURI)}}:{})};
  const fingerprint = JSON.stringify({...data, choices:choices.map(({answer,text}) => ({answer,text}))});
  return {ok:true, data, fingerprint, audioDiagnostics, parserDiagnostics:{...parserDiagnostics,optionCount:choices.length,audioCount:players.length,requiredAudioCount:audioSources.length,mappingError}, players, elements:[prompt, ...labels.flat()]};
}
