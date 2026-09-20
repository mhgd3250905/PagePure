import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
const html=readFileSync('extension/rules-manager.html','utf8'),js=readFileSync('extension/rules-manager.js','utf8');
const samples=[{id:'a',origin:'https://alpha.test',address:'https://alpha.test',scope:'site',count:3},{id:'b',origin:'https://beta.test',address:'https://beta.test/page',scope:'page',count:2},{id:'c',origin:'https://alpha.test',address:'https://alpha.test/<img src=x>',scope:'page',count:1}];
async function setup(){
 const {document,window}=parseHTML(html),calls=[];let entries=structuredClone(samples),revision='1',changed,fail=false;
 const dialog=document.querySelector('dialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new window.Event('close'));};
 const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
 const chrome={runtime:{async sendMessage(message){calls.push(message);if(message.type==='rulesManagerList')return {ok:true,data:{entries:structuredClone(entries),revision}};if(fail)return {ok:false,error:'规则已变化'};entries=entries.filter(e=>!message.payload.ids.includes(e.id));revision='2';return {ok:true,data:{}};}},storage:{onChanged:{addListener(fn){changed=fn;}}}};
 runInNewContext(js,{document,chrome});await flush();
 return {document,calls,flush,dialog,change(keys){changed(Object.fromEntries(keys.map(k=>[k,{}])),'local');},fail(){fail=true;},search(q){document.querySelector('#search').value=q;document.querySelector('#search').dispatchEvent(new window.Event('input'));},selectAll(){const el=document.querySelector('#selectAll');el.checked=true;el.dispatchEvent(new window.Event('change'));},click(id){document.querySelector('#'+id).click();}};
}
test('manager filters addresses, preserves cross-search selection and requires explicit confirmation',async()=>{
 const e=await setup();assert.equal(e.document.querySelectorAll('.entry').length,3);assert.equal(e.document.querySelector('.entry img'),null);
 e.search('alpha');e.selectAll();assert.equal(e.document.querySelector('#selectedCount').textContent,'已选 2 个地址');
 e.search('beta');e.selectAll();e.click('deleteSelected');assert.equal(e.dialog.open,true);assert.match(e.document.querySelector('#confirmDescription').textContent,/3 个地址的 6 条规则/);
 assert.equal(e.calls.some(c=>c.type==='rulesManagerDelete'),false);e.click('confirmDelete');await e.flush();
 assert.deepEqual(Array.from(e.calls.find(c=>c.type==='rulesManagerDelete').payload.ids),['a','b','c']);assert.equal(e.document.querySelectorAll('.entry').length,0);
});
test('only rule changes invalidate an open confirmation; snapshots do not',async()=>{
 const e=await setup();e.selectAll();e.click('deleteSelected');e.change(['snapshot-v1:alpha']);assert.equal(e.document.querySelector('#confirmDelete').disabled,false);
 e.change(['rules:alpha']);assert.equal(e.document.querySelector('#confirmDelete').disabled,true);e.click('confirmDelete');await e.flush();assert.equal(e.calls.some(c=>c.type==='rulesManagerDelete'),false);
 e.dialog.close();await e.flush();e.click('deleteSelected');assert.equal(e.document.querySelector('#confirmDelete').disabled,false);
});
test('failed cleanup preserves selection and refreshes the catalog',async()=>{
 const e=await setup();e.selectAll();e.click('deleteSelected');e.fail();e.click('confirmDelete');await e.flush();
 assert.equal(e.document.querySelector('#selectedCount').textContent,'已选 3 个地址');assert.match(e.document.querySelector('#status').textContent,/重新确认/);assert.ok(e.calls.filter(c=>c.type==='rulesManagerList').length>=2);
});
