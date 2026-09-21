'use strict';
if (new URLSearchParams(location.search).get('embedded') === '1') {
  document.body.classList.add('embedded');
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.parent.postMessage({type:'jev-console-close'}, '*');
  });
}
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
async function request(type, payload, timeoutMs = 0) {
  let timer;
  const response = chrome.runtime.sendMessage({type, ...(payload ? {payload} : {})});
  let result;
  try {
    result = timeoutMs ? await Promise.race([response, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('连接超时，请重新连接；若仍失败，请在扩展管理页重新加载 PagePure 后刷新网页')), timeoutMs);
    })]) : await response;
  } finally { if (timer !== undefined) clearTimeout(timer); }
  if (!result?.ok) throw new Error(result?.error || '请求失败，请重试');
  return result.data;
}
function showKeyState(value) {
  configured = Boolean(value);
  keyState.textContent = configured ? '已配置' : '未配置';
  key.placeholder = configured ? '已保存；填写新密钥可替换' : '填写你的 API Key';
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
      pageStatus.textContent = '打开网页查看净化状态';
      return;
    }
    pageStatus.textContent = state.error ? `判断失败：${state.error}` : state.reason ? state.reason : `已隐藏 ${state.hidden || 0} 块 · 待判断 ${state.pending || 0} 块`;
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
      showMessage(next ? '已开启，点击上方按钮选择内容' : '已关闭，网页内容已恢复');
      await refreshStatus();
    } catch (error) { enabled.checked = !next; throw error; }
  });
});
document.querySelector('#settings').addEventListener('submit', event => {
  event.preventDefault();
  const goal = context.value.trim();
  if (!goal) { showMessage('请填写你希望保留的内容', true); context.focus(); return; }
  perform(async () => {
    const payload = {enabled: enabled.checked, aiEnabled: aiEnabled.checked, context: goal};
    if (key.value.trim()) payload.key = key.value.trim();
    const saved = await request('configSet', payload);
    showKeyState(saved?.configured ?? (Boolean(payload.key) || configured));
    key.value = '';
    showMessage(!enabled.checked ? '已保存，网页净化已关闭' : !configured && aiEnabled.checked ? '已保存；手动选择可直接使用，AI 判断还需配置密钥' : '已保存，当前网页将自动更新');
    await refreshStatus();
  });
});
clearKey.addEventListener('click', () => perform(async () => {
  await request('keyClear'); key.value = ''; showKeyState(false); showMessage('密钥已清除'); await refreshStatus();
}));
document.querySelector('#retry').addEventListener('click', () => perform(async () => {
  await request('retry'); showMessage('已请求重新判断当前页面'); await refreshStatus();
}));
document.querySelector('#preview').addEventListener('click', () => perform(async () => {
  const saved = await request('configGet');
  if (!saved.enabled) throw new Error('请开启网页净化并保存，再选择内容');
  await request('pageAction', {action: 'preview'});
  showMessage('已进入选择模式，点选不想看的内容');
  if (new URLSearchParams(location.search).get('embedded') === '1') {
    window.parent.postMessage({type: 'jev-console-close'}, '*');
  } else window.close();
}));

for (const [action, message] of [['toggleVisibility', '已切换显示效果，再次点击可切换回来'], ['undoSave', '已撤销上次保存']]) {
  document.querySelector(`#${action}`).addEventListener('click', () => perform(async () => {
    await request('pageAction', {action});
    showMessage(message);
    await refreshStatus();
  }));
}
document.querySelector('#manageRules').addEventListener('click', () => perform(async () => {
  await request('rulesManagerOpen');
  if(new URLSearchParams(location.search).get('embedded')==='1')window.parent.postMessage({type:'jev-console-close'}, '*');
}));

document.querySelector('#clearRules').addEventListener('click', () => perform(async () => {
  await request('pageAction', {action: 'clearRules'});
  showMessage('已清除适用于本页的类别规则及旧版选块规则');
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
  showMessage('正在读取设置…');
  pageStatus.textContent = '正在读取页面状态…';
  try {
    const config = await request('configGet', undefined, 8000);
    enabled.checked = Boolean(config.enabled);
    aiEnabled.checked = Boolean(config.aiEnabled);
    context.value = config.context || '';
    if(config.origin)document.querySelector('label[for="context"]').textContent=`此网站的自动净化需求（${new URL(config.origin).hostname}）`;
    showKeyState(config.configured);
    controls.disabled = false;
    showMessage(config.enabled ? '' : '网页净化已关闭');
    const poll = async () => { await refreshStatus(); statusTimer = setTimeout(poll, 2000); };
    await poll();
  } catch (error) {
    showMessage(`无法读取设置：${error.message}`, true);
    pageStatus.textContent = '尚未连接到 PagePure';
    reconnect.hidden = false;
  } finally { initializing = false; }
}
reconnect.addEventListener('click', initialize);
initialize();
