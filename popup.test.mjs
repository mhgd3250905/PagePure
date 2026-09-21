import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';

const source = readFileSync(new URL('./extension/popup.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./extension/popup.html', import.meta.url), 'utf8');
const settle = async () => {for(let i=0;i<20;i++)await Promise.resolve();};
async function environment(send) {
  const {document,window}=parseHTML(html), timers=new Map();let id=0;
  runInNewContext(source,{document,window,URL,URLSearchParams,location:{search:'?embedded=1'},
    setTimeout(callback,delay){timers.set(++id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);},
    chrome:{runtime:{sendMessage:send}}});
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
