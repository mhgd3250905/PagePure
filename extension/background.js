import {snapshotRequest} from './snapshots.mjs';
import {classifyBlock, classifyCategory, splitBlock, CATEGORY_LABELS} from './classifier.mjs';
const LEGACY_CONTEXT = '只保留知乎的文章、问题、回答等真实阅读内容及其必要操作。隐藏广告、活动横幅、创作入口、推广服务、推荐关注、热搜、帮助中心、举报说明、关于网站和备案页脚。不要按文章主题筛选。';
export const DEFAULT_CONTEXT = '保留当前网站的主要内容、导航、搜索和必要操作。隐藏广告、无关推广、悬浮营销及重复推荐。不要按内容主题筛选；功能不明确或与正文混合时保留。';
function defaultContext(url) {
  try {
    const host=new URL(url).hostname;
    if(host==='blog.csdn.net')return '保留 CSDN 文章正文、代码、目录、作者信息及必要阅读操作。隐藏广告、会员营销、课程推广、活动推荐和无关侧栏推荐。不要按文章主题筛选；与正文混合时保留。';
    if(host==='www.csdn.net')return '保留 CSDN 首页的文章信息流、技术资讯、开源项目、导航和搜索。隐藏广告、会员营销、课程推广和活动推荐。不要按内容主题筛选；功能不明确时保留。';
    if(host==='www.zhihu.com'||host==='zhuanlan.zhihu.com')return LEGACY_CONTEXT;
  }catch{}
  return DEFAULT_CONTEXT;
}
function validateBlocks(payload) {
  if (!Array.isArray(payload?.blocks) || !payload.blocks.length || payload.blocks.length > 5) throw new Error('每批需提供 1 至 5 个模块');
  const ids = new Set();
  return payload.blocks.map(block => {
    if (!block || typeof block.id !== 'string' || !block.id || block.id.length > 512 || ids.has(block.id)) throw new Error('模块 id 无效或重复');
    ids.add(block.id);
    const clean = {id: block.id};
    if (block.structural !== undefined) {
      if (typeof block.structural !== 'string' || block.structural.length > 1500) throw new Error('模块 structural 无效');
      clean.structural = block.structural;
    }
    for (const [name, limit] of [['text',8000],['tag',80],['role',80]]) {
      if (typeof block[name] !== 'string' || block[name].length > limit) throw new Error(`模块 ${name} 无效`);
      clean[name] = block[name];
    }
    for (const name of ['images','links']) {
      if (!Array.isArray(block[name]) || block[name].length > 12) throw new Error(`模块 ${name} 无效`);
      clean[name] = block[name].map(item => {
        if (typeof item === 'string' && item.length <= 2000) return item;
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`模块 ${name} 无效`);
        const fields = name === 'images' ? ['alt','src','title'] : ['text','href','title'];
        if (Object.keys(item).some(key => !fields.includes(key)) || Object.values(item).some(value => typeof value !== 'string' || value.length > 2000)) throw new Error(`模块 ${name} 无效`);
        return Object.fromEntries(fields.filter(key => Object.hasOwn(item,key)).map(key => [key,item[key]]));
      });
    }
    return clean;
  });
}
const onWeb = url => {try {return ['http:','https:'].includes(new URL(url).protocol);} catch {return false;}};
const onZhihu = url => {try {return ['https://www.zhihu.com','https://zhuanlan.zhihu.com'].includes(new URL(url).origin);} catch {return false;}};
const csdnArticle = url => {try {const u=new URL(url);return u.origin==='https://blog.csdn.net' && /^\/[^/]+\/article\/details\/\d+\/?$/.test(u.pathname);}catch{return false;}};
function splitScope(raw) {
  const url=new URL(raw);
  if(csdnArticle(raw)) return url.origin+'|type:/:author/article/details/:id';
  return url.origin+'|type:'+url.pathname.split('/').map(segment=>/^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(segment)?':id':segment).join('/');
}
const compactSplitDescriptor = block => ({tag:block.tag,role:block.role,text:block.text.slice(0,400),structural:(block.structural||'').slice(0,500)});
export function createMessageHandler(chromeApi, fetchImpl = fetch) {
  const ready = Promise.all([chromeApi.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),chromeApi.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})]);
  const pending = new Map();
  let active = 0;
  const queue = [];
  async function limited(work) {
    if (active >= 3) await new Promise(resolve => queue.push(resolve));
    else active++;
    try {return await work();} finally {const next = queue.shift(); if(next) next(); else active--;}
  }
  const config = async url => {
    const values = await chromeApi.storage.local.get(['enabled','context','jevApiKey']);
    const origin = onWeb(url) ? new URL(url).origin : '';
    const siteValues=origin?await chromeApi.storage.local.get(['ai:'+origin,'context:'+origin]):{};
    const site=siteValues['ai:'+origin];
    const localContext=siteValues['context:'+origin];
    const legacy=onZhihu(url)&&typeof values.context==='string'?values.context:undefined;
    const experienceKey=origin?'splitExperience:'+splitScope(url):'';
    const experience=experienceKey?(await chromeApi.storage.local.get(experienceKey))[experienceKey]:null;
    return {splitExperienceAvailable:Array.isArray(experience)&&experience.length>0,aiEnabled: typeof site === 'boolean' ? site : onZhihu(url), enabled: values.enabled !== false, origin, context: typeof localContext==='string'?localContext:legacy??defaultContext(url), configured: Boolean(values.jevApiKey)};
  };
  const activeTab = async () => (await chromeApi.tabs.query({active:true,currentWindow:true})).find(tab => onWeb(tab.url));
  const notifyConfig = async () => {
    const tabs = await chromeApi.tabs.query({url:['http://*/*','https://*/*']});
    await Promise.allSettled(tabs.map(tab => chromeApi.tabs.sendMessage(tab.id,{type:'configChanged'})));
  };
  return (message, sender, respond) => {
    const popup = ['popup.html','popup.html?embedded=1'].some(path => sender.url === chromeApi.runtime.getURL(path)) && (!sender.id || sender.id === chromeApi.runtime.id);
    const content = Boolean(sender.tab) && sender.frameId !== undefined && sender.frameId === 0 && onWeb(sender.url) && (!sender.id || sender.id === chromeApi.runtime.id);
    const allowed = popup ? ['configGet','configSet','keyClear','statusGet','retry','pageAction'] : content ? ['configGet','classify','classifyCategories','splitBlock','statusSet','rulesGet','rulesSet','rulesDelete','rulesUndo','snapshotGet','snapshotSet'] : [];
    if (!allowed.includes(message?.type)) {respond({ok:false,error:'不允许的插件请求'}); return false;}
    (async () => {
      await ready;
      const {type,payload} = message;
      const targetTab = popup ? (sender.tab || await activeTab()) : sender.tab;
      const targetUrl = content ? sender.url : targetTab?.url;
      if(type==='snapshotGet'||type==='snapshotSet')return snapshotRequest(chromeApi.storage.local,type,payload,new URL(sender.url).origin);
      if (type === 'configGet') return config(targetUrl);
      if (type === 'configSet') {
        if (typeof payload?.enabled !== 'boolean' || typeof payload.context !== 'string' || payload.context.length > 4000) throw new Error('设置无效，阅读需求最多 4000 字符');
        if(!onWeb(targetUrl))throw new Error('请在目标网页中保存阅读需求');
        const update = {enabled:payload.enabled,['context:'+new URL(targetUrl).origin]:payload.context};
        if (payload.aiEnabled !== undefined) {
          if (typeof payload.aiEnabled !== 'boolean' || !onWeb(targetUrl)) throw new Error('请在网页中设置 AI 净化');
          update['ai:'+new URL(targetUrl).origin] = payload.aiEnabled;
        }
        if (payload.key !== undefined) {
          if (typeof payload.key !== 'string' || payload.key.length > 2048) throw new Error('API Key 无效');
          if (payload.key) {if (payload.key.length < 16 || /\s/.test(payload.key)) throw new Error('请输入完整的 API Key，不能包含空白字符'); update.jevApiKey = payload.key;}
        }
        await chromeApi.storage.local.set(update); await notifyConfig(); return config(targetUrl);
      }
      if (type === 'keyClear') {await chromeApi.storage.local.remove('jevApiKey'); await notifyConfig(); return config(targetUrl);}
      if (['rulesGet','rulesSet','rulesDelete','rulesUndo'].includes(type)) {
        const origin = new URL(sender.url).origin;
        const validKey = key => typeof key === 'string' && key.length <= 3000 && key.startsWith(origin+'|');
        const keys = type === 'rulesSet' ? [payload?.key] : payload?.keys;
        if (!Array.isArray(keys) || !keys.length || keys.length > 3 || !keys.every(validKey)) throw new Error('规则范围无效');
        if (type === 'rulesGet') {
          const values = await chromeApi.storage.local.get(keys.flatMap(key=>['rules:'+key,'partitions:'+key]));
          const groups=keys.filter(key=>Array.isArray(values['rules:'+key])).map(key=>({key,rules:values['rules:'+key],...(Array.isArray(values['partitions:'+key])?{partitions:values['partitions:'+key]}:{})}));
          const siteKey=origin+'|site';
          if(keys.includes(siteKey)&&!Array.isArray(values['rules:'+siteKey])) {
            const all=await chromeApi.storage.local.get(null), categories=new Map();
            for(const [key,rules] of Object.entries(all)) {
              if(!(key.startsWith('rules:'+origin+'|type:')||key.startsWith('rules:'+origin+'|page:'))||!Array.isArray(rules))continue;
              for(const rule of rules)if(rule?.category&&rule.category!=='other'&&Object.hasOwn(CATEGORY_LABELS,rule.category)&&(!categories.has(rule.category)||rule.action==='keep'))categories.set(rule.category,{category:rule.category,label:rule.label,...(rule.action?{action:rule.action}:{})});
            }
            if(categories.size)groups.unshift({key:siteKey,rules:[...categories.values()]});
          }
          // Older versions included the author in article type keys. Keep local
          // selectors on that author's pages; only semantic preferences can cross authors.
          const articleKey = origin+'|type:/:author/article/details/:id';
          if (!groups.length && csdnArticle(sender.url) && keys.includes(articleKey)) {
            const author = new URL(sender.url).pathname.split('/')[1];
            const legacyKey = origin+'|type:/'+author+'/article/details/:id';
            const all = await chromeApi.storage.local.get(null);
            if (Array.isArray(all['rules:'+legacyKey])) {
              groups.push({key:legacyKey,rules:all['rules:'+legacyKey],legacy:true,...(Array.isArray(all['partitions:'+legacyKey])?{partitions:all['partitions:'+legacyKey]}:{})});
            } else {
              const sources = Object.keys(all).filter(key=>/^rules:https:\/\/blog\.csdn\.net\|type:\/[^/:]+\/article\/details\/:id\/?$/.test(key) && Array.isArray(all[key])).sort();
              const categories = new Map();
              for (const source of sources) for (const rule of all[source]) {
                if (!rule?.category || rule.category === 'other' || !Object.hasOwn(CATEGORY_LABELS,rule.category)) continue;
                // Preserve keep exceptions if older authors have conflicting preferences.
                if (!categories.has(rule.category) || rule.action === 'keep') categories.set(rule.category,{category:rule.category,label:rule.label,...(rule.action?{action:rule.action}:{})});
              }
              if (categories.size) groups.push({key:articleKey,rules:[...categories.values()],migratedFrom:sources.map(key=>key.slice(6))});
            }
          }
          return {groups};
        }
        const restored = [];
        if (type === 'rulesSet') {
          const validSelector = selector => typeof selector === 'string' && Boolean(selector.trim()) && selector.length <= 1500;
          const validRule = rule => {
            if (!rule || typeof rule.label !== 'string' || rule.label.length > 100) return false;
            if (Object.hasOwn(rule,'action') && !['hide','keep'].includes(rule.action)) return false;
            if (Object.hasOwn(rule, 'page') && (typeof rule.page !== 'string' || rule.page.length > 3000 || !rule.page.startsWith(origin+'|page:/'))) return false;
            if (Object.hasOwn(rule, 'category')) return !Object.hasOwn(rule, 'selector') && !Object.hasOwn(rule, 'page') && rule.category !== 'other' && Object.hasOwn(CATEGORY_LABELS, rule.category)
              && (!Object.hasOwn(rule, 'overrides') || (Array.isArray(rule.overrides) && rule.overrides.length <= 100 && rule.overrides.every(validSelector)));
            return !Object.hasOwn(rule, 'overrides') && validSelector(rule.selector);
          };
          if (!Array.isArray(payload.rules) || payload.rules.length > 100 || !payload.rules.every(validRule)) throw new Error('规则内容无效');
          const hasBase=Object.hasOwn(payload,'baseRules');
          if(hasBase&&(!Array.isArray(payload.baseRules)||payload.baseRules.length>100||!payload.baseRules.every(validRule)))throw new Error('规则内容无效');
          const mergeSite=hasBase&&payload.key===origin+'|site';
          const hasPartitions = Object.hasOwn(payload,'partitions');
          if (hasPartitions && (!Array.isArray(payload.partitions) || payload.partitions.length > 40 || !payload.partitions.every(partition => partition && validSelector(partition.parent) && (!Object.hasOwn(partition,'pageType')||(typeof partition.pageType==='string'&&partition.pageType.length<=3000&&partition.pageType.startsWith(origin+'|type:'))) && Array.isArray(partition.parts) && new Set(partition.parts).size >= 2 && partition.parts.length <= 20 && partition.parts.every(validSelector)))) throw new Error('拆分边界无效');
          const previousValues = await chromeApi.storage.local.get(['rules:'+payload.key,'partitions:'+payload.key]);
          const previous = previousValues['rules:'+payload.key];
          const previousPartitions = previousValues['partitions:'+payload.key];
          const learningScope=splitScope(sender.url), provisionalKey='splitProvisional:'+sender.tab.id, experienceKey='splitExperience:'+learningScope;
          const saved=(await chromeApi.storage.local.get(experienceKey))[experienceKey];
          const provisional=(await chromeApi.storage.session.get(provisionalKey))[provisionalKey];
          const examples=provisional?.scope===learningScope?provisional.examples:[];
          const cleanRule=rule=>({...('category' in rule?{category:rule.category,label:rule.label,...('overrides' in rule?{overrides:[...new Set(rule.overrides)]}:{})}:{selector:rule.selector,label:rule.label,...('page' in rule?{page:rule.page}:{})}),...('action' in rule?{action:rule.action}:{})});
          let rules=payload.rules.map(cleanRule);
          if(mergeSite) {
            const identity=rule=>'category' in rule?'category:'+rule.category:'page' in rule?'page-selector:'+JSON.stringify([rule.page,rule.selector]):'selector:'+rule.selector;
            const base=new Map(payload.baseRules.map(rule=>[identity(rule),cleanRule(rule)])), next=new Map(rules.map(rule=>[identity(rule),rule]));
            const merged=new Map((Array.isArray(previous)?previous:payload.baseRules).map(rule=>[identity(rule),cleanRule(rule)]));
            for(const id of base.keys())if(!next.has(id))merged.delete(id);
            for(const [id,rule] of next)if(!base.has(id)||JSON.stringify(base.get(id))!==JSON.stringify(rule))merged.set(id,rule);
            rules=[...merged.values()];
            if(rules.length>100)throw new Error('规则数量超过上限');
          }
          let partitions=hasPartitions?payload.partitions.map(partition=>({parent:partition.parent,parts:[...new Set(partition.parts)],...(partition.pageType?{pageType:partition.pageType}:{})})):[];
          if(mergeSite&&hasPartitions) {
            partitions=[...new Map([...(Array.isArray(previousPartitions)?previousPartitions:[]),...partitions].map(partition=>[JSON.stringify([partition.pageType||'',partition.parent]),partition])).values()];
            if(partitions.length>40)throw new Error('拆分边界数量超过上限');
          }
          await chromeApi.storage.local.set({['rulesUndo:'+payload.key]:{rules:Array.isArray(previous)?previous:null,partitions:Array.isArray(previousPartitions)?previousPartitions:null,experienceKey,experience:Array.isArray(saved)?saved:null},['rules:'+payload.key]:rules,...(hasPartitions?{['partitions:'+payload.key]:partitions}:{})});
          if(payload.learnSplit===true&&hasPartitions&&payload.partitions.length&&examples?.length) {
            const combined=[...examples,...(Array.isArray(saved)?saved:[])];
            const unique=[...new Map(combined.map(example=>[JSON.stringify(example),example])).values()].slice(0,3);
            await chromeApi.storage.local.set({[experienceKey]:unique});
            await chromeApi.storage.session.remove(provisionalKey);
          }
        } else if (type === 'rulesUndo') {
          const values = await chromeApi.storage.local.get(keys.map(key=>'rulesUndo:'+key));
          for (const key of new Set(keys)) {
            const previous = values['rulesUndo:'+key];
            if (!previous || !(previous.rules === null || Array.isArray(previous.rules))) continue;
            if (previous.rules === null) await chromeApi.storage.local.remove('rules:'+key);
            else await chromeApi.storage.local.set({['rules:'+key]:previous.rules});
            if (Object.hasOwn(previous,'partitions')) {
              if (Array.isArray(previous.partitions)) await chromeApi.storage.local.set({['partitions:'+key]:previous.partitions});
              else await chromeApi.storage.local.remove('partitions:'+key);
            }
            if(previous.experienceKey==='splitExperience:'+splitScope(sender.url)) {
              if(Array.isArray(previous.experience))await chromeApi.storage.local.set({[previous.experienceKey]:previous.experience});
              else await chromeApi.storage.local.remove(previous.experienceKey);
            }
            await chromeApi.storage.local.remove('rulesUndo:'+key);
            restored.push(key);
          }
        } else {
          await chromeApi.storage.local.remove('splitExperience:'+splitScope(sender.url));
          await chromeApi.storage.session.remove('splitProvisional:'+sender.tab.id);
          for (const key of keys) {
            await chromeApi.storage.local.remove('rules:'+key);
            await chromeApi.storage.local.remove('partitions:'+key);
            await chromeApi.storage.local.remove('rulesUndo:'+key);
          }
          const canonical=origin+'|type:/:author/article/details/:id';
          if(csdnArticle(sender.url)&&keys.includes(canonical))await chromeApi.storage.local.set({['rules:'+canonical]:[]});
        }
        const tabs = await chromeApi.tabs.query({url:origin+'/*'});
        await Promise.allSettled(tabs.filter(tab=>onWeb(tab.url) && new URL(tab.url).origin===origin).map(tab=>chromeApi.tabs.sendMessage(tab.id,{type:'rulesChanged'})));
        return type === 'rulesUndo' ? {restored} : {};
      }
      if (type === 'statusSet') {
        if (!Number.isInteger(payload?.hidden) || payload.hidden < 0 || !Number.isInteger(payload.pending) || payload.pending < 0 || typeof payload.error !== 'string' || payload.error.length > 500) throw new Error('状态无效');
        await chromeApi.storage.session.set({['status:'+sender.tab.id]:{hidden:payload.hidden,pending:payload.pending,error:payload.error}}); return {};
      }
      if (type === 'statusGet' || type === 'retry' || type === 'pageAction') {
        const tab = targetTab && onWeb(targetTab.url) ? targetTab : undefined;
        if (!tab) return {hidden:0,pending:0,error:'请在普通网页使用',available:false};
        if (type === 'pageAction') {
          if (!['preview','clearRules','toggleVisibility','undoSave'].includes(payload?.action)) throw new Error('页面操作无效');
          const reply = await chromeApi.tabs.sendMessage(tab.id,{type:'pageAction',action:payload.action});
          if (reply?.ok === false) throw new Error(reply.error || '页面操作失败');
          return {};
        }
        if (type === 'retry') {await chromeApi.tabs.sendMessage(tab.id,{type:'retry'}); return {};}
        const settings=await config(tab.url);
        const reason=!settings.enabled?'网页净化已关闭':!settings.aiEnabled?'此网站尚未开启智能识别，可在设置中开启或手动选择':!settings.configured?'尚未配置密钥，可直接手动选择区域':'';
        return {reason,...((await chromeApi.storage.session.get('status:'+tab.id))['status:'+tab.id] ?? {hidden:0,pending:0,error:''}),available:true};
      }
      if (type === 'splitBlock') {
        const [parent] = validateBlocks({blocks:[payload?.parent]});
        if (!Array.isArray(payload.blocks) || payload.blocks.length < 2 || payload.blocks.length > 20) throw new Error('拆分需提供 2 至 20 个候选模块');
        const blocks = [];
        for (let i = 0; i < payload.blocks.length; i += 5) blocks.push(...validateBlocks({blocks:payload.blocks.slice(i,i+5)}));
        if (new Set([parent.id,...blocks.map(block=>block.id)]).size !== blocks.length + 1) throw new Error('模块 id 无效或重复');
        const settings = await config(targetUrl);
        if (!settings.enabled) throw new Error('网页净化已关闭');
        if (!settings.aiEnabled) throw new Error('此网站尚未开启 AI 净化，请在设置中开启后拆分');
        const {jevApiKey} = await chromeApi.storage.local.get('jevApiKey');
        if (!jevApiKey) throw new Error('请先在插件中保存 Jev API Key');
        const learningScope=splitScope(sender.url), experienceKey='splitExperience:'+learningScope;
        const saved=(await chromeApi.storage.local.get(experienceKey))[experienceKey];
        const result=await limited(()=>splitBlock(parent,blocks,jevApiKey,fetchImpl,Array.isArray(saved)?saved.slice(0,3):[]));
        if(result.ids.length>=2&&!payload.auto) {
          const provisionalKey='splitProvisional:'+sender.tab.id;
          const example={parent:compactSplitDescriptor(parent),parts:blocks.filter(block=>result.ids.includes(block.id)).map(compactSplitDescriptor)};
          const provisional=(await chromeApi.storage.session.get(provisionalKey))[provisionalKey];
          await chromeApi.storage.session.set({[provisionalKey]:{scope:learningScope,examples:[example,...(!payload.resetLearning&&provisional?.scope===learningScope?provisional.examples:[])].slice(0,3)}});
        }
        return result;
      }
      const blocks = validateBlocks(payload);
      const settings = await config(targetUrl);
      if (!settings.enabled) return {results:[],errors:[]};
      if (!settings.aiEnabled) return {results:[],errors:blocks.map(block=>({id:block.id,error:'此网站尚未开启 AI 净化'}))};
      const {jevApiKey} = await chromeApi.storage.local.get('jevApiKey');
      if (!jevApiKey) throw new Error('请先在插件中保存 Jev API Key');
      const results = [],errors = [];
      const categoryMode = type === 'classifyCategories';
      await Promise.all(blocks.map(async block => {
        try {
          const {id,...descriptor} = block;
          const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([categoryMode ? 'category-v2' : settings.context,descriptor])));
          const key = (categoryMode ? 'category:' : 'result:')+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
          const cached = (await chromeApi.storage.session.get(key))[key];
          if (cached) {results.push({...cached,id}); return;}
          if (!pending.has(key)) {
            const promise = limited(async () => {
              const result = categoryMode ? await classifyCategory(block,jevApiKey,fetchImpl) : await classifyBlock(block,settings.context,jevApiKey,fetchImpl);
              const answer = categoryMode ? {category:result.category,confidence:result.confidence} : {hide:result.hide,confidence:result.confidence};
              await chromeApi.storage.session.set({[key]:answer}); return answer;
            });
            pending.set(key,promise);
            promise.then(()=>pending.delete(key),()=>pending.delete(key));
          }
          results.push({...await pending.get(key),id});
        } catch(error) {errors.push({id:block.id,error:error.message});}
      }));
      return {results,errors};
    })().then(data=>respond({ok:true,data})).catch(error=>respond({ok:false,error:error.message}));
    return true;
  };
}
if (typeof chrome !== 'undefined') chrome.runtime.onMessage.addListener(createMessageHandler(chrome));
