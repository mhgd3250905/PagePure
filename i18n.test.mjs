import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {messages} from './i18n-support.mjs';

const zh = JSON.parse(readFileSync(new URL('./extension/_locales/zh_CN/messages.json', import.meta.url), 'utf8'));
const en = JSON.parse(readFileSync(new URL('./extension/_locales/en/messages.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('./extension/manifest.json', import.meta.url), 'utf8'));
const i18nSource2 = () => readFileSync(new URL('./extension/i18n.js', import.meta.url), 'utf8');

import {readdirSync} from 'node:fs';
const locales = readdirSync(new URL('./extension/_locales', import.meta.url));
const tokensOf = message => (message.match(/\{\d\}/g) || []).sort();

test('every locale exposes the same non-empty keys and placeholders as zh_CN', () => {
  assert.ok(locales.length >= 12, `expected the full language matrix, found ${locales.length}`);
  for (const locale of locales) {
    if (locale === 'zh_CN') continue;
    const table = JSON.parse(readFileSync(new URL(`./extension/_locales/${locale}/messages.json`, import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(table).sort(), Object.keys(zh).sort(), `${locale} key set matches zh_CN`);
    for (const [key, entry] of Object.entries(table)) {
      assert.equal(typeof entry.message, 'string');
      assert.notEqual(entry.message.trim(), '', `${locale} message ${key} is non-empty`);
      assert.deepEqual(tokensOf(entry.message), tokensOf(zh[key].message), `${locale} ${key} keeps the zh_CN placeholders`);
    }
  }
});

test('each locale file is valid JSON with safe key names', () => {
  for (const [key, entry] of Object.entries(en)) {
    assert.match(key, /^[A-Za-z0-9_]+$/, `key ${key} uses safe characters`);
    assert.equal(typeof entry.message, 'string');
  }
});

test('manifest placeholders resolve and declare the default locale', () => {
  assert.equal(manifest.default_locale, 'zh_CN');
  for (const key of ['extName', 'extDescription']) assert.ok(zh[key] && en[key], `${key} exists`);
  assert.match(manifest.name, /^__MSG_extName__$/);
  assert.match(manifest.description, /^__MSG_extDescription__$/);
  assert.equal(manifest.action.default_title, '__MSG_extName__');
});

function assertStaticStrings(file) {
  const html = readFileSync(new URL(file, import.meta.url), 'utf8');
  const {document} = parseHTML(html);
  const localized = [];
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    assert.ok(zh[key], `${file}: data-i18n key ${key} exists`);
    // 中文界面文案与 zh_CN 消息保持逐字一致，防止两处漂移。
    assert.equal(el.textContent.trim(), zh[key].message.trim(), `${file}: ${key} text matches zh_CN`);
    localized.push(el);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = el.getAttribute('data-i18n-placeholder');
    assert.ok(zh[key], `${file}: placeholder key ${key} exists`);
    assert.equal(el.getAttribute('placeholder'), zh[key].message, `${file}: ${key} placeholder matches zh_CN`);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) {
    const key = el.getAttribute('data-i18n-aria-label');
    assert.ok(zh[key], `${file}: aria-label key ${key} exists`);
    assert.equal(el.getAttribute('aria-label'), zh[key].message, `${file}: ${key} aria-label matches zh_CN`);
  }
  assert.ok(localized.length > 0, `${file} localizes static text`);
}

test('popup.html static text stays in sync with zh_CN messages', () => {
  assertStaticStrings('./extension/popup.html');
});

test('rules-manager.html static text stays in sync with zh_CN messages', () => {
  assertStaticStrings('./extension/rules-manager.html');
});

test('localized UI scripts keep no hardcoded Chinese outside messages', () => {
  // HTML 静态文案是有意保留的默认语言回退，由上面的同步测试守护；此处只约束脚本。
  const files = ['popup.js', 'preview.js', 'console.js', 'rules-manager.js',
    'content.js', 'manual.js', 'snapshots.mjs', 'rules-manager-store.mjs', 'i18n.js'];
  const cjk = /[\u4e00-\u9fff]/;
  for (const file of files) {
    const source = readFileSync(new URL(`./extension/${file}`, import.meta.url), 'utf8');
    const hits = source.split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => cjk.test(line));
    assert.deepEqual(hits, [], `${file} should not hardcode Chinese`);
  }
});

test('content scripts receive the locale table from the service worker', async () => {
  const {runInNewContext} = await import('node:vm');
  const enTable = {managerSettingsNav: {message: 'Settings'}};
  let fetches = 0, storageReads = 0;
  const context = {
    location: {protocol: 'https:'},
    chrome: {
      storage: {local: {get: async () => { storageReads++; throw new Error('forbidden'); }}},
      i18n: {getMessage: key => zh[key]?.message || '', getUILanguage: () => 'zh-CN'},
      runtime: {sendMessage: async message => {
        assert.equal(message.type, 'i18nGet', 'content scripts must ask, not read storage');
        return {ok: true, data: {locale: 'en', messages: enTable}};
      }, onMessage: {addListener() {}}}
    },
    fetch: async () => { fetches++; throw new Error('content scripts must not fetch extension files'); }
  };
  runInNewContext(i18nSource2(), context);
  await context.PagePureI18n.ready;
  assert.equal(context.PagePureI18n.t('managerSettingsNav'), 'Settings');
  assert.equal(context.PagePureI18n.t('extName'), zh.extName.message, 'keys missing from the override fall back to the browser locale');
  assert.equal(fetches, 0);
  assert.equal(storageReads, 0);
});

test('trusted contexts replace stale cached messages from the current bundle without storage event loops', async () => {
  const {runInNewContext} = await import('node:vm');
  const jaTable = {managerSettingsNav: {message: '設定'}};
  let cachedTable = {managerSettingsNav: {message: 'Old settings'}}, listener;
  let writes = 0, fetches = 0;
  const context = {
    location: {protocol: 'chrome-extension:'},
    chrome: {
      i18n: {getMessage: key => zh[key]?.message || '', getUILanguage: () => 'zh-CN'},
      runtime: {getURL: path => path},
      storage: {local: {
        get: async () => ({uiLocale: 'ja', uiMessages: cachedTable}),
        set: async entries => {
          writes++;
          cachedTable = entries.uiMessages;
          listener({uiMessages: {newValue: cachedTable}}, 'local');
        }
      }, onChanged: {addListener(fn) { listener = fn; }}}
    },
    fetch: async path => {
      fetches++;
      assert.equal(path, '_locales/ja/messages.json');
      return {ok: true, json: async () => jaTable};
    }
  };
  runInNewContext(i18nSource2(), context);
  await context.PagePureI18n.ready;
  await context.PagePureI18n.ready;
  assert.equal(context.PagePureI18n.t('managerSettingsNav'), '設定');
  assert.equal(writes, 1, 'the refresh event must not write the same table again');
  assert.equal(fetches, 2);
  assert.deepEqual(cachedTable, jaTable);
});

test('trusted contexts retain cached translations when the bundled table cannot load', async () => {
  const {runInNewContext} = await import('node:vm');
  for (const failure of ['network', 'http']) {
    const context = {
      location: {protocol: 'chrome-extension:'},
      chrome: {
        i18n: {getMessage: key => zh[key]?.message || ''},
        runtime: {getURL: path => path},
        storage: {local: {get: async () => ({uiLocale: 'ja', uiMessages: {managerSettingsNav: {message: '設定'}}})}, onChanged: {addListener() {}}}
      },
      fetch: async () => {
        if (failure === 'network') throw new Error('unavailable');
        return {ok: false};
      }
    };
    runInNewContext(i18nSource2(), context);
    await context.PagePureI18n.ready;
    assert.equal(context.PagePureI18n.t('managerSettingsNav'), '設定');
  }
});

test('extension pages heal a locale saved without its table', async () => {
  const {runInNewContext} = await import('node:vm');
  const jaTable = {managerSettingsNav: {message: '設定'}};
  const sets = [];
  const context = {
    location: {protocol: 'chrome-extension:'},
    chrome: {
      i18n: {getMessage: key => zh[key]?.message || '', getUILanguage: () => 'zh-CN'},
      runtime: {getURL: path => path},
      storage: {local: {get: async () => ({uiLocale: 'ja'}), set: async entries => { sets.push(entries); }}, onChanged: {addListener() {}}}
    },
    fetch: async path => path === '_locales/ja/messages.json'
      ? {ok: true, json: async () => jaTable}
      : {ok: false, json: async () => ({})}
  };
  runInNewContext(i18nSource2(), context);
  await context.PagePureI18n.ready;
  assert.equal(context.PagePureI18n.t('managerSettingsNav'), '設定');
  assert.equal(sets.length, 1);
  assert.equal(sets[0].uiMessages, jaTable, 'the fetched table is persisted for the service worker to serve');
});

test('without a stored preference the browser language is used', async () => {
  const {runInNewContext} = await import('node:vm');
  const context = {
    location: {protocol: 'https:'},
    chrome: {
      i18n: {getMessage: key => zh[key]?.message || '', getUILanguage: () => 'zh-CN'},
      runtime: {sendMessage: async () => ({ok: true, data: {}}), onMessage: {addListener() {}}}
    },
    fetch: async () => { throw new Error('must not fetch'); }
  };
  runInNewContext(i18nSource2(), context);
  await context.PagePureI18n.ready;
  assert.equal(context.PagePureI18n.t('managerSettingsNav'), '设置');
});

test('a localeChanged broadcast switches language without a reload', async () => {
  const {runInNewContext} = await import('node:vm');
  const tables = {
    en: {managerSettingsNav: {message: 'Settings'}},
    ja: {managerSettingsNav: {message: '設定'}}
  };
  let current = null, broadcast;
  const context = {
    location: {protocol: 'https:'},
    chrome: {
      i18n: {getMessage: key => zh[key]?.message || '', getUILanguage: () => 'zh-CN'},
      runtime: {
        sendMessage: async () => current ? {ok: true, data: current} : {ok: true, data: {}},
        onMessage: {addListener(fn) { broadcast = fn; }}
      }
    },
    fetch: async () => { throw new Error('content scripts must not fetch extension files'); }
  };
  runInNewContext(i18nSource2(), context);
  await context.PagePureI18n.ready;
  assert.equal(context.PagePureI18n.t('managerSettingsNav'), '设置', 'no preference yet: browser language wins');
  current = {locale: 'en', messages: tables.en};
  broadcast({type: 'localeChanged'});
  await context.PagePureI18n.ready;
  assert.equal(context.PagePureI18n.t('managerSettingsNav'), 'Settings');
  current = {locale: 'ja', messages: tables.ja};
  broadcast({type: 'localeChanged'});
  await context.PagePureI18n.ready;
  assert.equal(context.PagePureI18n.t('managerSettingsNav'), '設定');
});

test('locale notification reaches mounted page UI only after its translated table is ready', async()=>{
 const {runInNewContext}=await import('node:vm');
 const {document}=parseHTML('<html><body></body></html>');
 let broadcast,current=null;
 const context={document,location:{protocol:'https:'},chrome:{i18n:{getMessage:key=>zh[key]?.message||''},runtime:{sendMessage:async()=>({ok:true,data:current||{}}),onMessage:{addListener(fn){broadcast=fn;}}}}};
 runInNewContext(i18nSource2(),context);await context.PagePureI18n.ready;
 const seen=[];document.addEventListener('pagepure-locale-changed',()=>seen.push(context.PagePureI18n.t('toolbarStamp')));
 current={locale:'en',messages:en};broadcast({type:'localeChanged'});await context.PagePureI18n.ready;
 current={locale:'zh_CN',messages:zh};broadcast({type:'localeChanged'});await context.PagePureI18n.ready;
 assert.deepEqual(seen,['Clean','净化']);
});
