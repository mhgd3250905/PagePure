'use strict';
if (new URLSearchParams(location.search).get('embedded') === '1') {
  document.body.classList.add('embedded');
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.parent.postMessage({type:'jev-console-close'}, '*');
  });
}
const {t} = globalThis.PagePureI18n;
globalThis.PagePureI18n.ready.then(() => {
  globalThis.PagePureI18n.applyStatic();
  const word=document.querySelector('.brand-seal-word');
  const length=[...word.textContent].length;
  word.style.fontSize=(length<=2?10:Math.min(8,28/(length*.65)))+'px';
});
const manifestVersion=chrome.runtime.getManifest?.().version;
if(manifestVersion)document.querySelector('#version').textContent=manifestVersion;
const controls = document.querySelector('#controls');
const enabled = document.querySelector('#enabled');
const aiEnabled = document.querySelector('#aiEnabled');
const context = document.querySelector('#context');
const key = document.querySelector('#key');
const keyState = document.querySelector('#keyState');
const clearKey = document.querySelector('#clearKey');
const status = document.querySelector('#status');
const pageStatus = document.querySelector('#pageStatus');
let configured = false;
let savedContext = '';
async function request(type, payload, timeoutMs = 0) {
  let timer;
  const response = chrome.runtime.sendMessage({type, ...(payload ? {payload} : {})});
  let result;
  try {
    result = timeoutMs ? await Promise.race([response, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(t('popupErrorTimeout'))), timeoutMs);
    })]) : await response;
  } finally { if (timer !== undefined) clearTimeout(timer); }
  if (!result?.ok) throw new Error(result?.error || t('popupErrorRequest'));
  return result.data;
}
function showKeyState(value) {
  configured = Boolean(value);
  keyState.textContent = t(configured ? 'popupKeyStateOn' : 'popupKeyStateOff');
  key.placeholder = t(configured ? 'popupKeyPlaceholderSaved' : 'popupKeyPlaceholder');
  clearKey.disabled = !configured;
}
function showMessage(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}
async function refreshStatus() {
  try {
    const state = await request('statusGet', undefined, 8000);
    if (!state || (state.hidden == null && state.pending == null && !state.error)) {
      pageStatus.textContent = t('popupStatusNoPage');
      return;
    }
    pageStatus.textContent = state.error ? t('popupStatusFail', state.error) : state.reason ? state.reason : t('popupStatusHidden', state.hidden || 0, state.pending || 0);
  } catch (error) { pageStatus.textContent = error.message; }
}
async function perform(action) {
  controls.disabled = true;
  try { await action(); }
  catch (error) { showMessage(error.message, true); }
  finally { controls.disabled = false; clearKey.disabled = !configured; }
}
enabled.addEventListener('change', () => {
  const next = enabled.checked;
  perform(async () => {
    try {
      const saved = await request('configGet');
      await request('configSet', {enabled:next, aiEnabled:Boolean(saved.aiEnabled), context:saved.context || ''});
      showMessage(t(next ? 'popupEnabledOn' : 'popupEnabledOff'));
      await refreshStatus();
    } catch (error) { enabled.checked = !next; throw error; }
  });
});
document.querySelector('#settings').addEventListener('submit', event => {
  event.preventDefault();
  const goal = context.value === savedContext ? savedContext : context.value.trim();
  // Keep custom wording intact; the blocking-list format is a suggested template.
  if (context.value !== savedContext && (!goal || /^\u5c4f\u853d\s*[:\uff1a][\s\u3001\uff0c,]*$/.test(goal))) {
    showMessage(t('popupContextFormat'), true); context.focus(); return;
  }
  perform(async () => {
    const payload = {enabled: enabled.checked, aiEnabled: aiEnabled.checked, context: goal};
    if (key.value.trim()) payload.key = key.value.trim();
    const saved = await request('configSet', payload);
    savedContext = context.value = goal;
    showKeyState(saved?.configured ?? (Boolean(payload.key) || configured));
    key.value = '';
    showMessage(!enabled.checked ? t('popupSavedOff') : !configured && aiEnabled.checked ? t('popupSavedManual') : t('popupSavedOn'));
    await refreshStatus();
  });
});
clearKey.addEventListener('click', () => perform(async () => {
  await request('keyClear'); key.value = ''; showKeyState(false); showMessage(t('popupKeyCleared')); await refreshStatus();
}));
document.querySelector('#retry').addEventListener('click', () => perform(async () => {
  await request('retry'); showMessage(t('popupRetried')); await refreshStatus();
}));
document.querySelector('#preview').addEventListener('click', () => perform(async () => {
  const saved = await request('configGet');
  if (!saved.enabled) throw new Error(t('popupErrorEnableFirst'));
  await request('pageAction', {action: 'preview'});
  showMessage(t('popupEnteringSelection'));
  if (new URLSearchParams(location.search).get('embedded') === '1') {
    window.parent.postMessage({type: 'jev-console-close'}, '*');
  } else window.close();
}));

for (const [action, message] of [['toggleVisibility', 'popupToggledVisibility']]) {
  document.querySelector(`#${action}`).addEventListener('click', () => perform(async () => {
    await request('pageAction', {action});
    showMessage(t(message));
    await refreshStatus();
  }));
}
document.querySelector('#manageRules').addEventListener('click', () => perform(async () => {
  await request('rulesManagerOpen');
  if(new URLSearchParams(location.search).get('embedded')==='1')window.parent.postMessage({type:'jev-console-close'}, '*');
}));

document.querySelector('#clearRules').addEventListener('click', () => perform(async () => {
  await request('pageAction', {action: 'clearRules'});
  showMessage(t('popupClearedPageRules'));
  await refreshStatus();
}));
const reconnect = document.querySelector('#reconnect');
let initializing = false, statusTimer;
async function initialize() {
  if (initializing) return;
  initializing = true;
  reconnect.hidden = true;
  controls.disabled = true;
  if (statusTimer !== undefined) clearTimeout(statusTimer);
  showMessage(t('popupStatusLoading'));
  pageStatus.textContent = t('popupPageStatusLoading');
  try {
    const config = await request('configGet', undefined, 8000);
    enabled.checked = Boolean(config.enabled);
    aiEnabled.checked = Boolean(config.aiEnabled);
    context.value = config.context || '';
    savedContext = context.value;
    if(config.origin)document.querySelector('label[for="context"]').textContent=t('popupContextSiteHost', new URL(config.origin).hostname);
    showKeyState(config.configured);
    controls.disabled = false;
    showMessage(config.enabled ? '' : t('statusPurifierOff'));
    const poll = async () => { await refreshStatus(); statusTimer = setTimeout(poll, 2000); };
    await poll();
  } catch (error) {
    showMessage(t('popupErrorLoadSettings', error.message), true);
    pageStatus.textContent = t('popupNotConnected');
    reconnect.hidden = false;
  } finally { initializing = false; }
}
reconnect.addEventListener('click', initialize);
globalThis.PagePureI18n.ready.then(initialize);
