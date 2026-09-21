import {CATEGORY_LABELS} from './classifier.mjs';
import './i18n.js';
const {t} = globalThis.PagePureI18n;
export async function snapshotRequest(storage,type,payload,origin) {
  if(typeof payload?.key!=='string'||!payload.key.startsWith(origin+'|')||payload.key.length>3000||typeof payload.revision!=='string'||payload.revision.length>200000)throw new Error(t('snapScopeInvalid'));
  const key='snapshot-v1:'+payload.key;
  if(type==='snapshotGet') {
    const saved=(await storage.get(key))[key];
    return {entries:saved?.revision===payload.revision?saved.entries:[]};
  }
  if(!Array.isArray(payload.entries)||payload.entries.length>200||payload.entries.some(e=>typeof e.signature!=='string'||e.signature.length>16000||!Object.hasOwn(CATEGORY_LABELS,e.category)))throw new Error(t('snapContentInvalid'));
  await storage.set({[key]:{revision:payload.revision,entries:payload.entries.map(({signature,category})=>({signature,category}))}});
  return {};
}
