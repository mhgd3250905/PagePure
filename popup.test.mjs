import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import {i18nSource, i18nChrome} from './i18n-support.mjs';
import {createMessageHandler} from './extension/background.js';

const source = readFileSync(new URL('./extension/popup.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./extension/popup.html', import.meta.url), 'utf8');
const settle = async () => {for(let i=0;i<50;i++)await Promise.resolve();};
async function environment(send, options = {}) {
  const {document,window}=parseHTML(options.settings ? readFileSync(new URL('./extension/settings.html', import.meta.url), 'utf8') : html), timers=new Map();let id=0, closes=0;
  window.close=()=>{closes++;};
  const context = {document,window,URL,URLSearchParams,location:{search:options.search ?? '?embedded=1',pathname:options.settings?'/settings.html':'/popup.html'},
    setTimeout(callback,delay){timers.set(++id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);},
    chrome:{...i18nChrome,runtime:{sendMessage:message=>message.type==='i18nGet'?Promise.resolve({ok:true,data:{}}):send(message)}}};
  runInNewContext(i18nSource, context);
  runInNewContext(source, context);
  await settle();
  return {document,timers,get closes(){return closes;},async expire(delay){const work=[...timers].filter(([,v])=>v.delay===delay);for(const [id,v] of work){timers.delete(id);v.callback();}await settle();}};
}
const config={ok:true,data:{limited:false,enabled:true,aiEnabled:false,configured:false,context:'',origin:'https://example.com'}};

test('fresh install opens manual controls without an AI key',async()=>{
  const env=await environment(async message=>message.type==='configGet'?config:{ok:true,data:{}});
  assert.equal(env.document.querySelector('#controls').disabled,false);
  assert.equal(env.document.querySelector('#keyState').textContent,'未配置');
  assert.equal(env.document.querySelector('#reconnect').hidden,true);
});

test('limited authority hides writes even without an embedded query and cannot dispatch hidden controls',async()=>{
 const requests=[];
 const env=await environment(async msg=>{requests.push(msg);return msg.type==='configGet'?{ok:true,data:{...config.data,limited:true}}:{ok:true,data:{}};},{search:''});
 assert.equal(env.document.querySelector('label[for="enabled"]').hidden,true);
 assert.equal(env.document.querySelector('.advanced').hidden,true);
 env.document.querySelector('#enabled').dispatchEvent(new env.document.defaultView.Event('change'));
 env.document.querySelector('#settings').dispatchEvent(new env.document.defaultView.Event('submit',{cancelable:true}));
 for(const id of ['clearKey','retry','clearRules'])env.document.getElementById(id).click();
 await settle();
 assert.equal(requests.some(msg=>['configSet','keyClear','retry','pageAction'].includes(msg.type)),false);
 env.document.querySelector('#manageRules').click();await settle();
 assert.equal(requests.at(-1).type,'settingsOpen');
});

test('trusted settings preserve full controls and stay open after selecting the original page',async()=>{
 const requests=[];
 const send=async msg=>{requests.push(msg);return msg.type==='configGet'?config:{ok:true,data:{}};};
 const env=await environment(send,{settings:true,search:'?tabId=42'});
 assert.equal(env.document.querySelector('.advanced').hidden,false);
 assert.equal(env.document.querySelector('label[for="enabled"]').hidden,false);
 env.document.querySelector('#preview').click();await settle();
 assert.equal(requests.at(-1).payload.action,'preview');
 assert.equal(env.closes,0);
 const toolbar=await environment(send,{search:''});
 toolbar.document.querySelector('#preview').click();await settle();
 assert.equal(toolbar.closes,1);
});

test('stalled initialization times out and can reconnect without accepting a late stale result',async()=>{
  let finish,attempt=0;
  const env=await environment(message=>message.type==='configGet'&&++attempt===1?new Promise(resolve=>finish=resolve):Promise.resolve(message.type==='configGet'?config:{ok:true,data:{}}));
  await env.expire(8000);
  assert.match(env.document.querySelector('#status').textContent,/连接超时/);
  assert.equal(env.document.querySelector('#reconnect').hidden,false);
  env.document.querySelector('#reconnect').click();await settle();
  assert.equal(env.document.querySelector('#controls').disabled,false);
  finish({ok:true,data:{...config.data,enabled:false}});await settle();
  assert.equal(env.document.querySelector('#enabled').checked,true);
});

test('failed connection offers retry and slow status does not disable configured controls',async()=>{
  const failed=await environment(async()=>{throw new Error('Connection unavailable');});
  assert.equal(failed.document.querySelector('#reconnect').hidden,false);
  assert.match(failed.document.querySelector('#status').textContent,/Connection unavailable/);
  const env=await environment(message=>message.type==='configGet'?Promise.resolve(config):new Promise(()=>{}));
  assert.equal(env.document.querySelector('#controls').disabled,false);
  await env.expire(8000);
  assert.match(env.document.querySelector('#pageStatus').textContent,/连接超时/);
  assert.equal([...env.timers.values()].filter(v=>v.delay===2000).length,1);
});

test('AI requirement format validates edits while preserving existing user text',async()=>{
 const requests=[];
 const env=await environment(async msg=>{requests.push(msg);return msg.type==='configGet'?{ok:true,data:{...config.data,context:'旧的自定义需求'}}:{ok:true,data:{}};});
 const form=env.document.querySelector('#settings'),input=env.document.querySelector('#context');
 const submit=async()=>{form.dispatchEvent(new env.document.defaultView.Event('submit',{cancelable:true}));await settle();};
 await submit();assert.equal(requests.filter(m=>m.type==='configSet').at(-1).payload.context,'旧的自定义需求');
 const before=requests.filter(m=>m.type==='configSet').length;
 for(const bad of ['', '屏蔽：  ']){input.value=bad;await submit();}
 assert.equal(requests.filter(m=>m.type==='configSet').length,before);
 for(const good of ['屏蔽：广告、赞助','屏蔽: 广告、推广','保留技术文章，隐藏广告与课程推广']){input.value=good;await submit();assert.equal(requests.filter(m=>m.type==='configSet').at(-1).payload.context,good);}
});

test('custom requirement survives saving and reopening the CSDN settings panel',async()=>{
 let persisted={...config.data,origin:'https://www.csdn.net',context:'保留旧文章'};
 const send=async message=>{if(message.type==='configSet')persisted={...persisted,...message.payload};return {ok:true,data:message.type==='configGet'||message.type==='configSet'?{...persisted}:{}};};
 const first=await environment(send);
 const goal='保留 CSDN 首页的技术文章，屏蔽商业广告、付费课程与营销推广。';
 first.document.querySelector('#context').value=goal;
 first.document.querySelector('#settings').dispatchEvent(new first.document.defaultView.Event('submit',{cancelable:true}));await settle();
 assert.equal(persisted.context,goal);
 const reopened=await environment(send);
 assert.equal(reopened.document.querySelector('#context').value,goal);
 assert.match(reopened.document.querySelector('label[for=context]').textContent,/www.csdn.net/);
});

test('settings keep their original site and unsaved draft after the source tab navigates elsewhere',async()=>{
  const values={},requests=[];
  let sourceTab={id:42,url:'https://alpha.test/article'};
  const storage={get:async keys=>keys===null?{...values}:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,values[key]])),set:async entries=>Object.assign(values,entries),remove:async key=>{delete values[key];}};
  const api={runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path},storage:{local:storage,session:{...storage}},tabs:{
    get:async()=>sourceTab,query:async()=>[sourceTab],sendMessage:async()=>{},create:async()=>{},update:async()=>{}
  }};
  const handler=createMessageHandler(api);
  const sender={id:'test',url:api.runtime.getURL('settings.html?tabId=42'),frameId:0};
  const env=await environment(message=>{requests.push(message);return new Promise(resolve=>handler(message,sender,resolve));},{settings:true,search:'?tabId=42'});
  const document=env.document,form=document.querySelector('#settings'),goal=document.querySelector('#context'),key=document.querySelector('#key');
  goal.value='Keep tutorials';key.value='new-private-key-123456';document.querySelector('#aiEnabled').checked=true;
  sourceTab={id:42,url:'https://beta.test/article'};
  form.dispatchEvent(new document.defaultView.Event('submit',{cancelable:true}));await settle();
  assert.equal(requests.filter(message=>message.type==='configSet').at(-1).payload.expectedOrigin,'https://alpha.test');
  assert.deepEqual(values,{});
  assert.equal(goal.value,'Keep tutorials');assert.equal(key.value,'new-private-key-123456');
  assert.match(document.querySelector('label[for=context]').textContent,/alpha.test/);
  assert.equal(document.querySelector('#siteIdentity').textContent,'https://alpha.test');
  assert.equal(document.querySelector('#siteIdentity').hidden,false);
  assert.match(document.querySelector('#status').textContent,/目标网站已变化/);
  for(const id of ['preview','toggleVisibility','retry','clearRules'])assert.equal(document.getElementById(id).disabled,true);
  sourceTab={id:42,url:'https://alpha.test/another'};
  form.dispatchEvent(new document.defaultView.Event('submit',{cancelable:true}));await settle();
  assert.equal(values['context:https://alpha.test'],'Keep tutorials');assert.equal(values['ai:https://alpha.test'],true);
  assert.equal(values['context:https://beta.test'],undefined);assert.equal(key.value,'');
  assert.equal(document.getElementById('preview').disabled,false);
});

test('unsupported pages disable page actions while leaving the rule manager available',async()=>{
  const env=await environment(async message=>message.type==='configGet'?{ok:true,data:{...config.data,origin:''}}:{ok:true,data:{hidden:0,pending:0,error:'请在普通网页使用',available:false}},{search:''});
  for(const id of ['preview','toggleVisibility','retry','clearRules'])assert.equal(env.document.getElementById(id).disabled,true,id);
  assert.equal(env.document.querySelector('#manageRules').disabled,false);
  assert.match(env.document.querySelector('#manageRules').textContent,/净化规则/);
  assert.match(env.document.querySelector('#pageStatus').textContent,/普通网页/);
});

for(const result of [{ok:false,error:'请在普通网页使用'},{ok:true,data:{available:false,error:'请在普通网页使用'}}])test(`unavailable selection never reports success or closes the popup (${result.ok ? 'legacy' : 'failure'} reply)`,async()=>{
  const env=await environment(async message=>message.type==='configGet'?config:message.type==='pageAction'?result:{ok:true,data:{available:true,hidden:0,pending:0,error:''}},{search:''});
  env.document.querySelector('#preview').click();await settle();
  assert.equal(env.closes,0);
  assert.match(env.document.querySelector('#status').textContent,/普通网页/);
  assert.equal(env.document.querySelector('#status').classList.contains('error'),true);
});

test('manual hidden counts remain visible alongside the AI status',async()=>{
  const env=await environment(async message=>message.type==='configGet'?config:{ok:true,data:{available:true,hidden:2,pending:1,error:'',reason:'此网站未启用 AI 判断'}});
  const text=env.document.querySelector('#pageStatus').textContent;
  assert.match(text,/2/);assert.match(text,/1/);assert.match(text,/未启用 AI/);
});
