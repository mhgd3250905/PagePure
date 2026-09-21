(() => {
  const {t} = globalThis.PagePureI18n;
  const {collect, describe} = globalThis.JevZhihu;
  let config = {enabled: false, configured: false};
  let generation = 0, serial = 0, timer, active = false, dirty = false, lastError = '', paused = false;
  const records = new Map();
  const currentPage = () => document.location?.href || document.URL || '';
  let pageUrl = currentPage();
  async function message(type, payload) {
    const response = await chrome.runtime.sendMessage({type, payload});
    if (!response?.ok) throw new Error(response?.error || globalThis.PagePureI18n.t('contentNoHelper'));
    return response.data;
  }
  function report() {
    message('statusSet', {
      hidden: document.querySelectorAll('[data-jev-zhihu-hidden], [data-jev-manual-hidden]').length,
      pending: [...records.values()].filter(r => r.state === 'pending' || r.state === 'running').length + (globalThis.JevPreview?.pending || 0),
      error: globalThis.JevPreview?.error || lastError
    }).catch(() => {});
  }
  function restore() {
    for (const node of records.keys()) node.removeAttribute('data-jev-zhihu-hidden');
    records.clear();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(scan, 250); }
  function scan() {
    if (pageUrl !== currentPage()) { void reload(); return; }
    if (!config.enabled || config.aiEnabled === false || !config.configured || paused || globalThis.JevPreview?.active || globalThis.JevPreview?.hasRules) return;
    const nodes = new Set(collect(document));
    for (const [node] of records) {
      if (!node.isConnected || !nodes.has(node)) {
        node.removeAttribute('data-jev-zhihu-hidden'); records.delete(node);
      }
    }
    for (const node of nodes) {
      const data = describe(node), signature = JSON.stringify(data);
      const old = records.get(node);
      if (old?.signature === signature) continue;
      node.removeAttribute('data-jev-zhihu-hidden');
      records.set(node, {node, signature, data, id: String(++serial), state: 'pending'});
    }
    dirty = true;
    void process();
  }
  async function process() {
    if (active) return;
    active = true;
    try {
      while (dirty && config.enabled && config.aiEnabled !== false && config.configured && !globalThis.JevPreview?.active && !globalThis.JevPreview?.hasRules) {
        dirty = false;
        const batch = [...records.values()].filter(r => r.state === 'pending').slice(0, 5);
        if (!batch.length) break;
        const version = generation;
        batch.forEach(r => { r.state = 'running'; });
        report();
        try {
          const answer = await message('classify', {blocks: batch.map(r => ({id: r.id, ...r.data}))});
          if (version !== generation || pageUrl !== currentPage()) continue;
          const results = new Map((answer.results || []).map(r => [r.id, r]));
          for (const record of batch) {
            if (records.get(record.node) !== record) continue;
            const result = results.get(record.id);
            record.state = result ? 'done' : 'error';
            if (result?.hide === true && record.node.isConnected) record.node.setAttribute('data-jev-zhihu-hidden', '');
          }
          lastError = answer.errors?.[0]?.error || '';
          if (answer.errors?.length) { paused = true; break; }
        } catch (error) {
          if (version !== generation || pageUrl !== currentPage()) continue;
          batch.forEach(r => { r.state = 'error'; });
          lastError = error.message;
          paused = true;
          break;
        }
        dirty = [...records.values()].some(r => r.state === 'pending');
      }
    } finally { active = false; report(); }
  }
  async function reload() {
    const version = ++generation;
    pageUrl = currentPage();
    config = {enabled: false, configured: false};
    restore();
    try {
      const next = await message('configGet');
      if (version !== generation) return;
      config = next;
      lastError = '';
      paused = false;
      report();
      schedule();
    } catch (error) { lastError = error.message; report(); }
  }
  new MutationObserver(schedule).observe(document, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'href', 'src', 'alt']
  });
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'configChanged' || msg.type === 'retry') {
      void reload(); respond({ok: true});
    }
  });
  globalThis.addEventListener?.('popstate', schedule);
  globalThis.addEventListener?.('pageshow', schedule);
  globalThis.navigation?.addEventListener('navigatesuccess', schedule);
  globalThis.JevPage = {suspend() { generation++; restore(); }, resume: reload, report};
  void reload();
})();
