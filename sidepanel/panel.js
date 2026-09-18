import {readSelection,chooseSelection} from '../popup/selection.mjs';
const get=id=>document.getElementById(id),actions=[...document.querySelectorAll('[data-action]')];
let windowId,state,request=0,localBusy=false;
async function send(message) {
  const result=await chrome.runtime.sendMessage({...message,windowId});
  if(!result?.ok)throw new Error(result?.error?.message||'Extension unavailable. Reload and reopen the panel.');
  return result;
}
function render(next) {
  state=next;
  get('context').textContent=state.source?.sourceText||'Select a passage to begin.';
  get('source-page').textContent=state.source ? [state.source.pageTitle,state.source.pageUrl].filter(Boolean).join(' · ') : '';
  get('pending').hidden=!state.pending;
  get('pending-text').textContent=state.pending?.sourceText||'';
  get('replace').disabled=state.busy||localBusy;
  get('replace').textContent=state.pending ? 'Use new selection · '+({explain:'Explain',simple:'Explain simply',summarize:'Summarize'}[state.pending.action]) : 'Use new selection';
  actions.forEach(button=>button.disabled=state.busy||localBusy||!state.source);
  get('ask').disabled=state.busy||localBusy||!state.messages.length;
  get('status').textContent=state.busy?'Sending context to OpenAI…':state.error||'';
  get('model').textContent=state.model?'Model: '+state.model:'';
  get('conversation').replaceChildren();
  for(const message of state.messages){
    const card=document.createElement('article');card.className='message';
    const label=document.createElement('strong');label.textContent=message.role==='user'?'You':'AI response';
    const text=document.createElement('p');text.textContent=message.content;card.append(label,text);
    if(message.role==='assistant'){
      const copy=document.createElement('button');copy.textContent='Copy response';
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(message.content);copy.textContent='Copied';}catch{get('status').textContent='Copy unavailable. Select and copy the response manually.';}});card.append(copy);
    }
    get('conversation').append(card);
  }
  get('conversation').scrollTop=get('conversation').scrollHeight;
}
async function refresh(){const version=++request;try{const result=await send({type:'STUDY_GET'});if(version===request)render(result.state);}catch(error){get('status').textContent=error.message;}}
async function perform(message){try{await send(message);await refresh();return true;}catch(error){await refresh();get('status').textContent=error.message;return false;}}
async function run(message){if(localBusy||state?.busy)return false;localBusy=true;render(state);let ok=false;try{ok=await perform(message);return ok;}finally{const status=get('status').textContent;localBusy=false;if(state)render(state);if(!ok)get('status').textContent=status;}}
get('read').addEventListener('click',async()=>{
  try{
    const [tab]=await chrome.tabs.query({active:true,windowId});
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:readSelection});
    await perform({type:'STUDY_OFFER',source:{sourceText:chooseSelection(results),pageTitle:tab.title,pageUrl:tab.url,action:'explain'}});
  }catch{get('status').textContent='Select text on a regular webpage and open the toolbar popup or use the right-click LearnFlow menu to grant access.';}
});
get('replace').addEventListener('click',async()=>{if(localBusy||state?.busy)return;const action=state.pending?.action;if(await perform({type:'STUDY_REPLACE'}))await run({type:'STUDY_RUN',action});});
get('dismiss').addEventListener('click',()=>perform({type:'STUDY_DISMISS'}));
for(const button of actions)button.addEventListener('click',()=>run({type:'STUDY_RUN',action:button.dataset.action}));
get('followup').addEventListener('submit',async event=>{event.preventDefault();const question=get('question').value;if(await run({type:'STUDY_RUN',question}))get('question').value='';});
get('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();if(!get('ask').disabled)get('followup').requestSubmit();}});
get('settings').addEventListener('click',()=>perform({type:'QA_OPEN_SETTINGS'}));
chrome.runtime.onMessage.addListener(message=>{if(message.type==='STUDY_CHANGED'&&message.windowId===windowId)refresh();});
chrome.windows.getCurrent().then(window=>{windowId=window.id;return refresh();}).catch(()=>{get('status').textContent='Could not identify this browser window. Reopen the panel.';});
