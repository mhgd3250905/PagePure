import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import {i18nSource, i18nChrome} from './i18n-support.mjs';

const source = readFileSync(new URL('./extension/popup.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./extension/popup.html', import.meta.url), 'utf8');
const settle = async () => {for(let i=0;i<20;i++)await Promise.resolve();};
async function environment(send) {
  const {document,window}=parseHTML(html), timers=new Map();let id=0;
  const context = {document,window,URL,URLSearchParams,location:{search:'?embedded=1'},
    setTimeout(callback,delay){timers.set(++id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);},
    chrome:{...i18nChrome,runtime:{sendMessage:message=>message.type==='i18nGet'?Promise.resolve({ok:true,data:{}}):send(message)}}};
  runInNewContext(i18nSource, context);
  runInNewContext(source, context);
  await settle();
  return {document,timers,async expire(delay){const work=[...timers].filter(([,v])=>v.delay===delay);for(const [id,v] of work){timers.delete(id);v.callback();}await settle();}};
}
const config={ok:true,data:{enabled:true,aiEnabled:false,configured:false,context:'',origin:'https://example.com'}};

test('fresh install opens manual controls without an AI key',async()=>{
  const env=await environment(async message=>message.type==='configGet'?config:{ok:true,data:{}});
  assert.equal(env.document.querySelector('#controls').disabled,false);
  assert.equal(env.document.querySelector('#keyState').textContent,'未配置');
  assert.equal(env.document.querySelector('#reconnect').hidden,true);
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
