(() => {
  'use strict';
  // chrome.i18n is native in extension pages, content scripts and the service
  // worker. The lookup stays dynamic so tests and the demo page can swap the
  // chrome global after this file has been evaluated.
  let overrideTable = null, overrideLocale = '';
  const raw = key => {
    if (overrideTable) { const entry = overrideTable[key]; if (entry) return entry.message; }
    try { return chrome.i18n.getMessage(key) || ''; } catch { return ''; }
  };
  const t = (key, ...subs) => raw(key).replace(/\{(\d)\}/g, (token, index) => subs[index - 1] ?? token);
  const applyStatic = () => {
    try {
      document.documentElement.lang = overrideLocale ? overrideLocale.replace('_', '-') : chrome.i18n.getUILanguage();
    } catch { /* The document default stays. */ }
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.getAttribute('data-i18n'));
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.getAttribute('data-i18n-title'));
    for (const el of document.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  };
  // The locale chosen on the settings view is stored together with its message
  // table in chrome.storage.local. Storage is the one channel every context
  // can read: content scripts must not rely on fetching extension files
  // (web-accessible fetches are blocked in several browser builds), and the
  // service worker has no DOM. Unshipped or unreadable values silently fall
  // back to the browser language.
  // Extension pages and the service worker are trusted: they read the stored
  // preference directly. Content scripts are not — storage.local is locked to
  // trusted contexts (the API key lives there) — so they request the active
  // table from the service worker, exactly like every other shared setting.
  const trusted = (() => { try { return location?.protocol === 'chrome-extension:'; } catch { return false; } })();
  async function refreshLocale() {
    try {
      if (trusted) {
        const {uiLocale, uiMessages} = await chrome.storage.local.get(['uiLocale', 'uiMessages']);
        if (!uiLocale) { overrideTable = null; overrideLocale = ''; return; }
        if (uiMessages && typeof uiMessages === 'object') { overrideTable = uiMessages; overrideLocale = uiLocale; return; }
        // Heal a preference saved before its table was persisted.
        const response = await fetch(chrome.runtime.getURL(`_locales/${uiLocale}/messages.json`));
        if (response.ok) {
          const messages = await response.json();
          overrideTable = messages; overrideLocale = uiLocale;
          await chrome.storage.local.set({uiMessages: messages});
        }
      } else {
        const response = await chrome.runtime.sendMessage({type: 'i18nGet'});
        const payload = response?.ok ? response.data : null;
        if (payload?.locale && payload.messages && typeof payload.messages === 'object') {
          overrideTable = payload.messages; overrideLocale = payload.locale;
        } else { overrideTable = null; overrideLocale = ''; }
      }
    } catch { /* Follow the browser language. */ }
  }
  let ready = refreshLocale();
  try {
    if (trusted) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (Object.hasOwn(changes, 'uiLocale') || Object.hasOwn(changes, 'uiMessages'))) ready = refreshLocale();
      });
    } else {
      chrome.runtime.onMessage.addListener(msg => {
        if (msg?.type === 'localeChanged') ready = refreshLocale();
      });
    }
  } catch { /* Events are unavailable in some test harnesses. */ }
  globalThis.PagePureI18n = {t, applyStatic, get ready() { return ready; }};
})();
