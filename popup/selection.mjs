// Serialized by chrome.scripting: no dependencies or page modifications.
export function readSelection() {
  const active = document.activeElement;
  if (active?.matches('input, textarea, [contenteditable], [role="textbox"]')) return '';
  return String(window.getSelection() || '').slice(0, 12001);
}
export function chooseSelection(results) {
  const texts = [...new Set(results.map(item => item.result).filter(text => typeof text === 'string' && text.trim()).map(text => text.trim()))];
  if (texts.length !== 1) throw new Error(texts.length ? 'More than one frame has selected text. Clear the other selection and reopen.' : 'Select text on the page, then reopen the extension.');
  if (texts[0].length > 12000) throw new Error('Select a shorter passage (up to 12,000 characters).');
  return texts[0];
}
