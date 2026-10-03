import {managerRequest} from './rules-manager-store.mjs';
import {snapshotRequest} from './snapshots.mjs';
import {classifyBlock, splitBlock} from './classifier.mjs';
import './i18n.js';
const {t} = globalThis.PagePureI18n;
export const DEFAULT_CONTEXT = '屏蔽：商业广告、付费推广、赞助内容、诱导下载或购买的营销模块';
function validateBlocks(payload) {
  if (!Array.isArray(payload?.blocks) || !payload.blocks.length || payload.blocks.length > 5) throw new Error(t('bgErrorBatchCount'));
  const ids = new Set();
  return payload.blocks.map(block => {
    if (!block || typeof block.id !== 'string' || !block.id || block.id.length > 512 || ids.has(block.id)) throw new Error(t('bgErrorBlockId'));
    ids.add(block.id);
    const clean = {id: block.id};
    if (block.structural !== undefined) {
      if (typeof block.structural !== 'string' || block.structural.length > 1500) throw new Error(t('bgErrorBlockField', 'structural'));
      clean.structural = block.structural;
    }
    for (const [name, limit] of [['text',8000],['tag',80],['role',80]]) {
      if (typeof block[name] !== 'string' || block[name].length > limit) throw new Error(t('bgErrorBlockField', name));
      clean[name] = block[name];
    }
    for (const name of ['images','links']) {
      if (!Array.isArray(block[name]) || block[name].length > 12) throw new Error(t('bgErrorBlockField', name));
      clean[name] = block[name].map(item => {
        if (typeof item === 'string' && item.length <= 2000) return item;
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(t('bgErrorBlockField', name));
        const fields = name === 'images' ? ['alt','src','title'] : ['text','href','title'];
        if (Object.keys(item).some(key => !fields.includes(key)) || Object.values(item).some(value => typeof value !== 'string' || value.length > 2000)) throw new Error(t('bgErrorBlockField', name));
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
  // Some Chromium forks expose storage without the optional access-level API.
  // Do not throw before the message listener can be registered in those builds.
  const ready = Promise.all([chromeApi.storage.local,chromeApi.storage.session].map(area =>
    typeof area?.setAccessLevel === 'function' ? area.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}) : undefined));
  let ruleWrites = Promise.resolve();
  const pending = new Map();
  let credentialEpoch = 0;
  const siteEpochs = new Map(), jobs = new Set();
  const epoch = origin => `${credentialEpoch}:${siteEpochs.get(origin) || 0}`;
  const canceled = () => Object.assign(new Error(t('statusPurifierOff')), {code:'canceled'});
  function invalidateAI(origin) {
    if (origin) siteEpochs.set(origin, (siteEpochs.get(origin) || 0) + 1);
    else credentialEpoch++;
    for (const job of jobs) if (!origin || job.origin === origin) job.controller.abort();
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].job.controller.signal.aborted) queue.splice(i,1)[0].reject(canceled());
  }
  let active = 0;
  const queue = [];
  async function limited(origin, expectedEpoch, work) {
    if (epoch(origin) !== expectedEpoch) throw canceled();
    const job = {origin, controller:new AbortController()};
    jobs.add(job);
    let acquired = false;
    try {
      if (active >= 3) await new Promise((resolve,reject) => queue.push({resolve,reject,job}));
      else active++;
      acquired = true;
      if (job.controller.signal.aborted || epoch(origin) !== expectedEpoch) throw canceled();
      let result;
      try {result = await work(job.controller.signal);}
      catch(error) {
        if (error?.code === 'canceled' || job.controller.signal.aborted || epoch(origin) !== expectedEpoch) throw canceled();
        throw error;
      }
      if (job.controller.signal.aborted || epoch(origin) !== expectedEpoch) throw canceled();
      return result;
    } finally {
      jobs.delete(job);
      if (acquired) {const next = queue.shift(); if(next) next.resolve(); else active--;}
    }
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
    return {splitExperienceAvailable:Array.isArray(experience)&&experience.length>0,aiEnabled: typeof site === 'boolean' ? site : onZhihu(url), enabled: values.enabled !== false, origin, context: typeof localContext==='string'?localContext:legacy??DEFAULT_CONTEXT, configured: Boolean(values.jevApiKey)};
  };
  const activeTab = async () => (await chromeApi.tabs.query({active:true,currentWindow:true})).find(tab => onWeb(tab.url));
  const notifyConfig = async () => {
    const tabs = await chromeApi.tabs.query({url:['http://*/*','https://*/*']});
    await Promise.allSettled(tabs.map(tab => chromeApi.tabs.sendMessage(tab.id,{type:'configChanged'})));
  };
  return (message, sender, respond) => {
    const popupUrl = ['popup.html','popup.html?embedded=1'].some(path => sender.url === chromeApi.runtime.getURL(path)) && sender.id === chromeApi.runtime.id;
    const embedded = popupUrl && Boolean(sender.tab);
    let settingsTabId;
    try {
      const url = new URL(sender.url), base = new URL(chromeApi.runtime.getURL('settings.html'));
      if (sender.id === chromeApi.runtime.id && sender.frameId === 0 && url.protocol === base.protocol && url.host === base.host && url.pathname === base.pathname && /^\d+$/.test(url.searchParams.get('tabId') || '') && [...url.searchParams.keys()].length === 1) settingsTabId = Number(url.searchParams.get('tabId'));
    } catch {}
    const settingsPage = Number.isSafeInteger(settingsTabId);
    const popup = (popupUrl && !sender.tab) || settingsPage;
    const manager = sender.url === chromeApi.runtime.getURL('rules-manager.html') && sender.id === chromeApi.runtime.id;
    const content = Boolean(sender.tab) && sender.frameId !== undefined && sender.frameId === 0 && onWeb(sender.url) && (!sender.id || sender.id === chromeApi.runtime.id);
    const allowed = manager ? ['rulesManagerList','rulesManagerDelete'] : popup ? ['rulesManagerOpen','configGet','configSet','keyClear','statusGet','retry','pageAction'] : embedded ? ['configGet','statusGet','settingsOpen','pageAction'] : content ? ['i18nGet','configGet','classify','splitBlock','statusSet','rulesGet','rulesSet','rulesDelete','rulesClearPage','rulesUndo','snapshotGet','snapshotSet'] : [];
    if (!allowed.includes(message?.type)) {respond({ok:false,error:t('bgDisallowed')}); return false;}
    const work = async () => {
      await ready;
      const {type,payload} = message;
      if(type==='rulesManagerOpen'){await chromeApi.tabs.create({url:chromeApi.runtime.getURL('rules-manager.html')});return {};}
      if(manager)return managerRequest(chromeApi,type,payload);
      if (type === 'i18nGet') {
        // Content scripts cannot read storage.local (it is locked to trusted
        // contexts because the API key lives there), so they ask for the
        // active locale table instead.
        await globalThis.PagePureI18n.ready;
        const {uiLocale, uiMessages} = await chromeApi.storage.local.get(['uiLocale', 'uiMessages']);
        return uiLocale && uiMessages && typeof uiMessages === 'object' ? {locale: uiLocale, messages: uiMessages} : {};
      }
      const siteChanged = () => Object.assign(new Error(t('bgErrorSiteChanged')), {code:'siteChanged'});
      let targetTab;
      try { targetTab = settingsPage ? await chromeApi.tabs.get(settingsTabId) : popup ? await activeTab() : sender.tab; }
      catch (error) { if (settingsPage && Object.hasOwn(payload || {}, 'expectedOrigin')) throw siteChanged(); throw error; }
      const targetUrl = content ? sender.url : targetTab?.url;
      const checkOrigin = async () => {
        const required = settingsPage && ['configSet','keyClear','retry','pageAction'].includes(type);
        if (!required && !Object.hasOwn(payload || {}, 'expectedOrigin')) return;
        if (!onWeb(payload?.expectedOrigin) || new URL(payload.expectedOrigin).origin !== payload.expectedOrigin) throw new Error(t('bgErrorSettings'));
        // The captured URL and the live tab must both match the displayed site.
        let currentUrl;
        try { currentUrl = targetTab ? (await chromeApi.tabs.get(targetTab.id)).url : undefined; }
        catch { throw siteChanged(); }
        if (!onWeb(targetUrl) || new URL(targetUrl).origin !== payload.expectedOrigin || !onWeb(currentUrl) || new URL(currentUrl).origin !== payload.expectedOrigin) throw siteChanged();
      };
      await checkOrigin();
      if (settingsPage && !onWeb(targetUrl)) throw new Error(t('bgErrorSaveOnWeb'));
      const aiOrigin = onWeb(targetUrl) ? new URL(targetUrl).origin : '';
      const expectedEpoch = epoch(aiOrigin);
      if (type === 'settingsOpen') {
        if (!onWeb(targetUrl)) throw new Error(t('bgErrorSaveOnWeb'));
        await chromeApi.tabs.create({url:chromeApi.runtime.getURL('settings.html')+'?tabId='+targetTab.id});
        return {};
      }
      if(type==='snapshotGet'||type==='snapshotSet')return snapshotRequest(chromeApi.storage.local,type,payload,new URL(sender.url).origin);
      if (type === 'configGet') return {...await config(targetUrl), limited:embedded};
      if (type === 'configSet') {
        if (typeof payload?.enabled !== 'boolean' || typeof payload.context !== 'string' || payload.context.length > 4000) throw new Error(t('bgErrorSettings'));
        if(!onWeb(targetUrl))throw new Error(t('bgErrorSaveOnWeb'));
        const current = await config(targetUrl);
        // Older saved free-form goals remain usable when only toggling settings.
        if (payload.context !== current.context && (!payload.context.trim() || /^屏蔽\s*[:：][\s、，,]*$/u.test(payload.context.trim()))) throw new Error(t('bgErrorSettings'));
        const update = {enabled:payload.enabled,['context:'+new URL(targetUrl).origin]:payload.context};
        if (payload.aiEnabled !== undefined) {
          if (typeof payload.aiEnabled !== 'boolean' || !onWeb(targetUrl)) throw new Error(t('bgErrorAiOnWeb'));
          update['ai:'+new URL(targetUrl).origin] = payload.aiEnabled;
        }
        if (payload.key !== undefined) {
          if (typeof payload.key !== 'string' || payload.key.length > 2048) throw new Error(t('bgErrorInvalidKey'));
          if (payload.key) {if (payload.key.length < 16 || /\s/.test(payload.key)) throw new Error(t('bgErrorKeyWhitespace')); update.jevApiKey = payload.key;}
        }
        await checkOrigin();
        await chromeApi.storage.local.set(update);
        invalidateAI(Object.hasOwn(update,'jevApiKey') || payload.enabled !== current.enabled ? undefined : aiOrigin);
        await notifyConfig(); return config(targetUrl);
      }
      if (type === 'keyClear') {await checkOrigin(); await chromeApi.storage.local.remove('jevApiKey'); invalidateAI(); await notifyConfig(); return config(targetUrl);}
      if (['rulesGet','rulesSet','rulesDelete','rulesClearPage','rulesUndo'].includes(type)) {
        const origin = new URL(sender.url).origin;
        const validKey = key => typeof key === 'string' && key.length <= 3000 && key.startsWith(origin+'|');
        const keys = type === 'rulesSet' ? [payload?.key] : payload?.keys;
        if (!Array.isArray(keys) || !keys.length || keys.length > 3 || !keys.every(validKey)) throw new Error(t('bgErrorRuleScope'));
        if (type === 'rulesGet') {
          const values = await chromeApi.storage.local.get(keys.flatMap(key=>['rules:'+key,'partitions:'+key]));
          const groups=keys.filter(key=>Array.isArray(values['rules:'+key])).map(key=>({key,rules:values['rules:'+key].filter(rule=>rule && !Object.hasOwn(rule,'category') && typeof rule.selector==='string'),...(Array.isArray(values['partitions:'+key])?{partitions:values['partitions:'+key]}:{})}));
          // Older versions included the author in article type keys. Keep local
          // selectors on that author's pages without reviving retired category rules.
          const articleKey = origin+'|type:/:author/article/details/:id';
          const onlyEmptyPageMarkers = groups.every(group => group.key.startsWith(origin+'|page:') && !group.rules.length && !group.partitions?.length);
          if (onlyEmptyPageMarkers && csdnArticle(sender.url) && keys.includes(articleKey)) {
            const author = new URL(sender.url).pathname.split('/')[1];
            const legacyKey = origin+'|type:/'+author+'/article/details/:id';
            const all = await chromeApi.storage.local.get(null);
            if (Array.isArray(all['rules:'+legacyKey])) {
              groups.push({key:legacyKey,rules:all['rules:'+legacyKey].filter(rule=>rule && !Object.hasOwn(rule,'category') && typeof rule.selector==='string'),legacy:true,...(Array.isArray(all['partitions:'+legacyKey])?{partitions:all['partitions:'+legacyKey]}:{})});
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
            if (Object.hasOwn(rule, 'category')) return false;
            return !Object.hasOwn(rule, 'overrides') && validSelector(rule.selector);
          };
          if (!Array.isArray(payload.rules) || payload.rules.length > 100 || !payload.rules.every(validRule)) throw new Error(t('bgErrorRuleContent'));
          const hasBase=Object.hasOwn(payload,'baseRules');
          if(hasBase&&(!Array.isArray(payload.baseRules)||payload.baseRules.length>100||!payload.baseRules.every(validRule)))throw new Error(t('bgErrorRuleContent'));
          const mergeSite=hasBase&&payload.key===origin+'|site';
          const hasPartitions = Object.hasOwn(payload,'partitions');
          if (hasPartitions && (!Array.isArray(payload.partitions) || payload.partitions.length > 40 || !payload.partitions.every(partition => partition && validSelector(partition.parent) && (!Object.hasOwn(partition,'pageType')||(typeof partition.pageType==='string'&&partition.pageType.length<=3000&&partition.pageType.startsWith(origin+'|type:'))) && Array.isArray(partition.parts) && new Set(partition.parts).size >= 2 && partition.parts.length <= 20 && partition.parts.every(validSelector)))) throw new Error(t('bgErrorPartition'));
          const previousValues = await chromeApi.storage.local.get(['rules:'+payload.key,'partitions:'+payload.key]);
          const previous = previousValues['rules:'+payload.key];
          const previousPartitions = previousValues['partitions:'+payload.key];
          const learningScope=splitScope(sender.url), provisionalKey='splitProvisional:'+sender.tab.id, experienceKey='splitExperience:'+learningScope;
          const saved=(await chromeApi.storage.local.get(experienceKey))[experienceKey];
          const provisional=(await chromeApi.storage.session.get(provisionalKey))[provisionalKey];
          const examples=provisional?.scope===learningScope?provisional.examples:[];
          const cleanRule=rule=>({selector:rule.selector,label:rule.label,...('page' in rule?{page:rule.page}:{}),...('action' in rule?{action:rule.action}:{})});
          let rules=payload.rules.map(cleanRule);
          if(mergeSite) {
            const identity=rule=>'page' in rule?'page-selector:'+JSON.stringify([rule.page,rule.selector]):'selector:'+rule.selector;
            const base=new Map(payload.baseRules.map(rule=>[identity(rule),cleanRule(rule)])), next=new Map(rules.map(rule=>[identity(rule),rule]));
            const merged=new Map((Array.isArray(previous)?previous.filter(validRule):payload.baseRules).map(rule=>[identity(rule),cleanRule(rule)]));
            for(const id of base.keys())if(!next.has(id))merged.delete(id);
            for(const [id,rule] of next)if(!base.has(id)||JSON.stringify(base.get(id))!==JSON.stringify(rule))merged.set(id,rule);
            rules=[...merged.values()];
            if(rules.length>100)throw new Error(t('bgErrorTooManyRules'));
          }
          let partitions=hasPartitions?payload.partitions.map(partition=>({parent:partition.parent,parts:[...new Set(partition.parts)],...(partition.pageType?{pageType:partition.pageType}:{})})):[];
          if(mergeSite&&hasPartitions) {
            partitions=[...new Map([...(Array.isArray(previousPartitions)?previousPartitions:[]),...partitions].map(partition=>[JSON.stringify([partition.pageType||'',partition.parent]),partition])).values()];
            if(partitions.length>40)throw new Error(t('bgErrorTooManyPartitions'));
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
        } else if (type === 'rulesClearPage') {
          const url = new URL(sender.url), pageKey = origin+'|page:'+url.pathname+url.search;
          const values = await chromeApi.storage.local.get(null), update = {};
          const ownedScope = key => key === origin+'|site' || key.startsWith(origin+'|type:/') || key.startsWith(origin+'|page:/');
          for (const [storageKey, value] of Object.entries(values)) {
            if (storageKey.startsWith('rules:') && ownedScope(storageKey.slice(6)) && Array.isArray(value)) {
              const remaining = storageKey === 'rules:'+pageKey ? [] : value.filter(rule => rule?.page !== pageKey);
              if (remaining.length !== value.length) update[storageKey] = remaining;
            }
            if (storageKey.startsWith('rulesUndo:') && ownedScope(storageKey.slice(10)) && storageKey !== 'rulesUndo:'+pageKey && Array.isArray(value?.rules)) {
              const remaining = value.rules.filter(rule => rule?.page !== pageKey);
              if (remaining.length !== value.rules.length) update[storageKey] = {...value, rules:remaining};
            }
          }
          // Preserve empty markers and shared history so a later read or undo cannot revive this page's exceptions.
          update['rules:'+pageKey] = [];
          await chromeApi.storage.local.set(update);
          for (const key of ['partitions:'+pageKey, 'rulesUndo:'+pageKey]) await chromeApi.storage.local.remove(key);
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
        if (!Number.isInteger(payload?.hidden) || payload.hidden < 0 || !Number.isInteger(payload.pending) || payload.pending < 0 || typeof payload.error !== 'string' || payload.error.length > 500) throw new Error(t('bgErrorStatus'));
        await chromeApi.storage.session.set({['status:'+sender.tab.id]:{hidden:payload.hidden,pending:payload.pending,error:payload.error}}); return {};
      }
      if (type === 'statusGet' || type === 'retry' || type === 'pageAction') {
        const tab = targetTab && onWeb(targetTab.url) ? targetTab : undefined;
        if (!tab) {
          if (type !== 'statusGet') throw new Error(t('bgStatusNotWebpage'));
          return {hidden:0,pending:0,error:t('bgStatusNotWebpage'),available:false};
        }
        if (type === 'pageAction') {
          if (embedded && !['preview','toggleVisibility'].includes(payload?.action)) throw new Error(t('bgDisallowed'));
          if (!['preview','clearRules','toggleVisibility','undoSave'].includes(payload?.action)) throw new Error(t('bgErrorPageAction'));
          await checkOrigin();
          if (settingsPage && payload.action === 'preview') await chromeApi.tabs.update(tab.id,{active:true});
          await checkOrigin();
          const reply = await chromeApi.tabs.sendMessage(tab.id,{type:'pageAction',action:payload.action});
          if (reply?.ok === false) throw new Error(reply.error || t('bgErrorPageActionFailed'));
          return {};
        }
        if (type === 'retry') {await checkOrigin(); await chromeApi.tabs.sendMessage(tab.id,{type:'retry'}); return {};}
        const settings=await config(tab.url);
        const reason=!settings.enabled?t('statusPurifierOff'):!settings.aiEnabled?t('bgReasonAiOff'):!settings.configured?t('bgReasonNoKey'):'';
        return {reason,...((await chromeApi.storage.session.get('status:'+tab.id))['status:'+tab.id] ?? {hidden:0,pending:0,error:''}),available:true};
      }
      if (type === 'splitBlock') {
        const [parent] = validateBlocks({blocks:[payload?.parent]});
        if (!Array.isArray(payload.blocks) || payload.blocks.length < 2 || payload.blocks.length > 20) throw new Error(t('bgErrorSplitCount'));
        const blocks = [];
        for (let i = 0; i < payload.blocks.length; i += 5) blocks.push(...validateBlocks({blocks:payload.blocks.slice(i,i+5)}));
        if (new Set([parent.id,...blocks.map(block=>block.id)]).size !== blocks.length + 1) throw new Error('模块 id 无效或重复');
        const settings = await config(targetUrl);
        if (!settings.enabled) throw new Error(t('statusPurifierOff'));
        if (!settings.aiEnabled) throw new Error(t('bgErrorAiOffSplit'));
        const {jevApiKey} = await chromeApi.storage.local.get('jevApiKey');
        if (!jevApiKey) throw new Error(t('bgErrorNeedKey'));
        const learningScope=splitScope(sender.url), experienceKey='splitExperience:'+learningScope;
        const saved=(await chromeApi.storage.local.get(experienceKey))[experienceKey];
        const result=await limited(aiOrigin,expectedEpoch,signal=>splitBlock(parent,blocks,jevApiKey,fetchImpl,Array.isArray(saved)?saved.slice(0,3):[],signal));
        if(result.ids.length===blocks.length&&!payload.auto) {
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
      if (!settings.aiEnabled) return {results:[],errors:blocks.map(block=>({id:block.id,error:t('bgErrorAiOff')}))};
      const {jevApiKey} = await chromeApi.storage.local.get('jevApiKey');
      if (!jevApiKey) throw new Error(t('bgErrorNeedKey'));
      const results = [],errors = [];
      await Promise.all(blocks.map(async block => {
        try {
          const {id,...descriptor} = block;
          const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['full-context-v2',settings.context,descriptor])));
          const key = 'result:'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
          const cached = (await chromeApi.storage.session.get(key))[key];
          if (cached) {results.push({...cached,id}); return;}
          const pendingKey = aiOrigin+'|'+expectedEpoch+'|'+key;
          if (!pending.has(pendingKey)) {
            const promise = limited(aiOrigin,expectedEpoch,async signal => {
              const result = await classifyBlock(block,settings.context,jevApiKey,fetchImpl,signal);
              const answer = {hide:result.hide,confidence:result.confidence};
              if (signal.aborted || epoch(aiOrigin) !== expectedEpoch) throw canceled();
              await chromeApi.storage.session.set({[key]:answer}); return answer;
            });
            pending.set(pendingKey,promise);
            promise.then(()=>pending.delete(pendingKey),()=>pending.delete(pendingKey));
          }
          results.push({...await pending.get(pendingKey),id});
        } catch(error) {
          if (error?.code === 'canceled') throw canceled();
          errors.push({id:block.id,error:error.message});
        }
      }));
      return {results,errors};
    };
    const writes=['rulesSet','rulesDelete','rulesClearPage','rulesUndo','rulesManagerDelete'];
    const result=writes.includes(message.type)?ruleWrites.then(work):work();
    if(writes.includes(message.type))ruleWrites=result.catch(()=>{});
    result.then(data=>respond({ok:true,data})).catch(error=>respond({ok:false,error:error.message,...(error.code?{code:error.code}:{})}));
    return true;
  };
}
if (typeof chrome !== 'undefined') {
  chrome.runtime.onMessage.addListener(createMessageHandler(chrome));
  // Locale changes made on the settings page must reach open tabs, whose
  // content scripts cannot watch storage directly; nudge them to re-fetch.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !(Object.hasOwn(changes, 'uiLocale') || Object.hasOwn(changes, 'uiMessages'))) return;
    chrome.tabs.query({url:['http://*/*','https://*/*']})
      .then(tabs => Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, {type:'localeChanged'}))))
      .catch(() => {});
  });
}
