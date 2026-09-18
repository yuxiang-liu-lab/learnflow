import {createStudyWorkspace, installStudyMenus} from './study-workspace.mjs';
import {validateSelection, understandSelection} from './understand.mjs';
import {DEFAULT_MODEL, AssistantError, validateQuestion, analyzeQuestion} from './openai.mjs';
import {DEFAULT_AUDIO_MODEL, analyzeAudio} from './audio.mjs';

const storageReady = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
storageReady.catch(() => console.error('[LearnFlow] Storage isolation failed'));
const jobs = new Map();
const cache = new Map();
let revision = 0;
let positionWrites = Promise.resolve();
const isPanel = sender => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('sidepanel/panel.html');
const isPopup = sender => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup/popup.html');
const isOptions = sender => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options/options.html');
const isQuiz = sender => {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)) return false;
  try {
    const url = new URL(sender.url);
    return url.origin === 'https://cnow.apps.ng.cengage.com' && url.pathname.startsWith('/ilrn/takeAssignment/');
  } catch { return false; }
};
const frameKey = sender => `${sender.tab.id}:${sender.frameId}:${sender.documentId || ''}`;
const error = (code, message) => { throw new AssistantError(code, message); };
function cancelAll() {
  revision++;
  workspace?.cancel();
  for (const job of jobs.values()) job.controller.abort();
  jobs.clear(); cache.clear();
}
async function getConfig() {
  await storageReady;
  return chrome.storage.local.get({apiKey: '', model: DEFAULT_MODEL, audioModel:DEFAULT_AUDIO_MODEL});
}
function publicConfig(config) { return {hasKey: !!config.apiKey, model: config.model, audioModel:config.audioModel}; }

const workspace = chrome.storage.session ? createStudyWorkspace({storage:chrome.storage.session,getConfig,notify:windowId=>{chrome.runtime.sendMessage({type:'STUDY_CHANGED',windowId}).catch(()=>{});}}) : null;
if(workspace && chrome.contextMenus) {
  installStudyMenus(chrome,workspace);
  chrome.windows.onRemoved.addListener(id=>workspace.remove(id).catch(()=>{}));
}
async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') error('MESSAGE_INVALID', 'Invalid request.');
  if ((isPanel(sender)||isPopup(sender)) && message.type.startsWith('STUDY_')) {
    if(!workspace) error('INTERNAL','Study workspace unavailable. Reload the extension.');
    return workspace.handle(message);
  }
  if(isPanel(sender)) {
    if(message.type==='QA_GET_CONFIG') return {config:publicConfig(await getConfig())};
    if(message.type==='QA_OPEN_SETTINGS') {await chrome.runtime.openOptionsPage();return {};}
    error('MESSAGE_INVALID','Unsupported panel request.');
  }
  if (isPopup(sender)) {
    if (message.type === 'QA_GET_CONFIG') return {config:publicConfig(await getConfig())};
    if (message.type === 'QA_OPEN_SETTINGS') {await chrome.runtime.openOptionsPage(); return {};}
    if (message.type !== 'UA_ANALYZE') error('MESSAGE_INVALID', 'Unsupported Understand request.');
    const selection = validateSelection(message.selection);
    const config = await getConfig();
    if (!config.apiKey) error('KEY_MISSING', 'Open Settings and add your OpenAI API key.');
    const key = 'understand-popup';
    if (jobs.has(key)) error('BUSY', 'An explanation is already running. Wait a moment and try again.');
    const controller = new AbortController();
    const rev = revision;
    const job = {controller};
    jobs.set(key, job);
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const result = await understandSelection(selection, config, controller.signal);
      if (controller.signal.aborted || revision !== rev) error('CANCELLED', 'Settings changed or the request timed out. Please try again.');
      return {...result, model:config.model};
    } finally {
      clearTimeout(timeout);
      if (jobs.get(key) === job) jobs.delete(key);
    }
  }
  if (isOptions(sender)) {
    if (message.type === 'QA_GET_CONFIG') return {config: publicConfig(await getConfig())};
    if (message.type === 'QA_SAVE_CONFIG') {
      const model = typeof message.model === 'string' ? message.model.trim() : '';
      const apiKey = typeof message.apiKey === 'string' ? message.apiKey.trim() : '';
      const audioModel = typeof message.audioModel === 'string' ? message.audioModel.trim() : (await getConfig()).audioModel;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(audioModel)) error('CONFIG_INVALID', 'Enter a valid audio model name.');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)) error('CONFIG_INVALID', 'Enter a valid model name.');
      if (apiKey && (!apiKey.startsWith('sk-') || /\s/.test(apiKey) || apiKey.length > 1024)) error('CONFIG_INVALID', 'Enter an OpenAI API key starting with sk-.');
      await storageReady;
      await chrome.storage.local.set({...apiKey ? {apiKey} : {}, model, audioModel});
      cancelAll();
      return {config: publicConfig(await getConfig())};
    }
    if (message.type === 'QA_CLEAR_KEY') {
      await storageReady; await chrome.storage.local.remove('apiKey'); cancelAll();
      return {config: publicConfig(await getConfig())};
    }
  }
  if (!isQuiz(sender)) error('SENDER_INVALID', 'Request is not from the supported quiz frame or extension settings.');
  if (message.clientVersion !== chrome.runtime.getManifest().version) error('CONTEXT_STALE', 'Content script version is stale. Reload the Cengage tab.');
  if (message.type === 'QA_HELLO') return {version:chrome.runtime.getManifest().version, frameId:sender.frameId, origin:new URL(sender.url).origin};
  if (message.type === 'QA_GET_POSITION') {
    await storageReady;
    await positionWrites;
    const {panelPosition} = await chrome.storage.local.get({panelPosition:null});
    // Return only presentation state, never the storage object or credentials.
    return {position: panelPosition && Number.isFinite(panelPosition.x) && Number.isFinite(panelPosition.y) ? {x:panelPosition.x,y:panelPosition.y} : null};
  }
  if (message.type === 'QA_SAVE_POSITION') {
    const point = message.position;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > 100000 || point.y > 100000) error('POSITION_INVALID', 'Invalid panel position.');
    const position = {x:point.x,y:point.y};
    positionWrites = positionWrites.catch(() => {}).then(async () => {
      await storageReady; await chrome.storage.local.set({panelPosition:position});
    });
    await positionWrites;
    return {};
  }
  if (message.type === 'QA_OPEN_SETTINGS') {await chrome.runtime.openOptionsPage(); return {};}
  if (message.type === 'QA_CANCEL') {
    const job = jobs.get(frameKey(sender));
    if (job && job.requestId === message.requestId) job.controller.abort();
    return {};
  }
  if (message.type !== 'QA_ANALYZE') error('MESSAGE_INVALID', 'Unsupported request.');
  if (typeof message.requestId !== 'string' || message.requestId.length > 100) error('MESSAGE_INVALID', 'Invalid request identifier.');
  const question = validateQuestion(message.question);
  const config = await getConfig();
  if (!config.apiKey) error('KEY_MISSING', 'Open Settings and add your OpenAI API key, then choose Analyze again.');
  const rev = revision;
  const key = frameKey(sender);
  const fingerprint = JSON.stringify([rev, config.model, config.audioModel, question]);
  const previous = jobs.get(key);
  if (previous?.fingerprint === fingerprint && !previous.controller.signal.aborted) return previous.promise;
  if (previous) previous.controller.abort();
  const cacheKey = `${key}:${fingerprint}`;
  if (!question.audio && !message.force && cache.has(cacheKey)) return {suggestion: cache.get(cacheKey), model: config.model};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), question.audio ? 55000 : 25000);
  const job = {controller, fingerprint, requestId:message.requestId};
  job.promise = (async () => {
    console.info('[LearnFlow] Sending analysis request');
    try {
      const result = question.audio ? await analyzeAudio(question, config, controller.signal) : {suggestion:await analyzeQuestion(question, config, controller.signal)};
      if (controller.signal.aborted || revision !== rev) error('CANCELLED', 'Request cancelled. Analyze again with the current settings.');
      if (!question.audio) cache.set(cacheKey, result.suggestion);
      while (cache.size > 20) cache.delete(cache.keys().next().value);
      console.info('[LearnFlow] Analysis completed');
      return {...result, model:question.audio ? config.audioModel : config.model};
    } finally {
      clearTimeout(timeout);
      if (jobs.get(key) === job) jobs.delete(key);
    }
  })();
  jobs.set(key, job);
  return job.promise;
}
// The toolbar popup exposes Understand, Practice guidance and shared Settings.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(result => respond({ok:true, ...result})).catch(cause => {
    const safe = cause instanceof AssistantError ? {code:cause.code, message:cause.message} : {code:'INTERNAL', message:'Extension operation failed. Reload the extension and try again.'};
    console.warn('[LearnFlow]', safe.code);
    respond({ok:false, error:safe, ...(cause instanceof AssistantError && cause.diagnostics ? {diagnostics:cause.diagnostics} : {})});
  });
  return true;
});
