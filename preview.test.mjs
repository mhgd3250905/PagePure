import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';

const manualSource = readFileSync(new URL('./extension/manual.js', import.meta.url), 'utf8');
const categoriesSource = readFileSync(new URL('./extension/categories.js', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('./extension/preview.js', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('./extension/layout-snapshot.js', import.meta.url), 'utf8');
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
    chrome: {runtime: {
      onMessage: {addListener(callback) {listener = callback;}},
      async sendMessage(message) {
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
  runInNewContext(manualSource, context);
  runInNewContext(layoutSource, context);
  runInNewContext(categoriesSource, context);
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

test('failed region discovery is reused across mutations and retried when identity changes', async () => {
  const env = await environment([{key:'https://example.com|site',rules:[{category:'advertisement'}]}],
    '<html><body><main><article class="Card">Sponsored one</article><article class="Card">Sponsored two</article></main></body></html>');
  const original = env.context.JevLayoutSnapshot.region;
  let attempts = 0;
  env.context.JevLayoutSnapshot.region = node => {attempts++; return original(node);};
  for (let i=0;i<5;i++) await env.mutate();
  assert.equal(attempts, 0, 'unchanged ambiguous regions must not repeat selector discovery');
  const node = env.document.querySelector('article');
  node.id = 'unique-ad';
  await env.mutate();
  assert.equal(attempts, 1);
  assert.ok(node.hasAttribute('data-jev-manual-hidden'));
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

test('confirmed parent remains the boundary when nested articles appear on reload and during scrolling',async()=>{
 const snapshotStore=new Map();
 const initial='<html><body><main><article class="AnswerCard" id="A"><p>Original answer</p></article><aside class="Sidebar" id="promotion">Promotion</aside></main></body></html>';
 const first=await environment([],initial,{snapshotStore,realCollect:true});await first.start();await first.click(first.document.querySelector('#promotion'));await first.click(first.ui.querySelector('#same'));await first.click(first.ui.querySelector('#save'));
 const changed=initial.replace('<p>Original answer</p>','<article id="A1">New inner content</article><section id="A2"><p>More content</p></section>');
 const next=await environment([...first.stored.values()],changed,{snapshotStore,realCollect:true,experience:true,classify:()=>new Promise(()=>{})});
 assert.equal(next.document.querySelectorAll('[data-jev-awaiting]').length,0);
 assert.equal(hidden(next,'promotion'),true);assert.equal(hidden(next,'A'),false);
 assert.equal(next.calls.filter(c=>['classifyCategories','splitBlock'].includes(c.type)).length,0);
 next.document.querySelector('#A').insertAdjacentHTML('beforeend','<article id="A3"><p>Added while scrolling</p></article>');await next.mutate();
 assert.equal(next.document.querySelectorAll('[data-jev-awaiting]').length,0);
 assert.equal(next.calls.filter(c=>['classifyCategories','splitBlock'].includes(c.type)).length,0);
 next.document.querySelector('main').insertAdjacentHTML('beforeend','<article id="outside">Unrelated new module</article>');await next.mutate();
 assert.ok(next.calls.some(c=>c.type==='classifyCategories'&&c.payload.blocks.some(b=>b.text==='Unrelated new module')));
 assert.equal(next.document.querySelector('#outside').hasAttribute('data-jev-awaiting'),true);
 assert.equal(next.document.querySelector('#A3').hasAttribute('data-jev-awaiting'),false);
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

test('saved manual partitions override an older coarse parent region snapshot',async()=>{
 const body='<html><body><main><article class="AnswerCard" id="A"><article id="A1">Reading</article><aside id="A2">Promotion</aside></article></main></body></html>';
 const seed=await environment([],body),region=seed.context.JevLayoutSnapshot.region(seed.document.querySelector('#A'));
 const groups=[{key:'https://example.com|site',rules:[{category:'promotion',label:'Promotion'}],partitions:[{parent:'#A',parts:['#A1','#A2']}]}];
 const env=await environment(groups,body,{realCollect:true,snapshots:[{signature:'region-v1:'+JSON.stringify(region),category:'content_feed'}]});
 assert.equal(hidden(env,'A1'),false);assert.equal(hidden(env,'A2'),true);
 assert.ok(env.calls.some(c=>c.type==='classifyCategories'&&c.payload.blocks.some(b=>b.text==='Promotion')));
});

test('an ancestor snapshot cannot swallow saved partitions deeper inside it',async()=>{
 const body='<html><body><main><article class="AnswerCard" id="A"><div id="B"><article id="B1">Reading</article><aside id="B2">Promotion</aside></div></article></main></body></html>';
 const seed=await environment([],body),region=seed.context.JevLayoutSnapshot.region(seed.document.querySelector('#A'));
 const groups=[{key:'https://example.com|site',rules:[{category:'promotion',label:'Promotion'}],partitions:[{parent:'#B',parts:['#B1','#B2']}]}];
 const env=await environment(groups,body,{realCollect:true,snapshots:[{signature:'region-v1:'+JSON.stringify(region),category:'content_feed'}]});
 assert.equal(hidden(env,'B1'),false);assert.equal(hidden(env,'B2'),true);
});

test('a manually corrected child remains independent of a confirmed parent region',async()=>{
 const body='<html><body><main><article class="AnswerCard" id="A"><article id="A1">Child corrected by user</article><article id="A2">Ordinary child</article></article></main></body></html>';
 const seed=await environment([],body),region=seed.context.JevLayoutSnapshot.region(seed.document.querySelector('#A'));
 const groups=[{key:'https://example.com|site',rules:[{category:'advertisement',label:'Ads',overrides:['#A1']},{selector:'#A',label:'Parent',action:'keep'}]}];
 const env=await environment(groups,body,{realCollect:true,experience:true,snapshots:[{signature:'region-v1:'+JSON.stringify(region),category:'content_feed'}],classify:()=>new Promise(()=>{})});
 assert.equal(hidden(env,'A1'),true);assert.equal(hidden(env,'A2'),false);assert.equal(hidden(env,'A'),false);
 assert.equal(env.calls.filter(c=>['classifyCategories','splitBlock'].includes(c.type)).length,0);
});

test('saved page regions reveal answer during hydration without waiting for classification or automatic splitting',async()=>{
 const snapshotStore=new Map();
 const completed='<html><body><main class="QuestionPage"><article class="Card AnswerCard" id="answer"><div class="AnswerItem"><h2>Title</h2><p>Answer content</p><div class="Voting"><button>514 votes</button></div></div></article><aside class="Sidebar" id="promotion"><div class="Services">Promotion</div></aside></main></body></html>';
 const first=await environment([],completed,{snapshotStore});await first.start();await first.click(first.document.querySelector('#promotion'));await first.click(first.ui.querySelector('#same'));await first.click(first.ui.querySelector('#save'));
 assert.ok([...snapshotStore.values()][0].some(e=>e.signature.startsWith('region-v1:')));
 const loading='<html><body><div class="HydrationWrapper"><main class="QuestionPage"><article class="Card AnswerCard css-loading" id="answer"><div class="Skeleton">Loading answer</div></article><aside class="Sidebar" id="promotion"><div>Loading services</div></aside></main></div></body></html>';
 let observed;
 const next=await environment([...first.stored.values()],loading,{snapshotStore,experience:true,onObserve:config=>observed=config,classify:()=>new Promise(()=>{})});
 assert.equal(next.document.querySelector('#answer').hasAttribute('data-jev-awaiting'),false);
 assert.equal(hidden(next,'answer'),false);assert.equal(hidden(next,'promotion'),true);
 assert.equal(next.calls.filter(c=>['classifyCategories','splitBlock'].includes(c.type)).length,0);
 next.document.querySelector('#answer').innerHTML='<div class="AnswerItem"><p>Hydrated body</p><img src="new.jpg"><div class="NewActions"><button>Changed count</button></div></div>';
 await next.mutate();assert.equal(next.document.querySelector('#answer').hasAttribute('data-jev-awaiting'),false);
 assert.equal(next.calls.filter(c=>['classifyCategories','splitBlock'].includes(c.type)).length,0);
 for(const attr of ['role','data-testid','data-test','data-component'])assert.ok(observed.attributeFilter.includes(attr));
 next.document.querySelector('#answer').setAttribute('role','dialog');
 await next.mutate([{type:'attributes',attributeName:'role',target:next.document.querySelector('#answer')}]);
 assert.ok(next.calls.some(c=>['classifyCategories','splitBlock'].includes(c.type)));
});

test('page region snapshots cannot leak into a different answer with the same type and selectors',async()=>{
 const snapshotStore=new Map(),body='<html><body><main><article id="reading"><p>Reading</p></article><aside id="promotion">Promotion</aside></main></body></html>';
 const first=await environment([],body,{snapshotStore});await first.start();await first.click(first.document.querySelector('#promotion'));await first.click(first.ui.querySelector('#same'));await first.click(first.ui.querySelector('#save'));
 const next=await environment([...first.stored.values()],body,{url:'https://example.com/articles/456',snapshotStore,classify:()=>new Promise(()=>{})});
 assert.equal(next.document.querySelector('#reading').hasAttribute('data-jev-awaiting'),true);
 assert.ok(next.calls.some(c=>c.type==='classifyCategories'));
});

test('unchanged module descriptions are built once per application and own marker mutations do not rescan',async()=>{
 let descriptions=0;
 const env=await environment([{key:'https://example.com|site',rules:[{category:'promotion',label:'Promotion'}]}],null,{onDescribe:()=>descriptions++});
 descriptions=0;await env.mutate();assert.ok(descriptions<=2,`one apply per mutation batch for two nodes, received ${descriptions}`);
 descriptions=0;await env.mutate([{type:'attributes',attributeName:'data-jev-manual-hidden',target:env.document.querySelector('#promotion')}]);assert.equal(descriptions,0);
});

test('scroll-style rescans never remove unchanged hidden attributes',async()=>{
 const env=await environment([{key:'https://example.com|site',rules:[{category:'promotion',label:'Promotion'}]}]);
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

test('changed hidden content stays collapsed until reclassification explicitly restores it',async()=>{
 let finish,delayed=false;
 const env=await environment([{key:'https://example.com|site',rules:[{category:'promotion',label:'Promotion'}]}],null,{classify:payload=>delayed?new Promise(resolve=>finish=()=>resolve({ok:true,data:{results:payload.blocks.map(b=>({id:b.id,category:'content_feed'}))}})):{ok:true,data:{results:payload.blocks.map(b=>({id:b.id,category:b.role==='ASIDE'?'promotion':'content_feed'}))}}});
 assert.equal(hidden(env,'promotion'),true);delayed=true;env.document.querySelector('#promotion').textContent='Replacement module';env.document.querySelector('#promotion').className='DifferentModule';await env.mutate();
 assert.equal(hidden(env,'promotion'),true);finish();await settle();assert.equal(hidden(env,'promotion'),false);
});

test('reclassification failure releases previously hidden recycled content',async()=>{
 let fail=false,reject;
 const env=await environment([{key:'https://example.com|site',rules:[{category:'promotion',label:'Promotion'}]}],null,{classify:payload=>fail?new Promise((_,r)=>reject=r):{ok:true,data:{results:payload.blocks.map(b=>({id:b.id,category:b.role==='ASIDE'?'promotion':'content_feed'}))}}});
 fail=true;env.document.querySelector('#promotion').textContent='Replacement';env.document.querySelector('#promotion').className='DifferentModule';await env.mutate();assert.equal(hidden(env,'promotion'),true);
 reject(new Error('offline'));await settle();assert.equal(hidden(env,'promotion'),false);
});

test('save persists hide and keep layouts before closing, then changed titles render without model calls',async()=>{
 const snapshotStore=new Map();
 const body='<html><body><main class="home"><article class="FeedCard" id="reading"><a href="/old">Old story</a></article><aside class="Sidebar" id="promotion">Old promotion</aside></main></body></html>';
 const first=await environment([],body,{snapshotStore});
 await first.start();await first.click(first.document.querySelector('#promotion'));await first.click(first.ui.querySelector('#same'));
 await first.click(first.ui.querySelector('#save'));
 assert.equal(first.ui,undefined);assert.equal(snapshotStore.size,1);
 const entries=[...snapshotStore.values()][0];
 assert.ok(entries.some(e=>e.category==='content_feed'));assert.ok(entries.some(e=>e.category==='promotion'));
 const next=await environment([...first.stored.values()],body.replace('Old story','New story').replace('/old','/new').replace('Old promotion','New promotion'),{snapshotStore,classify:()=>{throw new Error('Unexpected classification');}});
 assert.equal(next.calls.filter(c=>c.type==='classifyCategories').length,0);
 assert.equal(hidden(next,'reading'),false);assert.equal(hidden(next,'promotion'),true);
 assert.equal(next.document.querySelectorAll('[data-jev-awaiting]').length,0);
 next.document.querySelector('#reading').insertAdjacentHTML('afterend','<article class="FeedCard" id="late"><a href="/later">Another story</a></article>');
 await next.mutate();assert.equal(next.document.querySelector('#late').hasAttribute('data-jev-awaiting'),false);
 assert.equal(next.calls.filter(c=>c.type==='classifyCategories').length,0);
});

test('save stays open until snapshot persistence completes and reports persistence failure',async()=>{
 let finish;
 const env=await environment([],null,{snapshotSet:()=>new Promise(resolve=>finish=resolve)});
 await env.start();await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#same'));await env.click(env.ui.querySelector('#save'));
 assert.ok(env.ui);assert.equal(env.ui.querySelector('#save').disabled,true);
 finish({ok:false,error:'storage failed'});await settle();
 assert.ok(env.ui);assert.equal(env.ui.querySelector('#save').disabled,false);assert.match(env.ui.querySelector('#status').textContent,/快照/);
 await env.click(env.ui.querySelector('#save'));finish({ok:true,data:{}});await settle();assert.equal(env.ui,undefined);
});

test('conflicting categories sharing a layout do not classify changed cards from that layout',async()=>{
 const snapshotStore=new Map();
 const body='<html><body><main class="home"><article class="Card" id="reading">Reading</article><article class="Card" id="ad">Sponsored service</article></main></body></html>';
 const first=await environment([],body,{snapshotStore});await first.start();await first.click(first.document.querySelector('#ad'));await first.click(first.ui.querySelector('#same'));await first.click(first.ui.querySelector('#save'));
 const next=await environment([...first.stored.values()],body.replace('Reading','New reading').replace('Sponsored service','New sponsored service').replace('id="reading"','id="new-reading"').replace('id="ad"','id="new-ad"'),{snapshotStore,classify:()=>new Promise(()=>{})});
 assert.equal(next.document.querySelectorAll('[data-jev-awaiting]').length,2);
 assert.ok(next.calls.some(c=>c.type==='classifyCategories'));
});

test('save cannot report snapshot success when rule refresh fails',async()=>{
 let fail=false;
 const env=await environment([],null,{rulesGetError:()=>fail});await env.start();await env.click(env.document.querySelector('#promotion'));await env.click(env.ui.querySelector('#same'));
 fail=true;await env.click(env.ui.querySelector('#save'));
 assert.ok(env.ui);assert.equal(env.ui.querySelector('#save').disabled,false);
 assert.equal(env.calls.filter(c=>c.type==='snapshotSet').length,0);
 fail=false;await env.click(env.ui.querySelector('#save'));assert.equal(env.ui,undefined);
});

test('layout conflict markers survive cache capacity pressure',async()=>{
 const body='<html><body><main class="home"><article class="Card" id="reading">Reading</article><article class="Card" id="ad">Sponsored service</article></main></body></html>';
 const seed=await environment([],body);const key=seed.context.JevLayoutSnapshot.key(seed.document.querySelector('#reading'));
 const snapshots=[{signature:key,category:'other'},...Array.from({length:199},(_,i)=>({signature:'old-'+i,category:'content_feed'}))];
 const env=await environment([{key:'https://example.com|site',rules:[{category:'advertisement'}]}],body,{snapshots});
 await env.mutate();
 const writes=env.calls.filter(c=>c.type==='snapshotSet');assert.ok(writes.length);
 assert.ok(writes.at(-1).payload.entries.some(e=>e.signature===key&&e.category==='other'));
});

test('default site save retains categories absent from current page',async()=>{
 const rules=[{category:'hot_search',label:'热榜'}];
 const env=await environment([{key:'https://example.com|site',rules}],feedPage);
 await env.start();assert.equal(env.ui.querySelector('#scope').value,'site');
 await env.click(env.document.querySelector('#ad'));await env.click(env.ui.querySelector('#same'));await env.click(env.ui.querySelector('#save'));
 const saved=env.calls.find(c=>c.type==='rulesSet').payload;
 assert.equal(saved.key,'https://example.com|site');assert.deepEqual(JSON.parse(JSON.stringify(saved.baseRules)),rules);
 assert.equal(saved.rules.map(r=>r.category).sort().join(','),'advertisement,hot_search');
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

test('page-only restore overrides category hiding while other pages and removal keep shared behavior',async()=>{
 const env=await environment([{key:'https://example.com|site',rules:[{category:'promotion',label:'Promotion'}]}],null,{url:'https://example.com/'});
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

test('hiding one child only on this page preserves shared parent keep while classification waits',async()=>{
 const rules=[{category:'advertisement',label:'Ads'},{selector:'main',label:'Keep region',action:'keep'},{selector:'#promotion',label:'Only this child',action:'hide',page:'https://example.com|page:/articles/123'}];
 const env=await environment([{key:'https://example.com|site',rules}],null,{classify:()=>new Promise(()=>{})});
 assert.equal(hidden(env,'promotion'),true);assert.equal(hidden(env,'reading'),false);
 assert.equal(env.document.querySelector('#reading').hasAttribute('data-jev-awaiting'),false);
});

test('unknown saved-rule modules stay invisible until classified, including late inserts',async()=>{
 const work=[];
 const env=await environment([{key:'https://example.com|site',rules:[{category:'advertisement',label:'广告'}]}],null,{classify:payload=>new Promise(resolve=>work.push({payload,resolve}))});
 assert.equal(env.document.querySelectorAll('[data-jev-awaiting]').length,2);
 const finish=()=>{const {payload,resolve}=work.shift();resolve({ok:true,data:{results:payload.blocks.map(b=>({id:b.id,category:b.role==='ASIDE'?'advertisement':'content_detail'})),errors:[]}});};
 finish();await settle();
 assert.equal(env.document.querySelectorAll('[data-jev-awaiting]').length,0);assert.equal(hidden(env,'promotion'),true);assert.equal(hidden(env,'reading'),false);
 env.document.querySelector('main').insertAdjacentHTML('beforeend','<aside id="late">New campaign</aside>');await env.mutate();
 assert.equal(env.document.querySelector('#late').hasAttribute('data-jev-awaiting'),true);
 finish();await settle();assert.equal(hidden(env,'late'),true);assert.equal(env.document.querySelector('#late').hasAttribute('data-jev-awaiting'),false);
});

test('classification failure releases pending visibility so content remains accessible',async()=>{
 let reject;
 const env=await environment([{key:'https://example.com|site',rules:[{category:'advertisement',label:'广告'}]}],null,{classify:()=>new Promise((_,fail)=>{reject=fail;})});
 assert.equal(env.document.querySelectorAll('[data-jev-awaiting]').length,2);
 reject(new Error('offline'));await settle();assert.equal(env.document.querySelectorAll('[data-jev-awaiting]').length,0);
});

test('identified duplicate advertisements fall back to visible category selection and save',async()=>{
 const env=await environment([], '<html><body><main><article><div class="AdvertImg">Sponsored one</div><div class="AdvertImg">Sponsored two</div></article></main></body></html>');
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-split'));
 await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-hide'));
 assert.match(env.ui.querySelector('#quick-name').textContent,/按类别保存/);
 assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,2);
 await env.click(env.ui.querySelector('#q-save'));
 const saved=env.calls.find(c=>c.type==='rulesSet');assert.ok(saved.payload.rules.some(r=>r.category==='advertisement'));
 assert.equal(env.document.querySelectorAll('[data-jev-manual-hidden]').length,2);
});

test('clicking one feed selects all subjects, excludes interleaved ads, and intercepts navigation', async () => {
  const env = await environment([], feedPage); await env.start();
  const event = await env.click(env.document.querySelector('#sports a'));
  assert.equal(selected(env,'sports'),false);
  await env.click(env.ui.querySelector('#same'));
  assert.equal(event.defaultPrevented, true);
  assert.equal(selected(env,'sports'), true); assert.equal(selected(env,'technology'), true);
  assert.equal(selected(env,'ad'), false); assert.equal(selected(env,'promotion'), false);
  assert.match(env.ui.querySelector('#status').textContent, /已隐藏 2 处 · 保存后生效/);
  await env.click(env.ui.querySelector('#effect'));
  assert.equal(env.document.querySelectorAll('[data-jev-preview-hide]').length, 2);
  await env.click(env.ui.querySelector('#effect'));
  await env.click(env.document.querySelector('#technology')); await env.click(env.ui.querySelector('#same'));
  assert.equal(env.document.querySelectorAll('[data-jev-selected]').length, 0);
});

test('late different-title feeds join selection and save contains categories only', async () => {
  const env = await environment([], feedPage); await env.start();
  await env.click(env.document.querySelector('#sports')); await env.click(env.ui.querySelector('#same'));
  env.document.querySelector('main').insertAdjacentHTML('beforeend','<article id="late">Gardening and flowers</article>');
  await env.mutate();
  assert.equal(selected(env,'late'), true); assert.equal(selected(env,'ad'), false);
  await env.click(env.ui.querySelector('#save'));
  const rules = env.stored.get('https://example.com|site').rules;
  assert.equal(rules.length, 1);
  assert.deepEqual(Object.keys(rules[0]).sort(), ['category','label']);
  assert.equal(rules[0].category,'content_feed');
  assert.equal(hidden(env,'late'), true); assert.equal(hidden(env,'ad'), false);
});

test('persisted category hides new titles on load and later insertion but not advertisements', async () => {
  const saved = [{key:'https://example.com|site',rules:[{category:'content_feed',label:'普通信息流'}]}];
  const env = await environment(saved, feedPage.replace('Sports score','A completely new question'));
  assert.equal(hidden(env,'sports'), true); assert.equal(hidden(env,'technology'), true); assert.equal(hidden(env,'ad'), false);
  env.document.querySelector('#sports').replaceWith(env.document.createElement('article'));
  const replacement = env.document.querySelector('article'); replacement.id='replacement'; replacement.textContent='Travel diary';
  await env.mutate();
  assert.equal(hidden(env,'replacement'), true); assert.equal(hidden(env,'ad'), false);
  assert.equal((await env.action('clearRules')).ok, true);
  assert.equal(env.stored.size,0); assert.equal(env.document.querySelector('[data-jev-manual-hidden]'),null);
});

test('cancel discards category edits and preserves saved category rules', async () => {
  const env = await environment([{key:'https://example.com|site',rules:[{category:'content_feed',label:'普通信息流'}]}],feedPage);
  await env.start(); assert.equal(selected(env,'sports'),true);
  await env.click(env.document.querySelector('#sports')); await env.click(env.ui.querySelector('#same'));
  await env.click(env.document.querySelector('#ad')); await env.click(env.ui.querySelector('#same'));
  await env.click(env.ui.querySelector('#cancel'));
  assert.equal(hidden(env,'sports'),true); assert.equal(hidden(env,'ad'),false);
  assert.equal(env.stored.values().next().value.rules[0].category,'content_feed');
  assert.equal(env.calls.filter(call=>call.type==='rulesSet').length,0);
  assert.equal(env.layer,undefined); assert.equal(env.document.querySelector('[data-jev-candidate]'),null);
});

test('legacy selectors display warning without expanding until user saves a category', async () => {
  const env = await environment([{key:'https://example.com|site',rules:[{selector:'#sports',label:'Old item'}]}],feedPage);
  assert.equal(hidden(env,'sports'),true); assert.equal(hidden(env,'technology'),false);
  await env.start();
  assert.match(env.ui.querySelector('#legacy').textContent,/区域规则/);
  assert.equal(env.document.querySelectorAll('[data-jev-selected]').length,1);
  await env.click(env.ui.querySelector('#cancel'));
  assert.equal(hidden(env,'sports'),true); assert.equal(hidden(env,'technology'),false);
  await env.start(); await env.click(env.document.querySelector('#sports')); await env.click(env.ui.querySelector('#same'));
  await env.click(env.ui.querySelector('#save'));
  assert.equal(hidden(env,'technology'),true);
  assert.equal(env.stored.values().next().value.rules[0].selector,undefined);
});

test('overlay selects image and late iframe advertisements without invoking advertising link', async () => {
  const env = await environment();
  env.document.querySelector('main').insertAdjacentHTML('beforeend','<div class="Pc-card" id="image-ad"><a href="https://ads.example"><img src="banner.png"></a></div>');
  let clicks=0; env.document.querySelector('#image-ad').addEventListener('click',()=>clicks++);
  await env.start(); await env.click(overlay(env,2)); await env.click(env.ui.querySelector('#same'));
  assert.equal(selected(env,'image-ad'),true); assert.equal(clicks,0);
  env.document.querySelector('main').insertAdjacentHTML('beforeend','<div class="Pc-card" id="iframe-ad"><iframe src="https://ads.example"></iframe></div>');
  await env.mutate();
  assert.equal(selected(env,'iframe-ad'),true);
  assert.match(overlay(env,3).getAttribute('aria-label'),/广告/);
  await env.click(overlay(env,3)); await env.click(env.ui.querySelector('#same'));
  assert.equal(selected(env,'image-ad'),false); assert.equal(selected(env,'iframe-ad'),false);
  await env.click(overlay(env,3)); await env.click(env.ui.querySelector('#same')); await env.click(env.ui.querySelector('#save'));
  assert.equal(hidden(env,'image-ad'),true); assert.equal(hidden(env,'iframe-ad'),true);
  assert.equal(hidden(env,'reading'),false);
});

test('selected category survives replacement with a different descriptor before saving', async () => {
  const env = await environment(); await env.start(); await env.click(overlay(env,1)); await env.click(env.ui.querySelector('#same'));
  const previous=env.document.querySelector('#promotion'), replacement=env.document.createElement('aside');
  replacement.id='replacement'; replacement.textContent='New service offer'; previous.replaceWith(replacement);
  await env.mutate();
  assert.equal(selected(env,'replacement'),true);
  await env.click(env.ui.querySelector('#save'));
  assert.equal(hidden(env,'replacement'),true);
  const rules=env.stored.values().next().value.rules;
  assert.equal(rules[0].category,'promotion'); assert.equal(rules[0].selector,undefined);
});




test('manual category assignment persists and survives replacement content', async () => {
  const env=await environment([], '<html><body><main><article id="uncertain">Unknown module</article><aside id="promotion">Promotion</aside></main></body></html>');
  await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#correct'));
  assert.equal(env.ui.querySelector('#correction').hidden,false);
  env.ui.querySelector('#manual-category').querySelector('option[value=promotion]').selected=true;
  await env.click(env.ui.querySelector('#assign'));
  assert.equal(selected(env,'uncertain'),true);assert.equal(selected(env,'promotion'),true);
  await env.click(env.ui.querySelector('#save'));
  const rules=env.calls.find(c=>c.type==='rulesSet').payload.rules;
  assert.equal(rules[0].category,'promotion');assert.deepEqual(Array.from(rules[0].overrides),['#uncertain']);
  env.document.querySelector('#uncertain').textContent='Replacement unknown content';await env.mutate();
  assert.equal(hidden(env,'uncertain'),true);
});

test('cancel discards manual category correction', async () => {
  const env=await environment([], '<html><body><main><article id="uncertain">Unknown module</article></main></body></html>');
  await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#correct'));await env.click(env.ui.querySelector('#assign'));
  await env.click(env.ui.querySelector('#cancel'));
  assert.equal(hidden(env,'uncertain'),false);assert.equal(env.calls.some(c=>c.type==='rulesSet'),false);
});


test('region selection is explicit, retained area wins over category hide and original view is reversible',async()=>{
 const env=await environment([],feedPage);await env.start();
 await env.click(overlay(env,0));assert.equal(selected(env,'sports'),false);
 await env.click(env.ui.querySelector('#same'));
 await env.click(env.ui.querySelector('#keep-area'));
 assert.equal(selected(env,'sports'),false);assert.equal(selected(env,'technology'),true);
 await env.click(env.ui.querySelector('#save'));
 assert.equal(hidden(env,'sports'),false);assert.equal(hidden(env,'technology'),true);
 await env.action('toggleVisibility');assert.equal(hidden(env,'technology'),false);
 await env.action('toggleVisibility');assert.equal(hidden(env,'technology'),true);
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


test('exact snapshot applies immediately without reclassifying its module',async()=>{
 let finish;
 const pending=new Promise(resolve=>finish=resolve);
 const saved=[{key:'https://example.com|site',rules:[{category:'content_feed',label:'Feed'}]}];
 const env=await environment(saved,null,{snapshots:[{signature:JSON.stringify({text:'Reading',role:'ARTICLE',structural:''}),category:'content_feed'}],classify:()=>pending});
 assert.equal(hidden(env,'reading'),true);
 const request=env.calls.find(c=>c.type==='classifyCategories');
 assert.ok(request.payload.blocks.every(b=>b.text!=='Reading'));
 finish({ok:true,data:{results:request.payload.blocks.map(b=>({id:b.id,category:'navigation'})),errors:[]}});await settle();
 assert.equal(hidden(env,'reading'),true);
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

test('saved split boundaries survive fresh document and changed text before category classification',async()=>{
 const body='<html><body><main><aside id="sidebar"><div id="news">News module</div><div id="sponsor">Sponsored service</div></aside></main></body></html>';
 const env=await environment([],body);
 await env.start();await env.click(overlay(env,0));await env.click(env.ui.querySelector('#q-split'));
 await env.click(overlay(env,1));await env.click(env.ui.querySelector('#same'));await env.click(env.ui.querySelector('#q-save'));
 const groups=[...env.stored.values()];assert.equal(groups[0].partitions.length,1);
 const reload=await environment(groups,body.replace('News module','Updated news').replace('Sponsored service','Sponsored new campaign'));
 assert.equal(hidden(reload,'sidebar'),false);assert.equal(hidden(reload,'news'),false);assert.equal(hidden(reload,'sponsor'),true);
 const blocks=reload.calls.filter(c=>c.type==='classifyCategories').flatMap(c=>c.payload.blocks);
 assert.equal(blocks.length,2);assert.ok(blocks.every(b=>b.role==='DIV'));
 await reload.start();assert.equal(reload.layer.querySelectorAll('button').length,2);
});

test('learned page retries changed boundaries automatically before classifying child modules',async()=>{
 const groups=[{key:'https://example.com|site',rules:[{category:'advertisement',label:'广告'}],partitions:[{parent:'#old-sidebar',parts:['#old-a','#old-b']}]}];
 const env=await environment(groups,'<html><body><main><aside id="new-sidebar"><div id="news">News</div><div id="sponsor">Sponsored</div></aside></main></body></html>',{experience:true});
 await settle();
 assert.equal(env.calls.filter(c=>c.type==='splitBlock').length,1);
 assert.equal(env.calls.find(c=>c.type==='splitBlock').payload.auto,true);
 assert.equal(hidden(env,'sponsor'),true);assert.equal(hidden(env,'news'),false);assert.equal(hidden(env,'new-sidebar'),false);
 await env.mutate();assert.equal(env.calls.filter(c=>c.type==='splitBlock').length,1);
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
