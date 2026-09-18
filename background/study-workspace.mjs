import {AssistantError} from './openai.mjs';
import {understandConversation} from './understand.mjs';
import {createSessionStore,offerSelection,replaceContext,beginTurn,finishTurn} from './study-session.mjs';
export function createStudyWorkspace({storage,getConfig,notify=()=>{},analyze=understandConversation}) {
  const store=createSessionStore(storage),jobs=new Map();
  async function update(id,fn) {const state=await store.update(id,fn);notify(id);return state;}
  return {
    async handle(message) {
      const id=message.windowId;
      if(!Number.isInteger(id)||id<0)throw new AssistantError('STUDY_INVALID','Invalid browser window.');
      if(message.type==='STUDY_GET')return {state:await store.update(id,state=>state.busy&&!jobs.has(id)?{...state,busy:false,turn:null,error:'The previous request was interrupted. Please try again.'}:state)};
      if(message.type==='STUDY_OFFER')return {state:await update(id,state=>offerSelection(state,message.source))};
      if(message.type==='STUDY_REPLACE')return {state:await update(id,replaceContext)};
      if(message.type==='STUDY_NOTICE')return {state:await update(id,state=>({...state,error:state.error||'Could not use that selection. Select 1–12,000 characters on a regular webpage and try again.'}))};
      if(message.type==='STUDY_DISMISS')return {state:await update(id,state=>({...state,pending:null}))};
      if(message.type!=='STUDY_RUN')throw new AssistantError('MESSAGE_INVALID','Unsupported study request.');
      if(jobs.has(id))throw new AssistantError('BUSY','A response is already running.');
      const controller=new AbortController();jobs.set(id,controller);
      const timeout=setTimeout(()=>controller.abort(),25000);
      try {
        const config=await getConfig();
        if(!config.apiKey)throw new AssistantError('KEY_MISSING','Open Settings and add your OpenAI API key.');
        const started=await update(id,state=>beginTurn(state,message));
        const result=await analyze(started,config,controller.signal);
        if(controller.signal.aborted)throw new AssistantError('CANCELLED','Request cancelled or timed out. Please try again.');
        return {state:await update(id,state=>state.id===started.id?finishTurn(state,{...result,model:config.model}):state)};
      } catch(cause) {
        const error=cause instanceof AssistantError?cause.message:'The explanation failed. Please try again.';
        if(!controller.closed)await update(id,state=>({...state,busy:false,turn:null,error}));
        throw cause;
      } finally {clearTimeout(timeout);if(jobs.get(id)===controller)jobs.delete(id);}
    },
    cancel() {for(const controller of jobs.values())controller.abort();},
    async remove(id) {const job=jobs.get(id);if(job){job.closed=true;job.abort();}await store.remove(id);}
  };
}
export function installStudyMenus(api,workspace) {
  const actions={explain:'Explain',simple:'Explain simply',summarize:'Summarize'};
  api.runtime.onInstalled.addListener(()=>{
    api.contextMenus.removeAll(()=>{
      api.contextMenus.create({id:'study',title:'LearnFlow',contexts:['selection'],documentUrlPatterns:['http://*/*','https://*/*']});
      for(const [action,title] of Object.entries(actions))api.contextMenus.create({id:'study-'+action,parentId:'study',title,contexts:['selection']});
    });
  });
  api.contextMenus.onClicked.addListener((info,tab)=>{
    const action=String(info.menuItemId).replace('study-','');
    if(!Object.hasOwn(actions,action)||!Number.isInteger(tab?.windowId)||!info.selectionText||info.editable)return;
    // Call directly in the user gesture, before asynchronous work.
    const opened=api.sidePanel.open({windowId:tab.windowId});
    const source={sourceText:info.selectionText,action,pageTitle:tab.title,pageUrl:info.frameUrl||info.pageUrl||tab.url};
    opened.then(async()=>{
      const {state}=await workspace.handle({type:'STUDY_OFFER',windowId:tab.windowId,source});
      if(!state.source){await workspace.handle({type:'STUDY_REPLACE',windowId:tab.windowId});await workspace.handle({type:'STUDY_RUN',windowId:tab.windowId,action});}
    }).catch(()=>workspace.handle({type:'STUDY_NOTICE',windowId:tab.windowId}).catch(()=>{}));
  });
}
