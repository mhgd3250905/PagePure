import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import {i18nSource, i18nChrome} from './i18n-support.mjs';

const source = readFileSync(new URL('./extension/console.js', import.meta.url), 'utf8');
function environment(bodyReady = true) {
  const {document, window} = parseHTML('<html><body></body></html>');
  let root;
  const attach = window.HTMLElement.prototype.attachShadow;
  window.HTMLElement.prototype.attachShadow = function(options) {
    assert.equal(options.mode, 'closed');
    return root = attach.call(this, options);
  };
  let ready = bodyReady;
  const contentDocument = new Proxy(document, {get(target, key) {
    if (key === 'body' && !ready) return null;
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  const context = {document:contentDocument, window, chrome:{...i18nChrome, runtime:{getURL:path => `chrome-extension://test/${path}`}}};
  runInNewContext(i18nSource, context);
  const run = () => runInNewContext(source, context);
  run();
  return {document, window, run, get root() {return root;}, ready() {
    ready = true;
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }};
}

test('floating console is isolated, lazy, toggleable, and removes iframe on close', () => {
  const env = environment();
  const host = env.document.querySelector('[data-jev-ui="console"]');
  assert.ok(host);
  assert.equal(host.shadowRoot, null);
  const launcher = env.root.querySelector('.launcher');
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');
  assert.equal(env.root.querySelector('iframe'), null);
  launcher.click();
  const frame = env.root.querySelector('iframe');
  assert.equal(frame.getAttribute('src'), 'chrome-extension://test/popup.html?embedded=1');
  assert.equal(launcher.getAttribute('aria-expanded'), 'true');
  env.root.querySelector('.close').click();
  assert.equal(env.root.querySelector('iframe'), null);
  launcher.click();
  assert.notEqual(env.root.querySelector('iframe'), frame);
  launcher.click();
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');
  env.run();
  assert.equal(env.document.querySelectorAll('[data-jev-ui="console"]').length, 1);
});

test('document_start waits for body and Escape collapses the console', () => {
  const env = environment(false);
  assert.equal(env.root, undefined);
  env.ready();
  env.root.querySelector('.launcher').click();
  const escape = new env.window.Event('keydown');
  escape.key = 'Escape';
  env.document.dispatchEvent(escape);
  assert.equal(env.root.querySelector('iframe'), null);
  assert.equal(env.root.querySelector('.launcher').getAttribute('aria-expanded'), 'false');
});

async function popupEnvironment(config = {}) {
  const html = readFileSync(new URL('./extension/popup.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./extension/popup.js', import.meta.url), 'utf8');
  const {document, window} = parseHTML(html);
  const requests = [], messages = [];
  const runtime = {sendMessage: async message => {
    requests.push(message);
    if (message.type === 'configGet') return {ok:true, data:{enabled:true, aiEnabled:false, context:'保留正文', configured:false,...config}};
    if (message.type === 'statusGet') return {ok:true, data:{hidden:0, pending:0}};
    return {ok:true, data:{configured:false}};
  }};
  const context = {
    document, chrome:{...i18nChrome, runtime}, URLSearchParams, location:{search:'?embedded=1'},
    window:{parent:{postMessage: message => messages.push(message)}}, setTimeout:() => 0, clearTimeout:() => {}
  };
  runInNewContext(i18nSource, context);
  runInNewContext(source, context);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  return {document, window, requests, messages, flush};
}

test('configured category preview dispatches and closes the embedded panel', async () => {
  const env = await popupEnvironment({aiEnabled:true,configured:true});
  assert.equal(env.document.querySelector('#aiEnabled').checked, true);
  assert.equal(env.document.querySelector('#preview').textContent, '选择要隐藏的内容');
  assert.equal(env.document.querySelector('#controls').disabled, false);
  env.document.querySelector('#preview').click();
  await env.flush();
  assert.equal(env.requests.at(-1).type, 'pageAction');
  assert.equal(env.requests.at(-1).payload.action, 'preview');
  assert.equal(env.messages.at(-1).type, 'jev-console-close');
});

test('disabled preview keeps settings open and explains requirement', async () => {
  for (const [config,expected] of [
    [{enabled:false},'开启网页净化并保存']
  ]) {
    const env = await popupEnvironment(config);
    env.document.querySelector('#preview').click();
    await env.flush();
    assert.equal(env.requests.some(message=>message.type==='pageAction'),false);
    assert.equal(env.messages.length,0);
    assert.ok(env.document.querySelector('#status').textContent.includes(expected));
    assert.equal(env.document.querySelector('#controls').disabled,false);
  }
});

test('AI opt-in is saved separately and manual rules can be cleared', async () => {
  const env = await popupEnvironment();
  env.document.querySelector('#aiEnabled').checked = true;
  env.document.querySelector('#settings').dispatchEvent(new env.window.Event('submit', {cancelable:true}));
  await env.flush();
  const saved = env.requests.find(message => message.type === 'configSet').payload;
  assert.equal(saved.enabled, true);
  assert.equal(saved.aiEnabled, true);
  assert.equal('key' in saved, false);
  assert.match(env.document.querySelector('#status').textContent,/手动选择可直接使用/);
  env.document.querySelector('#clearRules').click();
  await env.flush();
  assert.ok(env.requests.some(message => message.type === 'pageAction' && message.payload.action === 'clearRules'));
  assert.match(env.document.querySelector('#status').textContent,/适用于本页的净化规则/);
});

test('manual preview works without a key or AI consent and advanced settings start collapsed', async () => {
  const env = await popupEnvironment();
  assert.equal(env.document.querySelector('details').hasAttribute('open'), false);
  env.document.querySelector('#preview').click();
  await env.flush();
  assert.ok(env.requests.some(message => message.type === 'pageAction' && message.payload.action === 'preview'));
  assert.equal(env.messages.at(-1).type, 'jev-console-close');
});

test('restore and undo buttons dispatch their page actions', async () => {
  const env = await popupEnvironment();
  for (const action of ['toggleVisibility', 'undoSave']) {
    env.document.querySelector(`#${action}`).click();
    await env.flush();
    assert.ok(env.requests.some(message => message.type === 'pageAction' && message.payload.action === action));
  }
});

test('master switch saves immediately without saving draft AI settings', async () => {
  const env = await popupEnvironment();
  env.document.querySelector('#aiEnabled').checked = true;
  env.document.querySelector('#enabled').checked = false;
  env.document.querySelector('#enabled').dispatchEvent(new env.window.Event('change'));
  await env.flush();
  const saved = env.requests.find(message => message.type === 'configSet').payload;
  assert.equal(saved.enabled, false);
  assert.equal(saved.aiEnabled, false);
});

test('embedded console opens the dedicated rule manager and closes its panel',async()=>{
 const env=await popupEnvironment();
 env.document.querySelector('#manageRules').click();await env.flush();
 assert.ok(env.requests.some(message=>message.type==='rulesManagerOpen'));
 assert.equal(env.messages.at(-1).type,'jev-console-close');
});
