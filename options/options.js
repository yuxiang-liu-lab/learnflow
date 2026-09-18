'use strict';
const byId = id => document.getElementById(id);
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error?.message || 'Settings unavailable. Reload the extension.');
  return response.config;
}
function render(config) {
  byId('model').value = config.model;
  byId('audio-model').value = config.audioModel;
  byId('key-status').textContent = config.hasKey ? 'API key saved. Leave the field blank to keep it.' : 'No API key saved.';
}
async function run(action) {
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach(button => button.disabled = true);
  try {await action();} catch (cause) {byId('status').textContent = cause.message || 'Settings operation failed.';}
  finally {buttons.forEach(button => button.disabled = false);}
}
byId('settings').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const config = await send({type:'QA_SAVE_CONFIG', apiKey:byId('key').value, model:byId('model').value, audioModel:byId('audio-model').value});
    byId('key').value = ''; render(config);
    byId('status').textContent = 'Settings saved. Return to the quiz and choose Analyze again.';
  });
});
byId('remove').addEventListener('click', () => run(async () => {
  render(await send({type:'QA_CLEAR_KEY'})); byId('key').value = '';
  byId('status').textContent = 'Saved key removed. Active requests cancelled.';
}));
run(async () => render(await send({type:'QA_GET_CONFIG'})));
