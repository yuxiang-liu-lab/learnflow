import {readSelection, chooseSelection} from './selection.mjs';
const get = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('[data-action]')];
let text = '', busy = false, sourceTab = null;
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error?.message || 'Extension unavailable. Reload it and reopen this popup.');
  return result;
}
for (const name of ['understand', 'practice']) get(name+'-tab').addEventListener('click', () => {
  for (const module of ['understand', 'practice']) {
    get(module).hidden = module !== name;
    get(module+'-tab').setAttribute('aria-pressed', String(module === name));
  }
});
get('settings').addEventListener('click', async () => {
  try {await send({type:'QA_OPEN_SETTINGS'});} catch(error) {get('status').textContent=error.message;}
});
for (const button of buttons) button.addEventListener('click', async () => {
  if (busy || !text) return;
  busy=true;buttons.forEach(item=>item.disabled=true);
  get('result').textContent='';get('status').textContent='Working…';
  try {
    const result=await send({type:'UA_ANALYZE',selection:{action:button.dataset.action,text}});
    get('result').textContent=result.response;
    get('model').textContent='Model: '+result.model;
    get('status').textContent=button.textContent+' · Ready';
  } catch(error) {get('status').textContent=error.message;}
  finally {busy=false;buttons.forEach(item=>item.disabled=!text);}
});
async function initialize() {
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    sourceTab=tab;
    if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open a regular webpage and select text. Chrome internal pages and PDFs may not allow access.');
    let results;
    try {
      // activeTab grants temporary access; inaccessible cross-origin frames are not scraped.
      results=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:readSelection});
    } catch {throw new Error('Chrome could not read this page. Select text in an accessible webpage and reopen the extension.');}
    text=chooseSelection(results);
    get('selection').textContent=text;
    buttons.forEach(button=>button.disabled=false);
    get('status').textContent='Choose how you want to understand this passage.';
  } catch(error) {get('selection').textContent='No selection available';get('status').textContent=error.message;}
  try {const {config}=await send({type:'QA_GET_CONFIG'});get('model').textContent='Model: '+config.model+(config.hasKey?'':' · Add your API key in Settings');} catch(error) {get('status').textContent=error.message;}
}
initialize();

get('workspace').addEventListener('click',async()=>{
  try{
    if(!Number.isInteger(sourceTab?.windowId))throw new Error('Wait for the page to load, then try again.');
    const opening=chrome.sidePanel.open({windowId:sourceTab.windowId});
    const offering=text ? send({type:'STUDY_OFFER',windowId:sourceTab.windowId,source:{sourceText:text,pageTitle:sourceTab.title,pageUrl:sourceTab.url,action:'explain'}}) : Promise.resolve();
    await Promise.all([opening,offering]);
    get('status').textContent='Workspace opened. Use the selection there to start studying.';
  }catch(error){get('status').textContent=error.message||'Could not open the Side Panel.';}
});
