import test from 'node:test';
import './i18n-support.mjs';
import assert from 'node:assert/strict';
import {createMessageHandler,DEFAULT_CONTEXT} from './extension/background.js';
import {classifyBlock, parseAnswer, parseCategoryAnswer, CATEGORY_LABELS} from './extension/classifier.mjs';
const block = id => ({id,text:'活动推广',tag:'DIV',role:'banner',images:[],links:[]});
const answer = choice => ({answers:{visibility:{type:'choice',choice,confidence:0.9,probabilities:{keep:choice==='keep'?0.9:0.1,hide:choice==='hide'?0.9:0.1}}}});
const categoryAnswer = (choice, confidence=0.9) => ({answers:{category:{type:'choice',choice,confidence,probabilities:Object.fromEntries(Object.keys(CATEGORY_LABELS).map(key=>[key,key===choice?1:0]))}}});
const splitAnswer = count => ({answers:Object.fromEntries(Array.from({length:count},(_,i)=>['candidate_'+i,{type:'choice',choice:'module',confidence:0.9,probabilities:{module:0.9,fragment:0.1}}]))});
function harness(fetchImpl=async()=>({ok:true,json:async()=>answer('hide')})) {
  const makeStorage = () => {
    const values = {};
    return {values,setAccessLevel:async()=>{},get:async keys => keys===null?{...values}:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,values[key]])),set:async entries=>Object.assign(values,entries),remove:async key=>{delete values[key];}};
  };
  const tabs = new Map([[1,{id:1,url:'https://www.zhihu.com/'}]]), opened=[],activated=[];
  const api = {runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path},storage:{local:makeStorage(),session:makeStorage()},tabs:{query:async()=>[tabs.get(1)].filter(Boolean),get:async id=>{if(!tabs.has(id))throw new Error('Tab closed');return tabs.get(id);},create:async options=>{opened.push(options);return {id:100,...options};},update:async(id,options)=>{activated.push({id,...options});return {...tabs.get(id),...options};},sendMessage:async()=>{}}};
  const handler=createMessageHandler(api,fetchImpl);
  const popup={id:'test',url:api.runtime.getURL('popup.html')};
  const content={id:'test',url:'https://www.zhihu.com/',tab:{id:1},frameId:0};
  const send=(type,payload,sender=content)=>new Promise(resolve=>handler({type,payload},sender,resolve));
  const configure=()=>send('configSet',{enabled:true,context:DEFAULT_CONTEXT,key:'test-key-1234567890'},popup);
  const settings = tab => {tabs.set(tab.id,tab);return {id:'test',url:api.runtime.getURL('settings.html?tabId='+tab.id),frameId:0,tab:{id:100,url:api.runtime.getURL('settings.html?tabId='+tab.id)}};};
  return {api,popup,content,send,configure,settings,tabs,opened,activated};
}

test('fresh install can read settings when the browser lacks storage access-level APIs',async()=>{
  const h=harness();
  delete h.api.storage.local.setAccessLevel;
  delete h.api.storage.session.setAccessLevel;
  const handler=createMessageHandler(h.api);
  const result=await new Promise(resolve=>handler({type:'configGet'},h.popup,resolve));
  assert.equal(result.ok,true);
  assert.equal(result.data.enabled,true);
  assert.equal(result.data.configured,false);
  assert.equal('jevApiKey' in result.data,false);
});

test('saved split boundaries survive restart and undo with their scoped rules',async()=>{
  const h=harness(), key='https://www.zhihu.com|site';
  const rules=[{selector:'.creator',label:'创作入口'}];
  const partitions=[{parent:'.sidebar',parts:['.creator','.trending']}];
  assert.equal((await h.send('rulesSet',{key,rules,partitions})).ok,true);
  const handler=createMessageHandler(h.api);
  const send=(type,payload)=>new Promise(resolve=>handler({type,payload},h.content,resolve));
  assert.deepEqual((await send('rulesGet',{keys:[key]})).data.groups,[{key,rules,partitions}]);
  await send('rulesSet',{key,rules:[],partitions:[]});
  await send('rulesUndo',{keys:[key]});
  assert.deepEqual((await send('rulesGet',{keys:[key]})).data.groups,[{key,rules,partitions}]);
  await send('rulesSet',{key,rules});
  assert.deepEqual((await send('rulesGet',{keys:[key]})).data.groups[0].partitions,partitions);
  await send('rulesDelete',{keys:[key]});
  assert.equal(h.api.storage.local.values['partitions:'+key],undefined);
});

test('split boundary persistence validates limits and keeps other scopes independent',async()=>{
  const h=harness(), key='https://www.zhihu.com|site', other='https://www.zhihu.com|page:/question/1';
  const partition={parent:'.sidebar',parts:['.creator','.trending']};
  for(const partitions of [null,{},Array(41).fill(partition),[{...partition,parent:''}],[{...partition,parent:'x'.repeat(1501)}],[{...partition,parts:['.only']}],[{...partition,parts:['.same','.same']}],[{...partition,parts:Array(21).fill('.item')}],[{...partition,parts:['.item','x'.repeat(1501)]}]]) {
    assert.equal((await h.send('rulesSet',{key,rules:[],partitions})).ok,false);
  }
  await h.send('rulesSet',{key,rules:[],partitions:[partition]});
  await h.send('rulesSet',{key:other,rules:[],partitions:[]});
  assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups[0].partitions,[partition]);
  await h.send('rulesUndo',{keys:[key]});
  assert.equal(h.api.storage.local.values['partitions:'+key],undefined);
  assert.deepEqual((await h.send('rulesGet',{keys:[other]})).data.groups,[{key:other,rules:[],partitions:[]}]);
});
test('validates model answers and retains low-information keep judgments',()=>{
  assert.equal(parseAnswer('a',answer('keep')).hide,false);
  assert.throws(()=>parseAnswer('a',{answers:{visibility:{choice:'hide'}}}));
});

test('split learns only after saving boundaries and supplies scoped compact examples after restart',async()=>{
  const requests=[];
  const fetcher=async(url,init)=>{requests.push(JSON.parse(init.body));return {ok:true,json:async()=>splitAnswer(2)};};
  const h=harness(fetcher);await h.configure();
  const parent={...block('parent'),text:'x'.repeat(1000),html:'SECRET RAW HTML'};
  await h.send('splitBlock',{parent,blocks:[block('a'),block('b')]});
  assert.equal((await h.send('configGet',{})).data.splitExperienceAvailable,false);
  const key='https://www.zhihu.com|type:/';
  await h.send('rulesSet',{key,rules:[],learnSplit:true,partitions:[{parent:'.sidebar',parts:['.creator','.hot']}]});
  assert.equal((await h.send('configGet',{})).data.splitExperienceAvailable,true);
  const restarted=createMessageHandler(h.api,fetcher);
  const send=(type,payload,sender=h.content)=>new Promise(resolve=>restarted({type,payload},sender,resolve));
  await send('splitBlock',{parent:block('parent'),blocks:[block('new-a'),block('new-b')],auto:true});
  const examples=requests.at(-1).state.previous_examples;
  assert.equal(examples.length,1);assert.equal(examples[0].parent.text.length,400);
  assert.equal(examples[0].parent.html,undefined);assert.equal(examples[0].parent.id,undefined);
  assert.equal(examples[0].parts.length,2);
  assert.match(requests.at(-1).questions.candidate_0.instructions,/必须重新判断当前候选/);
  const detail={...h.content,url:'https://www.zhihu.com/question/123'};
  assert.equal((await send('configGet',{},detail)).data.splitExperienceAvailable,false);
  await send('splitBlock',{parent:block('parent'),blocks:[block('a'),block('b')]},detail);
  assert.deepEqual(requests.at(-1).state.previous_examples,[]);
  await send('rulesUndo',{keys:[key]});
  assert.equal((await send('configGet',{})).data.splitExperienceAvailable,false);
  await send('splitBlock',{parent:block('parent'),blocks:[block('a'),block('b')]});
  await send('rulesSet',{key,rules:[],learnSplit:true,partitions:[{parent:'.sidebar',parts:['.creator','.hot']}]});
  assert.equal((await send('configGet',{})).data.splitExperienceAvailable,true);
  await send('rulesDelete',{keys:[key]});
  assert.equal((await send('configGet',{})).data.splitExperienceAvailable,false);
});

test('uncertain and automatic splits are not learned by later rule saves',async()=>{
  let uncertain=true;
  const h=harness(async()=>{const answer=splitAnswer(2);if(uncertain)answer.answers.candidate_1.confidence=0.5;return {ok:true,json:async()=>answer};});
  await h.configure();
  const payload={parent:block('parent'),blocks:[block('a'),block('b')]};
  const save={key:'https://www.zhihu.com|type:/',rules:[],learnSplit:true,partitions:[{parent:'.sidebar',parts:['.a','.b']}]};
  await h.send('splitBlock',payload);await h.send('rulesSet',save);
  assert.equal((await h.send('configGet',{})).data.splitExperienceAvailable,false);
  uncertain=false;
  await h.send('splitBlock',{...payload,auto:true});await h.send('rulesSet',save);
  assert.equal((await h.send('configGet',{})).data.splitExperienceAvailable,false);
});
test('split sends bounded parent and candidate state and returns only confirmed candidate ids',async()=>{
  const h=harness(async(url,init)=>{
    const body=JSON.parse(init.body);
    assert.equal(body.state.parent.id,'parent');assert.equal(body.state.candidates.length,6);
    assert.equal(body.state.user_context,undefined);
    assert.match(body.questions.candidate_0.instructions,/不可信网页数据/);
    const reply=splitAnswer(6);reply.answers.candidate_1.confidence=0.69;
    reply.answers.candidate_2.choice='fragment';
    return {ok:true,json:async()=>reply};
  });await h.configure();
  const result=await h.send('splitBlock',{parent:block('parent'),blocks:Array.from({length:6},(_,i)=>block('b'+i))});
  assert.deepEqual(result,{ok:true,data:{ids:['b0','b3','b4','b5']}});
});
test('split requires permission and key and rejects invalid candidates before sending',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return {ok:true,json:async()=>splitAnswer(2)};});
  const payload={parent:block('parent'),blocks:[block('a'),block('b')]};
  assert.equal((await h.send('splitBlock',payload)).ok,false);
  await h.configure();
  assert.equal((await h.send('splitBlock',payload,{...h.content,url:'https://example.com/'})).ok,false);
  assert.equal((await h.send('splitBlock',payload,h.popup)).ok,false);
  for(const blocks of [[block('a')],Array.from({length:21},(_,i)=>block('b'+i)),[block('parent'),block('a')],Array.from({length:6},()=>block('duplicate')),[block('a'),{...block('b'),structural:42}]]) assert.equal((await h.send('splitBlock',{...payload,blocks})).ok,false);
  await h.send('configSet',{enabled:false,context:DEFAULT_CONTEXT},h.popup);
  assert.equal((await h.send('splitBlock',payload)).ok,false);assert.equal(calls,0);
});
test('split rejects partial or invented model output instead of changing regions',async()=>{
  let reply;const h=harness(async()=>({ok:true,json:async()=>reply}));await h.configure();
  const payload={parent:block('parent'),blocks:[block('a'),block('b')]};
  const invalidProbability=splitAnswer(2);invalidProbability.answers.candidate_0.probabilities.module=NaN;
  for(const value of [{ids:['invented']},splitAnswer(1),splitAnswer(3),invalidProbability]) {
    reply=value;assert.equal((await h.send('splitBlock',payload)).ok,false);
  }
});
test('category judgments validate all probabilities and fall back when uncertain',()=>{
  assert.equal(parseCategoryAnswer('a',categoryAnswer('content_feed')).category,'content_feed');
  assert.equal(parseCategoryAnswer('a',categoryAnswer('advertisement',0.69)).category,'other');
  assert.equal(parseCategoryAnswer('a',categoryAnswer('advertisement',0.7)).category,'advertisement');
  for (const value of [categoryAnswer('unknown'), categoryAnswer('advertisement',NaN), {answers:{category:{type:'choice',choice:'advertisement',confidence:1,probabilities:{advertisement:1}}}}]) assert.throws(()=>parseCategoryAnswer('a',value));
});
test('retired category requests are rejected even with AI enabled',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return {ok:true,json:async()=>categoryAnswer('advertisement')};});
 await h.configure();
 assert.equal((await h.send('classifyCategories',{blocks:[block('a')]})).ok,false);
 assert.equal(calls,0);
});
test('retired category rules are inert on read and rejected on save',async()=>{
 const h=harness(),key='https://www.zhihu.com|site',values=h.api.storage.local.values;
 const category={category:'promotion',label:'Promotion',overrides:['.promo']},manual={selector:'.ad',label:'Ad'};
 values['rules:'+key]=[category,manual];
 assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups,[{key,rules:[manual]}]);
 assert.deepEqual(values['rules:'+key],[category,manual]);
 for(const rule of [category,{category:'advertisement',label:'Ad',selector:'.ad'},{category:'navigation',label:'Navigation',action:'keep'}]) {
  assert.equal((await h.send('rulesSet',{key,rules:[rule]})).ok,false);
  assert.equal((await h.send('rulesSet',{key,rules:[],baseRules:[rule]})).ok,false);
 }
 values['rules:'+key]=[category];
 assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups,[{key,rules:[]}]);
});
test('key stays private; only exact popup can mutate settings',async()=>{
  const h=harness(); await h.configure();
  assert.equal((await h.send('configGet')).data.configured,true);
  assert.equal(JSON.stringify(await h.send('configGet')).includes('test-key'),false);
  assert.equal((await h.send('configSet',{enabled:false,context:''})).ok,false);
  assert.equal((await h.send('configGet',{}, {...h.content,url:'https://www.zhihu.com.evil.test/'})).data.aiEnabled,false);
  await h.send('configSet',{enabled:true,context:'屏蔽：广告',key:''},h.popup);
  assert.equal(h.api.storage.local.values.jevApiKey,'test-key-1234567890');
});
test('caches by descriptor and context across ids; changed context reclassifies',async()=>{
  let calls=0;
  const h=harness(async()=>{calls++;return {ok:true,json:async()=>answer('hide')};});
  await h.configure();
  assert.equal((await h.send('classify',{blocks:[block('a')]})).data.results[0].hide,true);
  assert.equal((await h.send('classify',{blocks:[block('b')]})).data.results[0].id,'b');
  assert.equal(calls,1);
  await h.send('configSet',{enabled:true,context:'屏蔽：推广'},h.popup);
  await h.send('classify',{blocks:[block('c')]});assert.equal(calls,2);
});
test('deduplicates concurrent requests and globally limits concurrency to three',async()=>{
  let calls=0,active=0,maximum=0;
  const h=harness(async()=>{calls++;active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,10));active--;return {ok:true,json:async()=>answer('hide')};});
  await h.configure();
  await Promise.all([h.send('classify',{blocks:Array.from({length:5},(_,i)=>({...block('a'+i),text:'module'+i}))}),h.send('classify',{blocks:Array.from({length:5},(_,i)=>({...block('b'+i),text:'module'+i}))})]);
  assert.equal(calls,5);assert.equal(maximum,3);
});
test('errors never produce hide results or enter cache; rejects oversized batches',async()=>{
  let calls=0;
  const h=harness(async()=>{calls++;return {ok:false,status:401};});await h.configure();
  const result=await h.send('classify',{blocks:[block('a')]});assert.deepEqual(result.data.results,[]);assert.equal(result.data.errors.length,1);
  await h.send('classify',{blocks:[block('a')]});assert.equal(calls,2);
  assert.equal((await h.send('classify',{blocks:Array.from({length:6},(_,i)=>block(''+i))})).ok,false);
});
test('status is scoped to tab and disabled state avoids requests',async()=>{
  const h=harness();await h.configure();
  await h.send('statusSet',{hidden:4,pending:2,error:''});
  assert.equal((await h.send('statusGet',{},h.popup)).data.hidden,4);
  await h.send('configSet',{enabled:false,context:DEFAULT_CONTEXT},h.popup);
  assert.deepEqual((await h.send('classify',{blocks:[block('a')]})).data,{results:[],errors:[]});
});
test('settings and key removal notify every web tab despite missing content scripts',async()=>{
  const h=harness(),queries=[],notifications=[];
  h.api.tabs.query=async query=>{queries.push(query);return [{id:1,url:"https://www.zhihu.com/"},{id:2,url:"https://example.net/"}];};
  h.api.tabs.sendMessage=async (id,message)=>{notifications.push({id,message});if(id===2) throw new Error('No receiver');};
  assert.equal((await h.configure()).ok,true);
  assert.equal((await h.send('keyClear',{},h.popup)).ok,true);
  assert.deepEqual(queries,[{active:true,currentWindow:true},{url:['http://*/*','https://*/*']},{active:true,currentWindow:true},{url:['http://*/*','https://*/*']}]);
  assert.deepEqual(notifications.map(item=>item.id),[1,2,1,2]);
  assert.ok(notifications.every(item=>item.message.type==='configChanged'));
  assert.equal((await h.send('configGet')).data.configured,false);
});

test('embedded extension console reads its own tab and opens trusted settings without write authority',async()=>{
  const h=harness(),messages=[];
  const embedded={...h.popup,url:h.popup.url+'?embedded=1',frameId:7,tab:{id:9,url:'https://www.zhihu.com/question/123'}};
  h.api.storage.session.values['status:9']={hidden:6,pending:1,error:''};
  h.api.storage.session.values['status:1']={hidden:99,pending:0,error:''};
  h.api.tabs.sendMessage=async(id,message)=>messages.push({id,message});
  assert.equal((await h.send('statusGet',{tabId:1},embedded)).data.hidden,6);
  assert.equal((await h.send('retry',{tabId:1},embedded)).ok,false);
  assert.deepEqual(messages,[]);
  assert.equal((await h.send('configSet',{enabled:true,context:DEFAULT_CONTEXT,key:'test-key-1234567890'},embedded)).ok,false);
  assert.equal((await h.send('settingsOpen',{tabId:1},embedded)).ok,true);
  assert.deepEqual(h.opened,[{url:h.api.runtime.getURL('settings.html?tabId=9')}]);
  assert.equal((await h.send('configGet',{},embedded)).data.limited,true);
  assert.equal(JSON.stringify(await h.send('configGet',{},embedded)).includes('test-key'),false);
});

test('embedded console requires an HTTP(S) host tab and exact extension sender',async()=>{
  const h=harness();
  for(const url of ['chrome://extensions/','file:///test.html','about:blank']) {
    const embedded={...h.popup,url:h.popup.url+'?embedded=1',tab:{id:9,url},frameId:7};
    assert.equal((await h.send('statusGet',{},embedded)).data.available,false);
    assert.equal((await h.send('retry',{},embedded)).ok,false);
    assert.equal((await h.send('settingsOpen',{},embedded)).ok,false);
  }
  for(const url of ['https://www.zhihu.com/popup.html','chrome-extension://evil/popup.html',h.popup.url+'?fake=1',h.popup.url+'?embedded=1&fake=1',h.popup.url+'?embedded=2']) {
    const sender={id:'test',url,tab:{id:9,url:'https://www.zhihu.com/'},frameId:7};
    for(const type of ['configGet','configSet','keyClear','statusGet','retry']) assert.equal((await h.send(type,{},sender)).ok,false);
  }
});

test('article origins can classify and report status while lookalike origins default to AI off',async()=>{
  const h=harness();await h.configure();
  const article={...h.content,url:'https://zhuanlan.zhihu.com/p/123',tab:{id:12,url:'https://zhuanlan.zhihu.com/p/123'}};
  assert.equal((await h.send('classify',{blocks:[block('article')]},article)).ok,true);
  await h.send('statusSet',{hidden:2,pending:0,error:''},article);
  const embedded={...h.popup,url:h.popup.url+'?embedded=1',tab:article.tab,frameId:1};
  assert.equal((await h.send('statusGet',{},embedded)).data.hidden,2);
  assert.equal((await h.send('configGet',{}, {...article,url:'https://zhuanlan.zhihu.com.evil.test/p/123'})).data.aiEnabled,false);
});


test('generic sites require per-origin AI opt in before sending any content',async()=>{
  let calls=0; const h=harness(async()=>{calls++;return {ok:true,json:async()=>answer('hide')};}); await h.configure();
  const generic={...h.content,url:'https://example.org/news/1',tab:{id:4,url:'https://example.org/news/1'}};
  const settings=h.settings(generic.tab);
  assert.equal((await h.send('configGet',{},generic)).data.aiEnabled,false);
  assert.equal((await h.send('classify',{blocks:[block('x')]},generic)).data.errors.length,1);
  assert.equal(calls,0);
  assert.equal((await h.send('configSet',{enabled:true,context:DEFAULT_CONTEXT,aiEnabled:true},settings)).ok,true);
  assert.equal((await h.send('configGet',{},generic)).data.aiEnabled,true);
  assert.equal((await h.send('classify',{blocks:[block('x')]},generic)).data.results[0].hide,true);
  assert.equal(calls,1);
  assert.equal((await h.send('configGet',{}, {...generic,url:'https://other.org/'})).data.aiEnabled,false);
});

test('manual rules persist across pages, isolate origins, validate payload, and notify matching tabs',async()=>{
  const h=harness(), notifications=[];
  const content={...h.content,url:'https://example.org/a',tab:{id:2,url:'https://example.org/a'}};
  h.api.tabs.query=async()=>[{id:2,url:content.url},{id:3,url:'https://other.org/'}];
  h.api.tabs.sendMessage=async(id,message)=>notifications.push({id,message});
  const key='https://example.org|type:/articles/*',rules=[{selector:'aside.promotion',label:'推广'}];
  assert.equal((await h.send('rulesSet',{key,rules},content)).ok,true);
  assert.deepEqual((await h.send('rulesGet',{keys:[key]},content)).data,{groups:[{key,rules}]});
  assert.deepEqual(notifications,[{id:2,message:{type:'rulesChanged'}}]);
  assert.equal((await h.send('rulesGet',{keys:[key]}, {...content,url:'https://other.org/'})).ok,false);
  assert.equal((await h.send('rulesSet',{key:'https://example.org.evil|site',rules},content)).ok,false);
  assert.equal((await h.send('rulesSet',{key,rules:[{selector:'x'.repeat(1501),label:''}]},content)).ok,false);
  assert.equal((await h.send('rulesGet',{keys:[key]},h.popup)).ok,false);
  assert.equal((await h.send('rulesDelete',{keys:[key]},content)).ok,true);
  assert.deepEqual((await h.send('rulesGet',{keys:[key]},content)).data,{groups:[]});
});

test('popup page actions forward to their embedded tab and reject unsupported operations',async()=>{
  const h=harness(),messages=[];
  h.api.tabs.sendMessage=async(id,message)=>messages.push({id,message});
  const embedded={...h.popup,url:h.popup.url+'?embedded=1',tab:{id:8,url:'https://example.org/'}};
  assert.equal((await h.send('pageAction',{action:'preview'},embedded)).ok,true);
  assert.deepEqual(messages,[{id:8,message:{type:'pageAction',action:'preview'}}]);
  assert.equal((await h.send('pageAction',{action:'delete'},embedded)).ok,false);
  assert.equal((await h.send('pageAction',{action:'preview'})).ok,false);
});

test('hide and keep actions persist for selector rules without changing legacy rules',async()=>{
  const h=harness(),key='https://www.zhihu.com|site';
  const rules=[{selector:'.promo',label:'推广',action:'hide'},{selector:'.article',label:'正文',action:'keep'},{selector:'.nav',label:'导航',action:'keep'},{selector:'.legacy',label:'旧版'}];
  assert.equal((await h.send('rulesSet',{key,rules})).ok,true);
  assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups,[{key,rules}]);
  for(const action of ['remove',null,false,0]) assert.equal((await h.send('rulesSet',{key,rules:[{...rules[0],action}]})).ok,false);
  assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups,[{key,rules}]);
});

test('undo restores the last save once per scope and survives a background restart',async()=>{
  const h=harness(),key='https://www.zhihu.com|site',other='https://www.zhihu.com|type:/question/*';
  const first=[{selector:'.promo',label:'推广'}],second=[{selector:'.reading',label:'阅读',action:'keep'}];
  await h.send('rulesSet',{key,rules:first});
  await h.send('rulesSet',{key,rules:second});
  await h.send('rulesSet',{key:other,rules:second});
  const restarted=createMessageHandler(h.api);
  const undo=payload=>new Promise(resolve=>restarted({type:'rulesUndo',payload},h.content,resolve));
  assert.deepEqual((await undo({keys:[key,other]})).data,{restored:[key,other]});
  assert.deepEqual((await h.send('rulesGet',{keys:[key,other]})).data.groups,[{key,rules:first}]);
  assert.deepEqual((await undo({keys:[key,other]})).data,{restored:[]});
  assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups,[{key,rules:first}]);
});

test('undo validates origins, notifies matching tabs, and clear discards undo history',async()=>{
  const h=harness(),key='https://www.zhihu.com|site',messages=[];
  await h.send('rulesSet',{key,rules:[{selector:'.ad',label:'广告'}]});
  h.api.tabs.query=async()=>[{id:1,url:'https://www.zhihu.com/'},{id:2,url:'https://other.org/'}];
  h.api.tabs.sendMessage=async(id,message)=>messages.push({id,message});
  assert.equal((await h.send('rulesUndo',{keys:['https://other.org|site']})).ok,false);
  assert.equal((await h.send('rulesUndo',{keys:[key]},h.popup)).ok,false);
  assert.deepEqual((await h.send('rulesUndo',{keys:[key]})).data,{restored:[key]});
  assert.deepEqual(messages,[{id:1,message:{type:'rulesChanged'}}]);
  await h.send('rulesSet',{key,rules:[]});
  await h.send('rulesDelete',{keys:[key]});
  assert.deepEqual((await h.send('rulesUndo',{keys:[key]})).data,{restored:[]});
});

test('popup visibility and undo actions reach the host tab',async()=>{
  const h=harness(),messages=[];
  h.api.tabs.sendMessage=async(id,message)=>messages.push({id,message});
  for(const action of ['toggleVisibility','undoSave']) assert.equal((await h.send('pageAction',{action},h.popup)).ok,true);
  assert.deepEqual(messages.map(entry=>entry.message.action),['toggleVisibility','undoSave']);
});


test('CSDN homepage and blog settings, rules, notifications stay isolated',async()=>{
 const h=harness(),local=h.api.storage.local.values,messages=[];
 local['ai:https://www.csdn.net']=true;
 local['rules:https://www.csdn.net|type:/']=[{category:'advertisement',label:'广告'}];
 const sender={...h.content,url:'https://blog.csdn.net/author/article/details/123'};
 const key='https://blog.csdn.net|type:/:author/article/details/:id';
 assert.equal((await h.send('configGet',undefined,sender)).data.aiEnabled,false);
 assert.deepEqual((await h.send('rulesGet',{keys:[key]},sender)).data.groups,[]);
 h.api.tabs.query=async()=>[{id:1,url:'https://www.csdn.net/'},{id:2,url:sender.url}];
 h.api.tabs.sendMessage=async(id,message)=>messages.push({id,message});
 await h.send('rulesSet',{key,rules:[{selector:'.promo',label:'推广'}]},sender);
 assert.deepEqual(messages,[{id:2,message:{type:'rulesChanged'}}]);
 assert.equal(local['rules:https://www.csdn.net|type:/'][0].category,'advertisement');
});

test('legacy blog author selectors stay local and category fallback is retired',async()=>{
 const h=harness(),local=h.api.storage.local.values;
 const key='https://blog.csdn.net|type:/:author/article/details/:id';
 const old='https://blog.csdn.net|type:/alice/article/details/:id';
 local['rules:'+old]=[{category:'promotion',label:'推广',overrides:['.ad']},{selector:'.local',label:'区域'}];
 local['rules:https://www.csdn.net|site']=[{category:'content_feed',label:'信息流'}];
 const sender=author=>({...h.content,url:`https://blog.csdn.net/${author}/article/details/123`});
 assert.deepEqual((await h.send('rulesGet',{keys:[key]},sender('alice'))).data.groups,[{key:old,rules:[{selector:'.local',label:'区域'}],legacy:true}]);
 const migrated=(await h.send('rulesGet',{keys:[key]},sender('bob'))).data.groups;
 assert.deepEqual(migrated,[]);
 await h.send('rulesSet',{key,rules:[]},sender('bob'));
 assert.deepEqual((await h.send('rulesGet',{keys:[key]},sender('alice'))).data.groups,[{key,rules:[]}]);
});

test('blog migration does not affect other routes or lookalike origins',async()=>{
 const h=harness();h.api.storage.local.values['rules:https://blog.csdn.net|type:/alice/article/details/:id']=[{category:'promotion',label:'推广'}];
 for (const url of ['https://blog.csdn.net/alice','https://blog.csdn.net.evil.test/alice/article/details/123','http://blog.csdn.net/alice/article/details/123']) {
  const key=new URL(url).origin+'|type:/:author/article/details/:id';
  assert.deepEqual((await h.send('rulesGet',{keys:[key]},{...h.content,url})).data.groups,[]);
 }
});


test('reading goals are per origin and legacy Zhihu defaults do not leak into CSDN',async()=>{
 const h=harness();h.api.storage.local.values.context='只保留知乎的文章';
 const home=h.settings({id:2,url:'https://www.csdn.net/'});
 const blog=h.settings({id:3,url:'https://blog.csdn.net/a/article/details/1'});
 const c=await h.send('configGet',undefined,home);assert.equal(c.data.context,DEFAULT_CONTEXT);assert.doesNotMatch(c.data.context,/知乎/);
 await h.send('configSet',{enabled:true,context:'屏蔽：首页推广'},home);
 await h.send('configSet',{enabled:true,context:'屏蔽：文章推广'},blog);
 assert.equal((await h.send('configGet',undefined,home)).data.context,'屏蔽：首页推广');
 assert.equal((await h.send('configGet',undefined,blog)).data.context,'屏蔽：文章推广');
 assert.equal((await h.send('configGet')).data.context,'只保留知乎的文章');
 const other={...h.content,url:'https://example.net/'};
 assert.equal((await h.send('configGet',undefined,other)).data.context,DEFAULT_CONTEXT);
});

test('site delta saves preserve additions from stale route tabs and explicit edits',async()=>{
  const h=harness(),key='https://www.zhihu.com|site';
  const ad={selector:'.ad',label:'广告'}, creator={selector:'.creator',label:'创作'}, direct={selector:'.promo',label:'推广'};
  assert.equal((await h.send('rulesSet',{key,baseRules:[],rules:[ad]})).ok,true);
  assert.equal((await h.send('rulesSet',{key,baseRules:[],rules:[creator,direct]})).ok,true);
  assert.deepEqual(h.api.storage.local.values['rules:'+key],[ad,creator,direct]);
  const keep={...creator,action:'keep'};
  await h.send('rulesSet',{key,baseRules:[ad,creator],rules:[keep]});
  assert.deepEqual(h.api.storage.local.values['rules:'+key],[keep,direct]);
  await h.send('rulesUndo',{keys:[key]});
  assert.deepEqual(h.api.storage.local.values['rules:'+key],[ad,creator,direct]);
  assert.equal((await h.send('rulesSet',{key,baseRules:[{category:'other',label:'x'}],rules:[]})).ok,false);
});

test('page selector exceptions round trip after restart and undo with shared rules',async()=>{
  const h=harness(),origin='https://www.zhihu.com',key=origin+'|site';
  const shared={selector:'.sidebar',label:'侧栏',action:'hide'};
  const home={...shared,page:origin+'|page:/',action:'keep'};
  const question={...shared,page:origin+'|page:/question/123?sort=updated'};
  const rules=[shared,home,question];
  assert.equal((await h.send('rulesSet',{key,rules})).ok,true);
  const handler=createMessageHandler(h.api);
  const send=(type,payload)=>new Promise(resolve=>handler({type,payload},h.content,resolve));
  assert.deepEqual((await send('rulesGet',{keys:[key]})).data.groups,[{key,rules}]);
  assert.equal((await send('rulesSet',{key,rules:[shared]})).ok,true);
  assert.equal((await send('rulesUndo',{keys:[key]})).ok,true);
  assert.deepEqual((await send('rulesGet',{keys:[key]})).data.groups,[{key,rules}]);
});

test('site delta saves merge shared selectors and distinct page exceptions independently',async()=>{
  const h=harness(),origin='https://www.zhihu.com',key=origin+'|site';
  const shared={selector:'.sidebar',label:'侧栏',action:'hide'};
  const home={...shared,page:origin+'|page:/',action:'keep'};
  const question={...shared,page:origin+'|page:/question/123'};
  for(const rule of [shared,home,question]) assert.equal((await h.send('rulesSet',{key,baseRules:[],rules:[rule]})).ok,true);
  assert.deepEqual(h.api.storage.local.values['rules:'+key],[shared,home,question]);
  const updated={...home,action:'hide'};
  await h.send('rulesSet',{key,baseRules:[shared,home],rules:[shared,updated]});
  assert.deepEqual(h.api.storage.local.values['rules:'+key],[shared,updated,question]);
  await h.send('rulesSet',{key,baseRules:[home],rules:[]});
  assert.deepEqual(h.api.storage.local.values['rules:'+key],[shared,question]);
});

test('page exceptions reject category rules, foreign origins and malformed page scopes',async()=>{
  const h=harness(),origin='https://www.zhihu.com',key=origin+'|site';
  const shared={selector:'.sidebar',label:'侧栏',action:'hide'};
  const invalid=[
    {...shared,page:'https://other.com|page:/'},
    {...shared,page:origin+'.evil.com|page:/'},
    {...shared,page:origin+'|type:/'},
    {...shared,page:origin+'|page:question/1'},
    {...shared,page:origin+'|page:/'+'a'.repeat(3000)},
    {...shared,page:null},
    {...shared,page:3},
    {category:'navigation',label:'导航',page:origin+'|page:/'}
  ];
  for(const rule of invalid) {
    assert.equal((await h.send('rulesSet',{key,rules:[rule]})).ok,false);
    assert.equal((await h.send('rulesSet',{key,rules:[],baseRules:[rule]})).ok,false);
  }
  assert.equal(h.api.storage.local.values['rules:'+key],undefined);
});

test('site split boundaries merge by route type and parent',async()=>{
  const h=harness(),key='https://www.zhihu.com|site';
  const home={parent:'.sidebar',parts:['.a','.b'],pageType:'https://www.zhihu.com|type:/'};
  const question={...home,parts:['.c','.d'],pageType:'https://www.zhihu.com|type:/question/:id'};
  await h.send('rulesSet',{key,rules:[],baseRules:[],partitions:[home]});
  await h.send('rulesSet',{key,rules:[],baseRules:[],partitions:[question]});
  assert.deepEqual(h.api.storage.local.values['partitions:'+key],[home,question]);
  await h.send('rulesSet',{key,rules:[],baseRules:[],partitions:[{...home,parts:['.e','.f']}]});
  assert.deepEqual(h.api.storage.local.values['partitions:'+key],[{...home,parts:['.e','.f']},question]);
  assert.equal((await h.send('rulesSet',{key,rules:[],partitions:[{...home,pageType:'https://evil.com|type:/'}]})).ok,false);
});

test('site default never derives retired categories and respects explicit empty rules',async()=>{
  const h=harness(),origin='https://www.zhihu.com',key=origin+'|site',values=h.api.storage.local.values;
  values['rules:'+origin+'|type:/']=[{category:'advertisement',label:'广告',overrides:['.ad']},{selector:'.sidebar',label:'侧栏'}];
  values['rules:'+origin+'|page:/question/1']=[{category:'advertisement',label:'保留广告',action:'keep'}];
  values['rules:https://other.com|type:/']=[{category:'creator',label:'创作'}];
  assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups,[]);
  assert.equal(values['rules:'+key],undefined);
  values['rules:'+key]=[];
  assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups,[{key,rules:[]}]);
});


const managerSender=h=>({id:'test',url:h.api.runtime.getURL('rules-manager.html')});
test('rule manager is restricted to exact trusted page and never exposes secrets',async()=>{
 const h=harness(),key='https://www.zhihu.com|site';
 h.api.storage.local.values['rules:'+key]=[{selector:'.ad',label:'Ad'}];
 h.api.storage.local.values.jevApiKey='private-key';
 for(const sender of [h.content,h.popup,{id:'other',url:h.api.runtime.getURL('rules-manager.html')},{id:'test',url:h.api.runtime.getURL('rules-manager.html?evil=1')}])assert.equal((await h.send('rulesManagerList',{},sender)).ok,false);
 const result=await h.send('rulesManagerList',{},managerSender(h));assert.equal(result.ok,true);
 assert.deepEqual(result.data.entries,[{id:key,origin:'https://www.zhihu.com',address:'https://www.zhihu.com',scope:'site',label:'整个网站',count:1}]);
 assert.ok(!JSON.stringify(result).includes('private-key'));assert.ok(!JSON.stringify(result).includes('.ad'));
 let opened;h.api.tabs.create=async options=>{opened=options.url;};
 assert.equal((await h.send('rulesManagerOpen',{},h.content)).ok,false);
 assert.equal((await h.send('rulesManagerOpen',{},h.popup)).ok,true);assert.equal(opened,h.api.runtime.getURL('rules-manager.html'));
});
test('manager groups inline page exceptions and clears only selected address endpoints',async()=>{
 const h=harness(),origin='https://www.zhihu.com',site=origin+'|site',page=origin+'|page:/question/1',other=origin+'|page:/question/2';
 const values=h.api.storage.local.values;
 values['rules:'+site]=[{selector:'.ad',label:'Ad'},{selector:'.local',label:'Local',page},{selector:'.other',label:'Other',page:other}];
 values['rules:'+page]=[{selector:'.second',label:'Second'}];values['rules:https://other.test|site']=[{selector:'.safe',label:'Safe'}];
 values['rulesUndo:'+site]={rules:[{selector:'.local',label:'Local',page}]};values['snapshot-v1:'+page]={entries:[]};values['partitions:'+site]=[{parent:'.parent',parts:['.a','.b']}];
 values.jevApiKey='private';values['ai:'+origin]=true;
 const messages=[];h.api.tabs.query=async()=>[{id:1,url:origin+'/question/1'},{id:2,url:'https://other.test/'}];h.api.tabs.sendMessage=async(id,m)=>messages.push([id,m]);
 const list=(await h.send('rulesManagerList',{},managerSender(h))).data;
 assert.equal(list.entries.find(e=>e.id===page).count,2);assert.equal(list.entries.find(e=>e.id===site).count,1);
 assert.equal((await h.send('rulesManagerDelete',{ids:[page],revision:list.revision},managerSender(h))).ok,true);
 assert.equal(values['rules:'+site].length,2);assert.deepEqual(values['rules:'+page],[]);
 assert.equal(values['rulesUndo:'+site],undefined);assert.equal(values['snapshot-v1:'+page],undefined);
 assert.equal(values['partitions:'+site].length,1);assert.equal(values.jevApiKey,'private');assert.equal(values['ai:'+origin],true);
 assert.equal(values['rules:https://other.test|site'].length,1);assert.deepEqual(messages,[[1,{type:'rulesChanged',source:'manager'}]]);
 assert.equal((await h.send('rulesManagerDelete',{ids:[other],revision:list.revision},managerSender(h))).ok,false);
 const fresh=(await h.send('rulesManagerList',{},managerSender(h))).data;
 assert.equal((await h.send('rulesManagerDelete',{ids:[site,other],revision:fresh.revision},managerSender(h))).ok,true);
 assert.deepEqual(values['rules:'+site],[]);assert.equal(values['partitions:'+site],undefined);
});
test('manager clear keeps empty scope marker so legacy categories cannot resurrect',async()=>{
 const h=harness(),site='https://www.zhihu.com|site',type='https://www.zhihu.com|type:/';
 h.api.storage.local.values['rules:'+site]=[{selector:'.ad',label:'Ad'}];
 h.api.storage.local.values['rules:'+type]=[{category:'promotion',label:'Promotion'}];
 const list=(await h.send('rulesManagerList',{},managerSender(h))).data;
 await h.send('rulesManagerDelete',{ids:[site],revision:list.revision},managerSender(h));
 const groups=(await h.send('rulesGet',{keys:[site,type]})).data.groups;
 assert.deepEqual(groups.find(g=>g.key===site).rules,[]);assert.equal(groups.find(g=>g.key===type).rules.length,0);
});
test('manager rejects stale confirmation after save and serializes simultaneous clears',async()=>{
 const h=harness(),site='https://www.zhihu.com|site';
 await h.send('rulesSet',{key:site,rules:[{selector:'.a',label:'A'}]});
 const old=(await h.send('rulesManagerList',{},managerSender(h))).data;
 await h.send('rulesSet',{key:site,rules:[{selector:'.a',label:'A'},{selector:'.b',label:'B'}]});
 const stale=await h.send('rulesManagerDelete',{ids:[site],revision:old.revision},managerSender(h));
 assert.equal(stale.ok,false);assert.equal(stale.code,'revision');assert.equal(typeof stale.error,'string');assert.ok(stale.error.length);
 const current=(await h.send('rulesManagerList',{},managerSender(h))).data;
 const result=await Promise.all([1,2].map(()=>h.send('rulesManagerDelete',{ids:[site],revision:current.revision},managerSender(h))));
 assert.equal(result.filter(r=>r.ok).length,1);
});

test('saving and undoing mixed legacy storage never reactivates categories',async()=>{
 const h=harness(),key='https://www.zhihu.com|site',values=h.api.storage.local.values;
 const category={category:'advertisement',label:'Ad'},old={selector:'.old',label:'Old'},next={selector:'.next',label:'Next'};
 values['rules:'+key]=[category,old];
 assert.equal((await h.send('rulesSet',{key,baseRules:[old],rules:[old,next]})).ok,true);
 assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups,[{key,rules:[old,next]}]);
 await h.send('rulesUndo',{keys:[key]});
 assert.deepEqual(values['rules:'+key],[category,old]);
 assert.deepEqual((await h.send('rulesGet',{keys:[key]})).data.groups,[{key,rules:[old]}]);
});

test('content scripts can request the active locale table',async()=>{
 const h=harness();
 await h.api.storage.local.set({uiLocale:'en',uiMessages:{extName:{message:'PagePure'}}});
 const result=await h.send('i18nGet');
 assert.equal(result.ok,true);
 assert.equal(result.data.locale,'en');
 assert.equal(result.data.messages.extName.message,'PagePure');
 await h.api.storage.local.remove('uiLocale');await h.api.storage.local.remove('uiMessages');
 const empty=await h.send('i18nGet');
 assert.deepEqual(empty.data,{});
});


test('visibility only hides high-confidence matches and sends the blocking list without categories',async()=>{
  const low=answer('hide');low.answers.visibility.confidence=0.79;
  assert.equal(parseAnswer('a',low).hide,false);
  low.answers.visibility.confidence=0.8;
  assert.equal(parseAnswer('a',low).hide,true);
  let request;
  const h=harness(async(url,init)=>{request=JSON.parse(init.body);return {ok:true,json:async()=>answer('keep')};});
  await h.configure();
  await h.send('classify',{blocks:[block('a')]});
  assert.equal(request.state.user_context,DEFAULT_CONTEXT);
  assert.deepEqual(Object.keys(request.questions),['visibility']);
  assert.match(request.questions.visibility.instructions,/不可信/);
  assert.match(request.questions.visibility.instructions,/屏蔽/);
});

test('custom requirements persist verbatim while empty edits are rejected and toggle saves preserve old goals',async()=>{
  const h=harness();
  assert.equal((await h.send('configGet')).data.context,DEFAULT_CONTEXT);
  for(const context of ['', '屏蔽：', '屏蔽:   ', '屏蔽：、，']) {
    assert.equal((await h.send('configSet',{enabled:true,context},h.popup)).ok,false,context);
  }
  for(const context of ['屏蔽：广告、推广', '屏蔽: Ads, Sponsored', '屏蔽：广告，营销']) {
    assert.equal((await h.send('configSet',{enabled:true,context},h.popup)).ok,true,context);
    assert.equal((await h.send('configGet')).data.context,context);
  }
  h.api.storage.local.values['context:https://www.zhihu.com']='保留旧的阅读需求';
  assert.equal((await h.send('configSet',{enabled:false,context:'保留旧的阅读需求'},h.popup)).ok,true);
  assert.equal((await h.send('configGet')).data.context,'保留旧的阅读需求');
  assert.equal((await h.send('configSet',{enabled:true,context:'新的自由文本'},h.popup)).ok,true);
  assert.equal((await h.send('configGet')).data.context,'新的自由文本');
});

test('a rejected partial split cannot contaminate an earlier successful split learning save',async()=>{
  let partial=false;
  const h=harness(async()=>{const reply=splitAnswer(3);if(partial)reply.answers.candidate_2.confidence=0.5;return {ok:true,json:async()=>reply};});
  await h.configure();
  const payload={parent:block('parent'),blocks:[block('a'),block('b'),block('c')]};
  await h.send('splitBlock',payload);
  partial=true;
  await h.send('splitBlock',{...payload,parent:{...block('parent'),text:'Rejected example'}});
  await h.send('rulesSet',{key:'https://www.zhihu.com|type:/',rules:[],learnSplit:true,partitions:[{parent:'.sidebar',parts:['.a','.b','.c']}]});
  const learned=h.api.storage.local.values['splitExperience:https://www.zhihu.com|type:/'];
  assert.equal(learned.length,1);
  assert.notEqual(learned[0].parent.text,'Rejected example');
});

async function waitFor(predicate) {
  const deadline=Date.now()+2000;
  while(!predicate()) {
    assert.ok(Date.now()<deadline,'asynchronous work did not reach the expected checkpoint');
    await new Promise(resolve=>setImmediate(resolve));
  }
}
const drain = async () => {for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};

test('classifier preserves caller cancellation during fetch and response-body parsing',async()=>{
  for(const phase of ['fetch','json']) {
    const controller=new AbortController();let reached;
    const started=new Promise(resolve=>{reached=resolve;});
    const abortable=signal=>new Promise((resolve,reject)=>{
      if(signal.aborted)reject(signal.reason);
      else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
    const fetch=async(_url,init)=>{
      if(phase==='fetch'){reached();return abortable(init.signal);}
      return {ok:true,json(){reached();return abortable(init.signal);}};
    };
    const work=classifyBlock(block('cancel-'+phase),DEFAULT_CONTEXT,'test-key-1234567890',fetch,controller.signal);
    await started;controller.abort();
    await assert.rejects(work,error=>error.code==='canceled');
  }
});

test('native Fetch AbortError after key clearing is returned as coded cancellation',async()=>{
  let requestSignal;
  const h=harness((_url,init)=>new Promise((resolve,reject)=>{
    requestSignal=init.signal;
    if(init.signal.aborted)reject(init.signal.reason);
    else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
  }));
  await h.configure();
  const work=h.send('classify',{blocks:[block('native-abort')]});
  await waitFor(()=>requestSignal);
  await h.send('keyClear',{},h.popup);
  const result=await work;
  assert.equal(requestSignal.aborted,true);
  assert.equal(result.ok,false);
  assert.equal(result.code,'canceled');
  assert.doesNotMatch(result.error,/无法连接 Jev 服务/);
});

function heldRequests() {
  const requests=[];
  const fetch=(_url,init)=>new Promise(resolve=>{
    const body=JSON.parse(init.body);
    requests.push({signal:init.signal,body,finish:()=>resolve({ok:true,json:async()=>body.state.candidates?splitAnswer(body.state.candidates.length):answer('hide')})});
  });
  return {requests,fetch};
}

for(const type of ['classify','splitBlock'])test(`clearing the key aborts three active ${type} requests and cancels two queued requests`,async()=>{
  const held=heldRequests(),h=harness(held.fetch);await h.configure();
  const work=Array.from({length:5},(_,i)=>h.send(type,type==='classify'
    ? {blocks:[{...block('a'+i),text:'distinct module '+i}]}
    : {parent:block('parent'),blocks:[block('a'),block('b')]}));
  await waitFor(()=>held.requests.length===3);await drain();
  assert.equal((await h.send('keyClear',{},h.popup)).ok,true);
  assert.ok(held.requests.every(request=>request.signal.aborted));
  await drain();assert.equal(held.requests.length,3,'queued work must not start after credentials are cleared');
  // Even a transport that ignores AbortSignal must not publish or cache its late result.
  held.requests.forEach(request=>request.finish());
  const results=await Promise.all(work);
  if(type==='classify')for(const result of results) {
    assert.equal(result.ok,false);assert.equal(result.code,'canceled');
  } else for(const result of results) {
    assert.equal(result.ok,false);assert.equal(result.code,'canceled');assert.equal(typeof result.error,'string');
  }
  assert.equal(held.requests.length,3);
  assert.equal(Object.keys(h.api.storage.session.values).some(key=>key.startsWith('result:')||key.startsWith('splitProvisional:')),false);
});

test('site AI revocation cancels only that origin and leaves other origin work running',async()=>{
  const held=heldRequests(),h=harness(held.fetch);await h.configure();
  const other={...h.content,url:'https://example.org/article',tab:{id:2,url:'https://example.org/article'}};
  assert.equal((await h.send('configSet',{enabled:true,context:DEFAULT_CONTEXT,aiEnabled:true},h.settings(other.tab))).ok,true);
  const first=h.send('classify',{blocks:[{...block('a'),text:'first origin'}]});
  await waitFor(()=>held.requests.length===1);
  const second=h.send('classify',{blocks:[{...block('b'),text:'second origin'}]},other);
  await waitFor(()=>held.requests.length===2);
  assert.equal((await h.send('configSet',{enabled:true,context:DEFAULT_CONTEXT,aiEnabled:false},h.popup)).ok,true);
  assert.equal(held.requests[0].signal.aborted,true);assert.equal(held.requests[1].signal.aborted,false);
  held.requests.forEach(request=>request.finish());
  const [revoked,unaffected]=await Promise.all([first,second]);
  assert.equal(revoked.ok,false);assert.equal(revoked.code,'canceled');
  assert.equal(unaffected.data.results[0].hide,true);
  assert.equal(Object.keys(h.api.storage.session.values).filter(key=>key.startsWith('result:')).length,1);
});

for(const [name,change] of [['global disable',{enabled:false}],['key replacement',{key:'replacement-key-123456'}],['context change',{context:'Keep only tutorials'}]])test(`${name} aborts pending AI work before accepting a late answer`,async()=>{
  const held=heldRequests(),h=harness(held.fetch);await h.configure();
  const work=h.send('classify',{blocks:[block('a')]});await waitFor(()=>held.requests.length===1);
  assert.equal((await h.send('configSet',{enabled:true,context:DEFAULT_CONTEXT,...change},h.popup)).ok,true);
  assert.equal(held.requests[0].signal.aborted,true);held.requests[0].finish();
  const result=await work;assert.equal(result.ok,false);assert.equal(result.code,'canceled');
  assert.equal(Object.keys(h.api.storage.session.values).some(key=>key.startsWith('result:')),false);
});

test('WAR popup cannot recover write authority by omitting embedded query or using a top frame',async()=>{
  const h=harness();await h.configure();
  for(const search of ['', '?embedded=1'])for(const frameId of [0,7]) {
    const sender={...h.popup,url:h.popup.url+search,frameId,tab:{id:9,url:'https://www.zhihu.com/'}};
    const before=JSON.stringify(h.api.storage.local.values);
    for(const type of ['configSet','keyClear','retry','rulesManagerOpen']) {
      const result=await h.send(type,{enabled:false,context:'changed',key:'replacement-key-123456'},sender);
      assert.equal(result.ok,false,`${search || 'no query'}, frame ${frameId}: ${type}`);
    }
    for(const action of ['clearRules','undoSave'])assert.equal((await h.send('pageAction',{action},sender)).ok,false);
    for(const action of ['preview','toggleVisibility'])assert.equal((await h.send('pageAction',{action},sender)).ok,true);
    assert.equal((await h.send('configGet',{},sender)).data.limited,true);
    assert.equal(JSON.stringify(h.api.storage.local.values),before);
  }
});

test('trusted settings bind all operations to the URL tab id instead of active or payload tabs',async()=>{
  const h=harness(),messages=[];
  const settings=h.settings({id:9,url:'https://example.org/news'});
  h.api.tabs.sendMessage=async(id,message)=>messages.push({id,message});
  assert.equal((await h.send('configSet',{enabled:true,context:'Keep tutorials',aiEnabled:true,tabId:1},settings)).ok,true);
  assert.equal(h.api.storage.local.values['context:https://example.org'],'Keep tutorials');
  assert.equal(h.api.storage.local.values['context:https://www.zhihu.com'],undefined);
  const config=await h.send('configGet',{tabId:1},settings);
  assert.equal(config.data.origin,'https://example.org');assert.equal(config.data.limited,false);
  await h.send('retry',{tabId:1},settings);
  await h.send('pageAction',{action:'preview',tabId:1},settings);
  assert.deepEqual(messages.filter(item=>item.message.type!=='configChanged'),[{id:9,message:{type:'retry'}},{id:9,message:{type:'pageAction',action:'preview'}}]);
  assert.deepEqual(h.activated,[{id:9,active:true}]);
});

test('settings privilege rejects spoofed origins, ids, subframes and malformed bindings',async()=>{
  const h=harness(),settings=h.settings({id:9,url:'https://example.org/'});
  for(const sender of [
    {...settings,id:'evil'}, {...settings,id:undefined}, {...settings,frameId:1}, {...settings,frameId:undefined},
    ...['chrome-extension://evil/settings.html?tabId=9','https://test/settings.html?tabId=9',
      'file:///settings.html?tabId=9',h.api.runtime.getURL('settings.html'),
      h.api.runtime.getURL('settings.html?tabId=9&tabId=1'),h.api.runtime.getURL('settings.html?tabId=9&fake=1'),
      h.api.runtime.getURL('settings.html?tabId=-1'),h.api.runtime.getURL('settings.html?tabId=9007199254740992')].map(url=>({...settings,url}))
  ]) {
    // An HTTP top frame retains the ordinary content-script read API, but cannot acquire settings writes.
    for(const type of ['configGet','configSet','keyClear'])assert.equal((await h.send(type,{enabled:false,context:'changed'},sender)).ok,type==='configGet'&&sender.url.startsWith('https://'),`${sender.url}, ${sender.id}, ${sender.frameId}: ${type}`);
  }
  assert.deepEqual(h.api.storage.local.values,{});
});

test('settings never fall back to an active webpage after the bound tab closes or leaves HTTP(S)',async()=>{
  const h=harness(),settings=h.settings({id:9,url:'https://example.org/'});
  for(const destination of [null,'chrome://extensions/','file:///private.txt']) {
    if(destination===null)h.tabs.delete(9);else h.tabs.set(9,{id:9,url:destination});
    for(const type of ['configGet','configSet','keyClear','retry','statusGet','pageAction']) {
      assert.equal((await h.send(type,{enabled:false,context:'changed',action:'preview',tabId:1},settings)).ok,false,`${destination}: ${type}`);
    }
  }
  assert.deepEqual(h.api.storage.local.values,{});assert.deepEqual(h.activated,[]);
});

test('freeform requirements reach visibility with full-intent and mixed-content protections',async()=>{
  let request;
  const h=harness(async(url,init)=>{request=JSON.parse(init.body);return {ok:true,json:async()=>answer('hide')};});
  await h.configure();
  const context='屏蔽所有广告和所有与播客文章不相关的内容';
  assert.equal((await h.send('configSet',{enabled:true,context},h.popup)).ok,true);
  const result=await h.send('classify',{blocks:[block('a')]});
  assert.equal(result.data.results[0].hide,true);
  assert.equal(request.state.user_context,context);
  const instructions=request.questions.visibility.instructions;
  assert.match(instructions,/完整 user_context/);
  assert.match(instructions,/自由文字，不要求固定前缀/);
  assert.match(instructions,/独立的课程、直播、商品/);
  assert.match(instructions,/导航不自动豁免/);
  assert.match(instructions,/混合了需要保留的正文或必要阅读操作/);
  assert.match(instructions,/信息不足或不确定时选择 keep/);
});


test('new visibility policy does not reuse results cached under the previous prompt',async()=>{
  let calls=0;
  const h=harness(async()=>{calls++;return {ok:true,json:async()=>answer('keep')};});
  await h.configure();
  const {id,...descriptor}=block('a');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['blocking-list-v1',DEFAULT_CONTEXT,descriptor])));
  const key='result:'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  h.api.storage.session.values[key]={hide:true,confidence:0.6};
  assert.equal((await h.send('classify',{blocks:[block('a')]})).data.results[0].hide,false);
  assert.equal(calls,1);
});
