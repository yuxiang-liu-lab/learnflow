import {AssistantError} from './openai.mjs';
import {validateSelection} from './understand.mjs';
const fail = message => {throw new AssistantError('STUDY_INVALID', message);};
export function sourceContext(value) {
  const {text,action}=validateSelection({text:value?.sourceText,action:value?.action || 'explain'});
  let pageUrl='';
  try {const url=new URL(value.pageUrl);if(['http:','https:'].includes(url.protocol))pageUrl=url.origin+url.pathname;} catch {}
  return {sourceText:text,action,pageTitle:typeof value.pageTitle==='string'?value.pageTitle.slice(0,300):'',pageUrl:pageUrl.slice(0,2000)};
}
export const emptySession = () => ({id:crypto.randomUUID(),source:null,pending:null,messages:[],busy:false,error:'',model:''});
export function offerSelection(state,value) {return {...state,pending:sourceContext(value)};}
export function replaceContext(state) {
  if(state.busy)fail('Wait for the current response before replacing context.');
  if(!state.pending)fail('No new selection is ready.');
  return {...emptySession(),source:state.pending};
}
export function beginTurn(state,{action,question}) {
  if(state.busy)fail('A response is already running.');
  if(!state.source)fail('Use a selection first.');
  let text;
  if(question !== undefined) {
    if(!state.messages.length)fail('Choose a study action before asking a follow-up.');
    if(typeof question!=='string'||!question.trim()||question.length>2000)fail('Enter a follow-up of 1–2,000 characters.');
    text=question.trim();
  } else {
    validateSelection({text:state.source.sourceText,action});
    text={explain:'Explain this passage.',simple:'Explain this passage simply.',summarize:'Summarize this passage.'}[action];
  }
  if(state.messages.length>=20 || state.messages.reduce((n,m)=>n+m.content.length,0)+text.length>60000)fail('This conversation reached its limit. Use a new selection to start another.');
  return {...state,busy:true,error:'',source:{...state.source,action:state.messages.length?state.source.action:(action||state.source.action)},turn:{action:action||state.source.action,question:text}};
}
export function finishTurn(state,result) {
  return {...state,busy:false,turn:null,model:result.model,messages:[...state.messages,{role:'user',content:state.turn.question},{role:'assistant',content:result.response}]};
}
// Serialized updates avoid lost selections/results across popup and panel.
export function createSessionStore(storage) {
  const queues=new Map();
  return {
    update(windowId,change) {
      if(!Number.isInteger(windowId)||windowId<0)return Promise.reject(new AssistantError('STUDY_INVALID','Invalid browser window.'));
      const key='study:'+windowId;
      const task=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
        const stored=await storage.get(key);
        const next=await change(stored[key]||emptySession());
        await storage.set({[key]:next});return next;
      });
      queues.set(key,task);
      task.finally(()=>{if(queues.get(key)===task)queues.delete(key);}).catch(()=>{});
      return task;
    },
    remove(windowId) {return this.update(windowId,()=>emptySession()).then(()=>storage.remove('study:'+windowId));}
  };
}
