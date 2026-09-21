// The manager exposes addresses and counts only, never selectors or credentials.
import './i18n.js';
const {t} = globalThis.PagePureI18n;
function scopeInfo(key) {
  if(typeof key!=='string')return null;
  const at=key.indexOf('|');if(at<0)return null;
  const origin=key.slice(0,at),scope=key.slice(at+1);
  try {const u=new URL(origin);if(!['http:','https:'].includes(u.protocol)||u.origin!==origin)return null;}catch{return null;}
  if(scope==='site')return {origin,address:origin,scope:'site',label:t('mgrScopeSite')};
  const match=/^(page|type):(\/.*)$/.exec(scope);if(!match)return null;
  return {origin,address:origin+match[2],scope:match[1],label:match[1]==='page'?t('mgrScopePage'):t('mgrScopeType')};
}
function effectiveKey(key,rule) {
  const base=scopeInfo(key),page=scopeInfo(rule?.page);
  return base&&page&&page.scope==='page'&&page.origin===base.origin?rule.page:key;
}
async function inventory(values) {
  const entries=new Map(),sources=Object.entries(values).filter(([k,v])=>k.startsWith('rules:')&&Array.isArray(v)&&scopeInfo(k.slice(6))).sort(([a],[b])=>a.localeCompare(b));
  for(const [storageKey,rules] of sources)for(const rule of rules) {
    // Retired category preferences no longer run or count as active rules.
    if(typeof rule?.selector!=='string'||!rule.selector||rule.category)continue;
    const id=effectiveKey(storageKey.slice(6),rule),info=scopeInfo(id);
    if(!entries.has(id))entries.set(id,{id,...info,count:0});
    entries.get(id).count++;
  }
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(sources)));
  return {entries:[...entries.values()].sort((a,b)=>a.origin.localeCompare(b.origin)||a.address.localeCompare(b.address)||a.scope.localeCompare(b.scope)),revision:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')};
}
export async function managerRequest(api,type,payload) {
  const storage=api.storage.local,values=await storage.get(null),current=await inventory(values);
  if(type==='rulesManagerList')return current;
  if(!Array.isArray(payload?.ids)||!payload.ids.length||new Set(payload.ids).size!==payload.ids.length||payload.ids.some(id=>typeof id!=='string'||!current.entries.some(e=>e.id===id)))throw Object.assign(new Error(t('mgrEntriesChanged')),{code:'revision'});
  if(payload.revision!==current.revision)throw Object.assign(new Error(t('mgrRevisionChanged')),{code:'revision'});
  const ids=new Set(payload.ids),origins=new Set(current.entries.filter(e=>ids.has(e.id)).map(e=>e.origin)),update={},remove=new Set();
  for(const [storageKey,rules] of Object.entries(values)) {
    if(!storageKey.startsWith('rules:')||!Array.isArray(rules)||!scopeInfo(storageKey.slice(6)))continue;
    const key=storageKey.slice(6),remaining=rules.filter(rule=>!ids.has(effectiveKey(key,rule)));
    if(remaining.length===rules.length)continue;
    // Empty arrays prevent legacy rule migration from silently restoring a cleared scope.
    update[storageKey]=remaining;
    remove.add('rulesUndo:'+key);
    if(!remaining.length)remove.add('partitions:'+key);
  }
  // Undo records for the same origin may contain copies of page exceptions.
  for(const key of Object.keys(values))for(const origin of origins)if(['rulesUndo:','snapshot-v1:','splitExperience:'].some(prefix=>key.startsWith(prefix+origin+'|')))remove.add(key);
  await storage.set(update);
  for(const key of remove)await storage.remove(key);
  const tabs=await api.tabs.query({url:['http://*/*','https://*/*']});
  await Promise.allSettled(tabs.filter(tab=>{try{return origins.has(new URL(tab.url).origin);}catch{return false;}}).map(tab=>api.tabs.sendMessage(tab.id,{type:'rulesChanged',source:'manager'})));
  return {};
}
