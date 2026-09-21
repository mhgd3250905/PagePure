// Shared i18n support for tests. Node-realm side effect: extension modules
// imported directly (background.js, manual.js, …) resolve zh_CN messages.
import {readFileSync} from 'node:fs';

const messages = JSON.parse(readFileSync(new URL('./extension/_locales/zh_CN/messages.json', import.meta.url), 'utf8'));
const i18nSource = readFileSync(new URL('./extension/i18n.js', import.meta.url), 'utf8');
const i18nChrome = {i18n: {getMessage: key => messages[key]?.message || '', getUILanguage: () => 'zh-CN'}};

// background.js auto-registers its handler on import: the stub needs enough
// surface (i18n, no-op runtime, storage areas) for that to stay harmless.
const chromeStub = globalThis.chrome || {};
chromeStub.i18n = chromeStub.i18n || i18nChrome.i18n;
chromeStub.runtime = chromeStub.runtime || {onMessage: {addListener() {}}};
chromeStub.storage = chromeStub.storage || {local: {}, session: {}};
globalThis.chrome = chromeStub;
globalThis.PagePureI18n = globalThis.PagePureI18n || {t(key, ...subs) {
  const message = messages[key]?.message || '';
  return message.replace(/\{(\d)\}/g, (token, index) => subs[index - 1] ?? token);
}, applyStatic() {}};

export {messages, i18nSource, i18nChrome};
