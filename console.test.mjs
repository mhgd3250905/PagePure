import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import {i18nSource, i18nChrome} from './i18n-support.mjs';

const source = readFileSync(new URL('./extension/console.js', import.meta.url), 'utf8');
function environment(bodyReady = true, options = {}) {
  const {document, window} = parseHTML('<html><body></body></html>');
  window.innerWidth = 1024; window.innerHeight = 768;
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
  if(options.i18n) context.PagePureI18n = options.i18n;
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
  assert.equal(env.root.querySelector('.brand-name').textContent,'网页净化');
  assert.equal(env.root.querySelector('.brand-seal-word').textContent,'净化');
  assert.equal(env.root.querySelector('.brand img'),null);
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

test('search-style body clearing and replacement restore the same console without duplicate handlers', async () => {
  const env = environment();
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const host = env.document.querySelector('[data-jev-ui="console"]');
  const launcher = env.root.querySelector('.launcher');
  const left = host.style.left, top = host.style.top;
  launcher.click();
  env.document.body.replaceChildren(env.document.createElement('main'));
  await settle();
  assert.equal(host.parentNode, env.document.body);
  assert.equal(host.style.left, left);
  assert.equal(host.style.top, top);
  assert.equal(env.root.querySelector('iframe'), null, 'discard the old page settings panel');
  const replacement = env.document.createElement('body');
  env.document.body.replaceWith(replacement);
  await settle();
  assert.equal(host.parentNode, replacement);
  host.remove();
  await settle();
  assert.equal(host.parentNode, replacement);
  assert.equal(env.document.querySelectorAll('[data-jev-ui="console"]').length, 1);
  launcher.click();
  assert.equal(env.root.querySelectorAll('iframe').length, 1);
  launcher.click();
  assert.equal(env.root.querySelector('iframe'), null);
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

test('original-page toggle remains and obsolete undo button is absent', async () => {
  const env = await popupEnvironment();
  assert.equal(env.document.querySelector('#undoSave'),null);
  for (const action of ['toggleVisibility']) {
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

function pointer(env,type,x,y) {
  const event = new env.window.Event(type,{cancelable:true});
  Object.assign(event,{pointerId:1,button:0,isPrimary:true,clientX:x,clientY:y});
  env.root.querySelector('.launcher').dispatchEvent(event);
}
function physicalClick(env) {
  const event = new env.window.Event('click',{cancelable:true});
  event.detail = 1;
  env.root.querySelector('.launcher').dispatchEvent(event);
}
test('floating seal drags without opening and ordinary click still toggles',()=>{
  const env = environment();
  const host = env.document.querySelector('[data-jev-ui="console"]');
  pointer(env,'pointerdown',30,700);
  pointer(env,'pointermove',400,200);
  pointer(env,'pointerup',400,200);
  physicalClick(env);
  assert.equal(host.style.left,'386px');
  assert.equal(host.style.top,'188px');
  assert.equal(env.root.querySelector('iframe'),null);
  pointer(env,'pointerdown',400,200);
  pointer(env,'pointerup',400,200);
  physicalClick(env);
  assert.ok(env.root.querySelector('iframe'));
});
test('cancelled gestures do not open the panel and keyboard click remains available',()=>{
  const env = environment();
  pointer(env,'pointerdown',20,700);
  pointer(env,'pointercancel',20,700);
  physicalClick(env);
  assert.equal(env.root.querySelector('iframe'),null);
  const keyboard = new env.window.Event('click'); keyboard.detail = 0;
  env.root.querySelector('.launcher').dispatchEvent(keyboard);
  assert.ok(env.root.querySelector('iframe'));
});
test('dragging and resizing keep the seal and open panel within the viewport',()=>{
  const env = environment();
  pointer(env,'pointerdown',20,700);
  pointer(env,'pointermove',5000,-5000);
  pointer(env,'pointerup',5000,-5000);
  physicalClick(env);
  const host = env.document.querySelector('[data-jev-ui="console"]');
  assert.equal(host.style.left,'960px'); assert.equal(host.style.top,'0px');
  env.root.querySelector('.launcher').click();
  env.window.innerWidth=320; env.window.innerHeight=260;
  env.window.dispatchEvent(new env.window.Event('resize'));
  const panel = env.root.querySelector('.panel');
  assert.equal(host.style.left,'256px');
  assert.equal(panel.style.left,'8px'); assert.equal(panel.style.top,'8px');
  assert.equal(panel.style.width,'304px'); assert.equal(panel.style.height,'244px');
});
test('seal localizes after initial settings load and on live locale changes',async()=>{
  let language = '净化', resolve;
  const ready = new Promise(done=>{resolve=done;});
  const env = environment(true,{i18n:{t:key=>key==='toolbarStamp'?language:`${language} ${key}`,ready}});
  const word=env.root.querySelector('.seal-word');
  assert.equal(word.textContent,'净化'); assert.equal(word.style.fontSize,'18px');
  language='Clean'; resolve(); await ready;
  assert.equal(word.textContent,'Clean'); assert.equal(word.style.fontSize,'12px');
  assert.equal(env.root.querySelector('.brand-name').textContent,'Clean brandName');
  assert.equal(env.root.querySelector('.brand-seal-word').textContent,'Clean');
  language='净化'; env.document.dispatchEvent(new env.window.Event('pagepure-locale-changed'));
  assert.equal(word.textContent,'净化');
  assert.equal(env.root.querySelector('.launcher').getAttribute('aria-label'),'净化 consoleLauncherAria');
});
