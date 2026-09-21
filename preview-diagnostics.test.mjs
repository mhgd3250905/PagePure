import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import {i18nSource, i18nChrome} from './i18n-support.mjs';

const manualSource = readFileSync(new URL('./extension/manual.js', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('./extension/preview.js', import.meta.url), 'utf8');
const blocksSource = readFileSync(new URL('./extension/blocks.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };

async function environment(initialGroups = [], body = null, options = {}) {
  const {document, window} = parseHTML(body || '<html><body><main><article id="reading"><a href="/read">Reading</a></article><aside id="promotion"><a href="/advert">Promotion</a></aside></main></body></html>');
  const initialUrl=new URL(options.url || 'https://example.com/articles/123');
  Object.defineProperty(document, 'location', {value: {href: initialUrl.href, pathname: initialUrl.pathname}});
  const calls = [], stored = new Map(initialGroups.map(group => [group.key, group])), shadows = [];
  let listener, mutation, timerId = 0, suspended = 0, resumed = 0;
  const timers = new Map();
  window.HTMLElement.prototype.getBoundingClientRect = function() {
    return {x:20, y:80, top:80, left:20, right:320, bottom:280, width:300, height:200};
  };
  const create = document.createElement.bind(document);
  document.createElement = (...args) => {
    const node = create(...args), attach = node.attachShadow.bind(node);
    node.attachShadow = options => { const shadow = attach(options); shadows.push(shadow); return shadow; };
    return node;
  };
  const context = {
    requestAnimationFrame:options.requestAnimationFrame, cancelAnimationFrame:options.cancelAnimationFrame,
    document, window, URL, getComputedStyle:node=>({position:node.style.position||'static'}), innerWidth:1280, innerHeight:900,
    addEventListener:window.addEventListener.bind(window),
    removeEventListener:window.removeEventListener.bind(window),
    JevPage: {suspend() {suspended++;}, resume() {resumed++;}},
    JevZhihu: {describe(node) {options.onDescribe?.(node);return {text:node.textContent,role:node.tagName,structural:node.querySelector('iframe,img') ? 'media' : ''};}, collect() {options.onCollect?.();return [...document.querySelectorAll('article, aside, .Pc-card')];}},
    setTimeout(callback) {timers.set(++timerId, callback); return timerId;},
    clearTimeout(id) {timers.delete(id);},
    MutationObserver: class {constructor(callback) {mutation = callback;} observe(_target,config) {options.onObserve?.(config);}},
    chrome: {...i18nChrome, runtime: {
      onMessage: {addListener(callback) {listener = callback;}},
      async sendMessage(message) {
        if (message.type === 'i18nGet') return {ok: true, data: {}};
        calls.push(message);
        if (message.type === 'configGet') return {ok: true, data: {enabled: true, aiEnabled:true, configured:true,splitExperienceAvailable:!!options.experience,...options.config}};
        const payload = message.payload;
        if(message.type==='splitBlock')return options.split?options.split(payload):{ok:true,data:{ids:payload.blocks.map(b=>b.id)}};
        if(message.type==='snapshotGet')return {ok:true,data:{entries:options.snapshotStore?.get(payload.key+'\n'+payload.revision)||options.snapshots||[]}};
        if(message.type==='snapshotSet'){
          if(options.snapshotSet)return options.snapshotSet(payload);
          options.snapshotStore?.set(payload.key+'\n'+payload.revision,JSON.parse(JSON.stringify(payload.entries)));
          return {ok:true,data:{}};
        }
        if(message.type==='classifyCategories'&&options.classify)return options.classify(payload);
        if (message.type === 'classifyCategories') return {ok:true,data:{results:payload.blocks.map(block=>({id:block.id,category:/unknown/i.test(block.text) ? 'other' : block.structural==='media' || /sponsored/i.test(block.text) ? 'advertisement' : block.role==='ASIDE' ? 'promotion' : 'content_feed',confidence:0.95})),errors:[]}};
        if (message.type === 'rulesGet') {
          if(options.rulesGetError?.())throw new Error('Rules unavailable');
          if(options.rulesGetWait)await options.rulesGetWait();
          return {ok: true, data: {groups: payload.keys.map(key => stored.get(key)).filter(Boolean)}};
        }
        if (message.type === 'rulesSet') {
          assert.match(payload.key, /^https:\/\/example\.com\|(?:site|type:|page:)/, 'backend scope contract');
          if (payload.rules.length || payload.partitions?.length) stored.set(payload.key, {key: payload.key, rules: payload.rules, partitions:payload.partitions||[]});
          else stored.delete(payload.key);
          return {ok: true, data: {}};
        }
        if (message.type === 'rulesDelete') {payload.keys.forEach(key => stored.delete(key)); return {ok:true, data:{}};}
        throw new Error(`Unexpected message ${message.type}`);
      }
    }}
  };
  runInNewContext(i18nSource, context);
  runInNewContext(manualSource, context);
  if(options.realCollect){const describe=context.JevZhihu.describe;runInNewContext(blocksSource,context);context.JevZhihu.describe=describe;}
  runInNewContext(previewSource, context);
  await settle();
  return {
    document, context, calls, stored,
    get ui() {return document.querySelector('[data-jev-ui="preview"]')?.shadowRoot;},
    get layer() {return document.querySelector('[data-jev-ui="selection-layer"]')?.shadowRoot;},
    get suspended() {return suspended;}, get resumed() {return resumed;},
    async start() {await context.JevPreview.start(); await settle();},
    async click(node) {const event = new window.Event('click', {bubbles:true, cancelable:true, composed:true}); node.dispatchEvent(event); await settle(); return event;},
    async action(action) {const response = await new Promise(resolve => listener({type:'pageAction', action}, {}, resolve)); await settle(); return response;},
    async notify(type,extra={}) {listener({type,...extra},{},()=>{});await settle();},
    async mutate(changes) {mutation(changes||[{type:'childList', target:document.querySelector('main')}]); const work = [...timers.values()]; timers.clear(); work.forEach(callback => callback()); await settle();}
  };
}


test('diagnostics records successful marking, restored state and caps entries without sending logs',async()=>{
 const env=await environment();await env.start();await env.click(env.document.querySelector('#promotion'));
 for(let i=0;i<23;i++)await env.click(env.ui.querySelector(i%2?'#q-keep':'#q-hide'));
 const log=JSON.parse(env.ui.querySelector('#diagnostic-log').value);
 assert.equal(log.length,20);assert.equal(log.at(-1).result,'draft-marked');assert.equal(log.at(-1).targetMatched,true);
 assert.equal(log.at(-2).result,'not-marked');assert.equal(log.at(-1).mode,'editing');
 assert.ok(env.ui.querySelector('#diagnostic-log').hasAttribute('readonly'));
 assert.equal(env.calls.some(c=>/diagnostic/i.test(c.type)),false);
 await env.click(env.ui.querySelector('#collapse'));
 const collapsed=JSON.parse(env.ui.querySelector('#diagnostic-log').value).at(-1);
 assert.equal(collapsed.action,'collapse-toggle');assert.equal(collapsed.collapsed,true);assert.equal(collapsed.previewHideAttribute,true);
 await env.click(env.ui.querySelector('#cancel'));await env.start();
 assert.equal(JSON.parse(env.ui.querySelector('#diagnostic-log').value).length,20);
});
test('diagnostics explains positional rejection and related restore rules without URL scopes or content',async()=>{
 const env=await environment([{key:'https://example.com|page:/articles/123',rules:[{selector:'#promotion',action:'keep',label:'secret label'}]}]);
 await env.start();await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#q-hide'));
 let log=JSON.parse(env.ui.querySelector('#diagnostic-log').value).at(-1);
 assert.equal(log.result,'not-marked');assert.equal(log.reason,'related-keep-rules');assert.equal(log.relatedKeeps[0].scope,'page');
 env.context.JevManual.describeRule=()=>({selector:'main > aside:nth-of-type(1)',label:'secret label'});
 await env.click(env.ui.querySelector('#q-hide'));
 log=JSON.parse(env.ui.querySelector('#diagnostic-log').value).at(-1);
 assert.equal(log.result,'selector-rejected');assert.equal(log.reason,'positional-selector');assert.equal(log.matchedCount,1);
 assert.doesNotMatch(env.ui.querySelector('#diagnostic-log').value,/https:|secret label|Promotion/);
});
