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

const feedPage = '<html><body><main><article id="sports"><a href="/sports">Sports score</a></article><article id="ad">Sponsored cloud service</article><article id="technology">Technology news</article><aside id="promotion">Creator service</aside></main></body></html>';
const selected = (env, id) => env.document.querySelector(`#${id}`).hasAttribute('data-jev-selected');
const hidden = (env, id) => env.document.querySelector(`#${id}`).hasAttribute('data-jev-manual-hidden');
const overlay = (env, index) => env.layer.querySelectorAll('button')[index];

test('selection stays manual without automatic classification or category controls',async()=>{
 const env=await environment([],feedPage,{experience:true});await env.start();
 for(const id of ['same','correct','correction','assign','manual-category','categories'])assert.equal(env.ui.querySelector('#'+id),null);
 const event=await env.click(env.document.querySelector('#sports a'));
 assert.equal(event.defaultPrevented,true);assert.equal(selected(env,'sports'),false);
 await env.click(env.ui.querySelector('#q-hide'));
 assert.equal(selected(env,'sports'),true);assert.equal(selected(env,'technology'),false);
 env.document.querySelector('main').insertAdjacentHTML('beforeend','<article id="late">Another story</article>');await env.mutate();
 assert.equal(selected(env,'late'),false);
 await env.click(env.ui.querySelector('#q-save'));
 const rules=env.calls.find(c=>c.type==='rulesSet').payload.rules;
 assert.equal(rules.length,1);assert.equal(rules[0].selector,'#sports');assert.equal(rules[0].category,undefined);
 assert.equal(env.calls.some(c=>['classifyCategories','snapshotGet','snapshotSet','splitBlock'].includes(c.type)),false);
});

test('legacy category rules and snapshots are inert without passive scans or hidden content',async()=>{
 let scans=0,descriptions=0;
 const rules=[{category:'promotion',overrides:['#promotion']},{category:'content_feed'},{selector:'#ad',action:'hide'}];
 const env=await environment([{key:'https://example.com|site',rules}],feedPage,{experience:true,onCollect:()=>scans++,onDescribe:()=>descriptions++,snapshots:[{signature:'old',category:'promotion'}]});
 assert.equal(hidden(env,'ad'),true);assert.equal(hidden(env,'promotion'),false);assert.equal(hidden(env,'sports'),false);
 env.document.querySelector('main').insertAdjacentHTML('beforeend','<aside id="late">New promotion</aside>');await env.mutate();
 assert.equal(hidden(env,'late'),false);assert.equal(scans,0);assert.equal(descriptions,0);
 assert.equal(env.document.querySelectorAll('[data-jev-awaiting]').length,0);
 assert.equal(env.calls.some(c=>['classifyCategories','snapshotGet','snapshotSet','splitBlock'].includes(c.type)),false);
 await env.start();await env.click(env.ui.querySelector('#cancel'));
 assert.equal(env.calls.some(c=>c.type==='rulesSet'),false,'opening and cancelling must not rewrite existing data');
 assert.equal(hidden(env,'ad'),true);
});

test('ambiguous ordinary hide never expands to a category rule',async()=>{
 const env=await environment([], '<html><body><main><article><div class="AdvertImg">Sponsored one</div><div class="AdvertImg">Sponsored two</div></article></main></body></html>');
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-split'));
 await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-hide'));
 assert.match(env.ui.querySelector('#status').textContent,/无法保存/);
 assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,0);
 await env.click(env.ui.querySelector('#q-save'));
 assert.equal(env.calls.find(c=>c.type==='rulesSet').payload.rules.length,0);
 assert.equal(env.document.querySelectorAll('[data-jev-manual-hidden]').length,0);
 assert.equal(env.calls.some(c=>c.type==='classifyCategories'),false);
});

test('original region toolbar retains actions without a standalone instruction panel',async()=>{
 const env=await environment();await env.start();
 assert.equal(env.ui.querySelectorAll('[role="toolbar"]').length,1);
 assert.equal(env.ui.querySelector('.box'),null);
 assert.equal(env.ui.querySelector('#quick').hidden,true);
 assert.equal(env.ui.querySelector('#selection').hidden,true);
 await env.click(env.document.querySelector('#promotion'));
 assert.equal(env.ui.querySelector('#selection').hidden,false);
 await env.click(env.ui.querySelector('#effect'));
 assert.equal(env.ui.querySelector('#quick').hidden,false);
 assert.equal(env.ui.querySelector('#effect').textContent,'返回选择');
 await env.click(env.ui.querySelector('#q-save'));
 assert.ok(env.calls.some(c=>c.type==='rulesSet'));
 assert.equal(env.ui,undefined);
 const next=await environment();await next.start();await next.click(next.ui.querySelector('#cancel'));
 assert.equal(next.ui,undefined);
 assert.equal(next.calls.some(c=>c.type==='rulesSet'),false);
});

test('collapsing draft hidden regions keeps editing available and expanding preserves draft rules',async()=>{
 const env=await environment([],feedPage);await env.start();
 const collapsed=id=>env.document.querySelector('#'+id).hasAttribute('data-jev-preview-hide');
 await env.click(env.document.querySelector('#sports'));await env.click(env.ui.querySelector('#q-hide'));
 assert.equal(collapsed('sports'),false,'marking a region retains the initial editing display');
 await env.click(env.ui.querySelector('#collapse'));
 assert.equal(collapsed('sports'),true);
 assert.equal(env.ui.querySelector('#effect').textContent,'预览效果','collapse must not enter preview-only mode');
 await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#q-hide'));
 assert.equal(selected(env,'promotion'),true,'another region remains selectable while collapsed');
 assert.equal(collapsed('promotion'),true,'new hide actions also collapse immediately');
 await env.click(env.document.querySelector('#technology'));await env.click(env.ui.querySelector('#q-keep'));
 assert.equal(collapsed('technology'),false,'keep actions remain available during collapsed editing');
 await env.click(env.ui.querySelector('#collapse'));
 assert.equal(collapsed('sports'),false);assert.equal(collapsed('promotion'),false);
 assert.equal(selected(env,'sports'),true);assert.equal(selected(env,'promotion'),true);
 assert.equal(env.calls.some(c=>c.type==='rulesSet'),false,'collapse and expand do not save');
 await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#q-keep'));
 assert.equal(selected(env,'promotion'),false,'expanded regions can be restored');
 await env.click(env.ui.querySelector('#q-save'));
 const rules=env.calls.find(c=>c.type==='rulesSet').payload.rules;
 assert.ok(rules.some(rule=>rule.selector==='#sports'&&rule.action==='hide'));
 assert.equal(rules.some(rule=>rule.selector==='#promotion'&&rule.action==='hide'),false);
});

test('cancelling collapsed editing clears temporary hiding and preserves saved rules',async()=>{
 const initial={key:'https://example.com|site',rules:[{selector:'#promotion',action:'hide',label:'Promotion'}]};
 const env=await environment([initial]);await env.start();
 await env.click(env.document.querySelector('#reading'));await env.click(env.ui.querySelector('#q-hide'));
 await env.click(env.ui.querySelector('#collapse'));
 assert.equal(env.document.querySelector('#reading').hasAttribute('data-jev-preview-hide'),true);
 await env.click(env.ui.querySelector('#cancel'));
 assert.equal(env.ui,undefined);assert.equal(env.document.querySelectorAll('[data-jev-preview-hide]').length,0);
 assert.equal(hidden(env,'reading'),false);assert.equal(hidden(env,'promotion'),true);
 assert.equal(env.calls.some(c=>c.type==='rulesSet'),false);assert.deepEqual(env.stored.get(initial.key),initial);
});

test('saving while collapsed persists hidden regions and cleans temporary editing attributes',async()=>{
 const env=await environment();await env.start();
 await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#q-hide'));
 await env.click(env.ui.querySelector('#collapse'));await env.click(env.ui.querySelector('#q-save'));
 assert.equal(env.ui,undefined);assert.equal(env.document.querySelectorAll('[data-jev-preview-hide]').length,0);
 assert.equal(hidden(env,'promotion'),true);assert.equal(hidden(env,'reading'),false);
 const reopened=await environment([...env.stored.values()]);
 assert.equal(hidden(reopened,'promotion'),true);
});

test('explicit child hide survives inherited parent keep and leaves its siblings visible without AI',async()=>{
 for(const pageOnly of [false,true]) {
  const rules=[{category:'advertisement',label:'Ads'},{selector:'#A',action:'keep',label:'Keep A'},{selector:'#A1',action:'hide',label:'Hide A1',...(pageOnly?{page:'https://example.com|page:/articles/123'}:{})}];
  const env=await environment([{key:'https://example.com|site',rules}],'<html><body><main><article id="A"><article id="A1">Child one</article><article id="A2">Child two</article></article></main></body></html>',{realCollect:true,experience:true,classify:()=>new Promise(()=>{})});
  assert.equal(hidden(env,'A'),false);assert.equal(hidden(env,'A1'),true);assert.equal(hidden(env,'A2'),false);
  assert.equal(env.document.querySelectorAll('[data-jev-awaiting]').length,0);
  assert.equal(env.calls.filter(c=>['classifyCategories','splitBlock'].includes(c.type)).length,0);
 }
});

test('hidden parent covers new children while explicit child restoration still releases its parent',async()=>{
 const rules=[{selector:'#A',action:'hide',label:'Hide A'}];
 const body='<html><body><main><article id="A"><article id="A1">Child one</article><article id="A2">Child two</article></article></main></body></html>';
 const env=await environment([{key:'https://example.com|site',rules}],body,{realCollect:true});
 assert.equal(hidden(env,'A'),true);env.document.querySelector('#A').insertAdjacentHTML('beforeend','<article id="A3">New child</article>');await env.mutate();assert.equal(hidden(env,'A'),true);
 const restored=await environment([{key:'https://example.com|site',rules:[...rules,{selector:'#A1',action:'keep',label:'Restore A1'}]}],body,{realCollect:true});
 assert.equal(hidden(restored,'A'),false);assert.equal(hidden(restored,'A1'),false);
});

test('hiding a parent replaces contained local keep rules and persists actual hiding',async()=>{
 const body='<html><body><main><article id="A"><section id="A1">Child one</section><section id="A2">Child two</section></article><aside id="outside">Outside</aside></main></body></html>';
 for(const selector of ['#A1','article#A']) {
  const rules=[{selector,action:'keep',label:'Old restore'},{selector:'#outside',action:'keep',label:'Outside'}];
  const env=await environment([{key:'https://example.com|site',rules}],body);
  await env.start();await env.click(env.document.querySelector('#A'));await env.click(env.ui.querySelector('#q-hide'));
  assert.equal(selected(env,'A'),true,`${selector} must not silently defeat the new parent hide`);
  await env.click(env.ui.querySelector('#q-save'));
  const saved=env.calls.find(c=>c.type==='rulesSet').payload.rules;
  assert.equal(saved.some(rule=>rule.selector===selector&&rule.action==='keep'),false);
  assert.ok(saved.some(rule=>rule.selector==='#outside'&&rule.action==='keep'));
  assert.equal(hidden(env,'A'),true);
  const reopened=await environment([...env.stored.values()],body);
  assert.equal(hidden(reopened,'A'),true);
  assert.equal(hidden(reopened,'outside'),false);
 }
});

test('a keep from another scope is preserved and reports when parent hiding is blocked',async()=>{
 const body='<html><body><main><article id="A"><section id="A1">Child one</section><section id="A2">Child two</section></article></main></body></html>';
 const other={key:'https://example.com|page:/articles/123',rules:[{selector:'#A1',action:'keep',label:'Page restore'}]};
 const env=await environment([other],body);
 await env.start();await env.click(env.document.querySelector('#A'));await env.click(env.ui.querySelector('#q-hide'));
 assert.equal(selected(env,'A'),false);
 assert.match(env.ui.querySelector('#status').textContent,/当前区域未隐藏/);
 await env.click(env.ui.querySelector('#q-save'));
 assert.deepEqual(env.stored.get(other.key),other,'editing site rules must not remove another group’s keep');
 assert.equal(hidden(env,'A'),false);
});

test('scroll-style rescans never remove unchanged hidden attributes',async()=>{
 const env=await environment([{key:'https://example.com|site',rules:[{selector:'#promotion',label:'Promotion',action:'hide'}]}]);
 const node=env.document.querySelector('#promotion'),remove=node.removeAttribute.bind(node);let reveals=0;
 node.removeAttribute=name=>{if(name==='data-jev-manual-hidden')reveals++;return remove(name);};
 for(let i=0;i<4;i++){node.style.top=i+'px';await env.mutate();}
 assert.equal(hidden(env,'promotion'),true);assert.equal(reveals,0);
 // A site re-render that removes our marker is protected on the next mutation callback.
 remove('data-jev-manual-hidden');await env.mutate([{type:'attributes',attributeName:'data-jev-manual-hidden',target:node}]);assert.equal(hidden(env,'promotion'),true);
 await env.action('toggleVisibility');assert.equal(hidden(env,'promotion'),false);
});

test('rule refresh retains hidden content until new rules are available',async()=>{
 let wait=false,finish;
 const env=await environment([{key:'https://example.com|site',rules:[{selector:'#promotion',label:'Promotion',action:'hide'}]}],null,{rulesGetWait:()=>wait?new Promise(resolve=>finish=resolve):undefined});
 wait=true;await env.notify('rulesChanged');assert.equal(hidden(env,'promotion'),true);
 env.stored.set('https://example.com|site',{key:'https://example.com|site',rules:[{selector:'#promotion',label:'Promotion',action:'keep'}]});
 finish();await settle();assert.equal(hidden(env,'promotion'),false);
});

test('page-only hide overrides shared keep and survives reopening without affecting home or another question',async()=>{
 const shared={selector:'#promotion',label:'Promotion',action:'keep'};
 const env=await environment([{key:'https://example.com|site',rules:[shared]}],null,{url:'https://example.com/question/123',config:{aiEnabled:false}});
 await env.start();await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#q-page-hide'));
 assert.equal(selected(env,'promotion'),true);
 await env.click(env.ui.querySelector('#effect'));assert.equal(env.document.querySelector('#promotion').hasAttribute('data-jev-preview-hide'),true);
 await env.click(env.ui.querySelector('#save'));assert.equal(hidden(env,'promotion'),true);
 const groups=[...env.stored.values()],rules=groups[0].rules;
 assert.equal(rules.length,2);assert.ok(rules.some(r=>r.action==='keep'&&!r.page));
 assert.ok(rules.some(r=>r.page==='https://example.com|page:/question/123'&&r.action==='hide'));
 for(const url of ['https://example.com/','https://example.com/question/456']) {
   const other=await environment(groups,null,{url});assert.equal(hidden(other,'promotion'),false);
 }
 const reopened=await environment(groups,null,{url:'https://example.com/question/123'});assert.equal(hidden(reopened,'promotion'),true);
 reopened.document.location.href='https://example.com/';reopened.document.location.pathname='/';await reopened.mutate();assert.equal(hidden(reopened,'promotion'),false);
});

test('page-only restore overrides shared area hiding while other pages and removal keep shared behavior',async()=>{
 const env=await environment([{key:'https://example.com|site',rules:[{selector:'#promotion',label:'Promotion',action:'hide'}]}],null,{url:'https://example.com/'});
 assert.equal(hidden(env,'promotion'),true);
 await env.start();await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#page-keep'));
 assert.equal(selected(env,'promotion'),false);await env.click(env.ui.querySelector('#save'));assert.equal(hidden(env,'promotion'),false);
 const groups=[...env.stored.values()];
 const question=await environment(groups,null,{url:'https://example.com/question/123'});assert.equal(hidden(question,'promotion'),true);
 const reopened=await environment(groups,null,{url:'https://example.com/'});assert.equal(hidden(reopened,'promotion'),false);
 await reopened.start();const remove=[...reopened.ui.querySelector('#rule-list').children].find(b=>b.textContent.startsWith('仅当前页面恢复'));
 assert.ok(remove);await reopened.click(remove);assert.equal(selected(reopened,'promotion'),true);
 await reopened.click(reopened.ui.querySelector('#save'));assert.equal(hidden(reopened,'promotion'),true);
});

test('page-only edits cancel cleanly and a subsequent normal operation replaces the local exception only',async()=>{
 const rule={selector:'#promotion',label:'Promotion',action:'hide'};
 const other={...rule,page:'https://example.com|page:/question/456',action:'keep'};
 const env=await environment([{key:'https://example.com|site',rules:[rule,other]}]);
 await env.start();await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#page-keep'));await env.click(env.ui.querySelector('#cancel'));
 assert.equal(hidden(env,'promotion'),true);assert.equal(env.calls.some(c=>c.type==='rulesSet'),false);
 await env.start();await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#page-keep'));await env.click(env.ui.querySelector('#hide-area'));await env.click(env.ui.querySelector('#save'));
 const rules=[...env.stored.values()][0].rules;
 assert.equal(rules.length,2);assert.ok(rules.some(r=>r.page===other.page&&r.action==='keep'));assert.ok(rules.some(r=>!r.page&&r.action==='hide'));
 assert.equal(hidden(env,'promotion'),true);
});

test('ambiguous page-only hide never falls back to a shared category rule',async()=>{
 const env=await environment([], '<html><body><main><article>Sponsored one</article><article>Sponsored two</article></main></body></html>');
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#page-hide'));
 assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,0);
 assert.match(env.ui.querySelector('#status').textContent,/无法保存/);
 await env.click(env.ui.querySelector('#save'));assert.equal(env.calls.find(c=>c.type==='rulesSet').payload.rules.length,0);
});

test('hiding one child only on this page preserves shared parent keep alongside retired category rules',async()=>{
 const rules=[{category:'advertisement',label:'Ads'},{selector:'main',label:'Keep region',action:'keep'},{selector:'#promotion',label:'Only this child',action:'hide',page:'https://example.com|page:/articles/123'}];
 const env=await environment([{key:'https://example.com|site',rules}],null,{classify:()=>new Promise(()=>{})});
 assert.equal(hidden(env,'promotion'),true);assert.equal(hidden(env,'reading'),false);
 assert.equal(env.document.querySelector('#reading').hasAttribute('data-jev-awaiting'),false);
});

test('expand and shrink selection, hide stable section with future children',async()=>{
 const env=await environment([], '<html><body><main><div id="column"><article id="one">One</article><article id="two">Two</article></div><aside id="other">Other</aside></main></body></html>');
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#larger'));
 assert.ok(env.document.querySelector('#column').hasAttribute('data-jev-focus'));
 await env.click(env.ui.querySelector('#smaller'));assert.ok(env.document.querySelector('#one').hasAttribute('data-jev-focus'));
 await env.click(env.ui.querySelector('#larger'));await env.click(env.ui.querySelector('#hide-area'));
 await env.click(env.ui.querySelector('#save'));assert.equal(hidden(env,'column'),true);assert.equal(hidden(env,'other'),false);
 env.document.querySelector('#column').insertAdjacentHTML('beforeend','<article>New title</article>');await env.mutate();assert.equal(hidden(env,'column'),true);
});


test('quick toolbar resizes hides stamps and saves without exposing script text',async()=>{
 const env=await environment([], '<html><body><main><div id="unit"><article id="sample"><script>(adsbygoogle = window.adsbygoogle || []).push()</script><p>Visible card</p></article></div></main></body></html>');
 await env.start();await env.click(overlay(env,0));
 assert.equal(env.ui.querySelector('#quick').hidden,false);
 assert.doesNotMatch(env.ui.querySelector('#quick-name').textContent,/adsbygoogle/);
 await env.click(env.ui.querySelector('#q-larger'));assert.ok(env.document.querySelector('#unit').hasAttribute('data-jev-focus'));
 await env.click(env.ui.querySelector('#q-smaller'));assert.ok(env.document.querySelector('#sample').hasAttribute('data-jev-focus'));
 await env.click(env.ui.querySelector('#q-hide'));assert.equal(env.layer.querySelector('[data-mask]').textContent,'净化');
 await env.click(env.ui.querySelector('#q-save'));assert.equal(hidden(env,'sample'),true);assert.equal(env.ui,undefined);
 assert.doesNotMatch(env.calls.find(c=>c.type==='rulesSet').payload.rules[0].label,/adsbygoogle/);
});


test('seal stays in the visible portion of a tall region while scrolling',async()=>{
 const env=await environment();
 const node=env.document.querySelector('#promotion');
 node.getBoundingClientRect=()=>({left:900,top:20,right:1200,bottom:3020,width:300,height:3000});
 await env.start();await env.click(node);await env.click(env.ui.querySelector('#q-hide'));
 let seal=env.layer.querySelector('[data-purify-seal]');
 assert.equal(seal.style.left,'150px');assert.equal(seal.style.top,'440px');
 node.getBoundingClientRect=()=>({left:900,top:-2000,right:1200,bottom:1000,width:300,height:3000});
 await env.mutate();seal=env.layer.querySelector('[data-purify-seal]');
 assert.equal(seal.style.top,'2450px');
 assert.equal(seal.textContent,'净化');
});

test('mask covers sticky descendants outside the selected parent rectangle',async()=>{
 const env=await environment([], '<html><body><main><aside id="rail"><div id="sticky" style="position:sticky">Contents</div></aside></main></body></html>');
 const rail=env.document.querySelector('#rail'),sticky=env.document.querySelector('#sticky');
 rail.getBoundingClientRect=()=>({left:900,top:-400,right:1200,bottom:20,width:300,height:420});
 sticky.getBoundingClientRect=()=>({left:900,top:10,right:1200,bottom:310,width:300,height:300});
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#hide-area'));
 assert.match(env.layer.querySelector('[data-mask]').getAttribute('style'),/height:710px/);
 sticky.getBoundingClientRect=()=>({left:900,top:10,right:1200,bottom:410,width:300,height:400});
 await env.mutate();assert.match(env.layer.querySelector('[data-mask]').getAttribute('style'),/height:810px/);
});


test('smart split replaces parent region and keeps new regions on rescan',async()=>{
 const env=await environment([], '<html><body><main><article id="whole"><div id="first">First module</div><div id="second">Second module</div></article></main></body></html>');
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-split'));
 assert.equal(env.layer.querySelectorAll('button').length,2);
 assert.equal(env.calls.find(c=>c.type==='splitBlock').payload.parent.id,'parent');
 await env.mutate();assert.equal(env.layer.querySelectorAll('button').length,2);
 await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-hide'));await env.click(env.ui.querySelector('#q-save'));
 assert.equal(hidden(env,'first'),true);assert.equal(hidden(env,'second'),false);
});
test('split class-only service wrapper can be hidden and saved',async()=>{
 const env=await environment([], '<html><body><main><article><div class="Card"><div class="KfeCollection-CreateSaltCard"><div class="KfeCollection-CreateSaltCard-header">盐言作者平台</div><div class="KfeCollection-CreateSaltCard-button">去投稿</div></div></div><div class="Card"><div>其他模块</div></div></article></main></body></html>');
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-split'));
 await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-hide'));await env.click(env.ui.querySelector('#q-save'));
 const saved=env.calls.find(c=>c.type==='rulesSet');
 assert.ok(saved);assert.match(JSON.stringify(saved.payload.rules),/KfeCollection-CreateSaltCard/);
 assert.ok(env.document.querySelector('.KfeCollection-CreateSaltCard').parentElement.hasAttribute('data-jev-manual-hidden'));
});

test('uncertain split leaves original region intact',async()=>{
 const env=await environment([], '<html><body><main><article id="whole"><div>A</div><div>B</div></article></main></body></html>',{split:()=>({ok:true,data:{ids:[]}})});
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-split'));
 assert.equal(env.layer.querySelectorAll('button').length,1);assert.match(env.ui.querySelector('#status').textContent,/保留原区域/);
});

test('saved split boundaries survive fresh document and changed text without category classification',async()=>{
 const body='<html><body><main><aside id="sidebar"><div id="news">News module</div><div id="sponsor">Sponsored service</div></aside></main></body></html>';
 const env=await environment([],body);
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-split'));
 await env.click(overlay(env,1));await env.click(env.ui.querySelector('#q-hide'));await env.click(env.ui.querySelector('#q-save'));
 const groups=[...env.stored.values()];assert.equal(groups[0].partitions.length,1);
 const reload=await environment(groups,body.replace('News module','Updated news').replace('Sponsored service','Sponsored new campaign'));
 assert.equal(hidden(reload,'sidebar'),false);assert.equal(hidden(reload,'news'),false);assert.equal(hidden(reload,'sponsor'),true);
 const blocks=reload.calls.filter(c=>c.type==='classifyCategories').flatMap(c=>c.payload.blocks);
 assert.equal(blocks.length,0);
 await reload.start();assert.equal(reload.layer.querySelectorAll('button').length,2);
});

test('smart split stays discoverable without AI configuration',async()=>{
 const env=await environment([],null,{config:{aiEnabled:false,configured:false}});
 await env.start();await env.click(overlay(env,0));
 const split=env.ui.querySelector('#q-split');
 assert.equal(split.textContent,'智能拆分');
 assert.equal(split.hidden,false);
 assert.equal(split.closest('#more-actions'),null);
 await env.click(split);
 assert.match(env.ui.querySelector('#status').textContent,/配置密钥/);
 assert.equal(env.calls.some(c=>c.type==='splitBlock'),false);
});

test('manager clear notification closes stale selection drafts',async()=>{
 const env=await environment();await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-hide'));
 assert.ok(env.ui);
 await env.notify('rulesChanged', {source:'manager'});
 assert.equal(env.ui,undefined);assert.equal(env.calls.some(c=>c.type==='rulesSet'),false);
});

test('manual-only rules avoid classification collection at load and during page changes',async()=>{
 let scans=0;const env=await environment([{key:'https://example.com|site',rules:[{selector:'#promotion',label:'Promotion'}]}],null,{onCollect:()=>scans++});
 assert.equal(scans,0);assert.equal(hidden(env,'promotion'),true);
 await env.mutate();assert.equal(scans,0);assert.equal(hidden(env,'promotion'),true);
 await env.start();assert.ok(scans>0);
});

test('selection scroll positioning coalesces within a frame and resumes after reopen',async()=>{
 const frames=new Map();let serial=0;
 const env=await environment([],null,{requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id)});
 await env.start();let reads=0;const node=env.document.querySelector('#reading'),measure=node.getBoundingClientRect.bind(node);node.getBoundingClientRect=()=>{reads++;return measure();};
 const scroll=()=>env.context.window.dispatchEvent(new env.context.window.Event('scroll'));
 scroll();scroll();assert.equal(reads,0);assert.equal(frames.size,1);
 const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());assert.ok(reads>0);
 scroll();await env.click(env.ui.querySelector('#cancel'));assert.equal(frames.size,0);
 await env.start();scroll();assert.equal(frames.size,1);
});

test('split anonymous image card saves without position or campaign URL and reloads safely',async()=>{
 const body='<html><body><main><div class="Card"><img src="/feed.jpg"></div><article id="rail"><div class="Card"><span>Links</span></div><div class="Card"><img src="/campaign-123456.jpg"></div></article></main></body></html>';
 const env=await environment([],body);
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-split'));
 await env.click(overlay(env,1));await env.click(env.ui.querySelector('#q-hide'));
 await env.click(env.ui.querySelector('#q-save'));
 const saved=env.calls.find(c=>c.type==='rulesSet');assert.ok(saved);
 assert.equal(saved.payload.rules.length,1);
 assert.doesNotMatch(saved.payload.rules[0].selector,/:nth-|campaign/);
 const reload=await environment([...env.stored.values()],body.replace('/campaign-123456.jpg','/changed.jpg'));
 assert.ok(reload.document.querySelector('#rail img').parentElement.hasAttribute('data-jev-manual-hidden'));
 assert.equal(reload.document.querySelector('main > .Card').hasAttribute('data-jev-manual-hidden'),false);
});

test('ambiguous sibling adverts require explicit group confirmation and persist without classification',async()=>{
 const body='<html><body><main class="Topstory-container"><div class="Topstory-mainColumn"><div class="Pc-card Card"><a class="Banner-link"><div class="AdvertImg Banner-image"><img></div></a></div></div><div class="css-bkewaf"><div class="css-18888ld"><div class="Pc-card Card"><a class="Banner-link"><div class="AdvertImg Banner-image"><img></div></a></div><section>Following</section><div class="Pc-card Card"><a class="Banner-link"><div class="AdvertImg Banner-image"><img></div></a></div></div></div></main></body></html>';
 const env=await environment([],body);await env.start();
 const cards=env.document.querySelectorAll('.Pc-card');
 await env.click(cards[1]);await env.click(env.ui.querySelector('#q-hide'));
 assert.equal(env.ui.querySelector('#group-offer').hidden,false);
 assert.equal(env.document.querySelectorAll('[data-jev-group-offer]').length,2);
 assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,0);
 assert.match(env.ui.querySelector('#group-confirm').textContent,/2/);
 await env.click(env.ui.querySelector('#group-cancel'));
 assert.equal(env.document.querySelectorAll('[data-jev-group-offer]').length,0);
 await env.click(env.ui.querySelector('#q-hide'));await env.click(env.ui.querySelector('#group-confirm'));
 assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,2);
 assert.equal(cards[0].hasAttribute('data-jev-selected'),false);
 await env.click(env.ui.querySelector('#q-save'));
 const saved=env.calls.find(c=>c.type==='rulesSet');assert.equal(saved.payload.rules.length,1);
 assert.equal(env.calls.some(c=>c.type==='classifyCategories'||c.type==='splitBlock'),false);
 const reload=await environment([...env.stored.values()],body);
 assert.equal(reload.document.querySelectorAll('[data-jev-manual-hidden]').length,2);
 assert.equal(reload.document.querySelector('.Pc-card').hasAttribute('data-jev-manual-hidden'),false);
});

test('group confirmation refreshes its offer after matching siblings change',async()=>{
 const env=await environment([], '<html><body><aside id="rail"><div class="Pc-card Card"><a class="Banner-link"><img></a></div><div class="Pc-card Card"><a class="Banner-link"><img></a></div></aside></body></html>');
 await env.start();await env.click(overlay(env,1));await env.click(env.ui.querySelector('#q-hide'));
 const clone=env.document.querySelector('.Pc-card').cloneNode(true);clone.removeAttribute('data-jev-focus');clone.removeAttribute('data-jev-group-offer');env.document.querySelector('aside').append(clone);
 await env.click(env.ui.querySelector('#group-confirm'));
 assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,0);
 assert.match(env.ui.querySelector('#group-confirm').textContent,/3/);
 await env.click(env.ui.querySelector('#cancel'));
 assert.equal(env.document.querySelectorAll('[data-jev-group-offer]').length,0);
 assert.equal(env.calls.some(c=>c.type==='rulesSet'),false);
});

test('confirmed group hiding can be restored with the same explicit group confirmation',async()=>{
 const env=await environment([], '<html><body><main><div class="Pc-card Card"><a class="Banner-link"><img></a></div><div class="Pc-card Card"><a class="Banner-link"><img></a></div></main></body></html>');
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-hide'));await env.click(env.ui.querySelector('#group-confirm'));
 assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,2);
 await env.click(env.ui.querySelector('#q-keep'));
 assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,2);
 await env.click(env.ui.querySelector('#group-confirm'));
 assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,0);
 await env.click(env.ui.querySelector('#q-save'));
 assert.equal(env.document.querySelectorAll('[data-jev-manual-hidden]').length,0);
});
