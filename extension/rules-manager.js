'use strict';

(() => {
  const {t, applyStatic} = globalThis.PagePureI18n;
  const $ = id => document.getElementById(id);
  const selected = new Set();
  let entries = [], revision, loading = false, deleting = false, stale = false, refreshPending = false;
  let dialogIds = [], dialogRevision;
  const filtered = () => {
    const query = $('search').value.trim().toLocaleLowerCase();
    return entries.filter(entry => [entry.address, entry.origin, entry.label].some(value => String(value || '').toLocaleLowerCase().includes(query)));
  };
  const scopeLabel = entry => entry.scope === 'page' ? t('mgrScopePage') : entry.scope === 'type' ? t('mgrScopeType') : t('mgrScopeSite');
  const addressLabel = entry => entry.address || entry.origin || entry.label || t('managerUnknownAddress');
  function status(message = '', error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) {
      const detail = result?.error;
      const error = new Error(typeof detail === 'string' ? detail : detail?.message || result?.message || t('managerErrorDefault'));
      error.code = detail?.code || result?.code || '';
      throw error;
    }
    return result.data;
  }
  function updateSelection() {
    const visible = filtered();
    const checked = visible.filter(entry => selected.has(entry.id)).length;
    $('selectAll').checked = visible.length > 0 && checked === visible.length;
    $('selectAll').indeterminate = checked > 0 && checked < visible.length;
    $('selectAll').disabled = loading || !visible.length;
    $('selectedCount').textContent = selected.size ? t('managerSelectedCount', selected.size) : t('managerNoneSelected');
    $('clearSelection').hidden = !selected.size;
    $('deleteSelected').disabled = loading || !selected.size;
    $('deleteSelected').textContent = selected.size ? t('managerDeleteSelectedCount', selected.size) : t('managerDeleteSelected');
  }
  function render() {
    const visible = filtered();
    $('entries').replaceChildren();
    for (const entry of visible) {
      const row = document.createElement('label');
      row.className = `entry${selected.has(entry.id) ? ' selected' : ''}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(entry.id);
      checkbox.setAttribute('aria-label', t('managerEntryAria', addressLabel(entry), scopeLabel(entry), entry.count));
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(entry.id); else selected.delete(entry.id);
        row.classList.toggle('selected', checkbox.checked);
        updateSelection();
      });
      const icon = document.createElement('span');
      icon.className = 'site-icon';
      icon.textContent = '◎';
      icon.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      copy.className = 'entry-copy';
      const title = document.createElement('span');
      title.className = 'entry-title';
      title.textContent = addressLabel(entry);
      copy.append(title);
      if (entry.label && entry.label !== addressLabel(entry) && entry.label !== scopeLabel(entry)) {
        const subtitle = document.createElement('span');
        subtitle.className = 'entry-address';
        subtitle.textContent = entry.label;
        copy.append(subtitle);
      }
      const meta = document.createElement('span');
      meta.className = 'entry-meta';
      const scope = document.createElement('span');
      scope.className = 'scope';
      scope.textContent = scopeLabel(entry);
      const count = document.createElement('span');
      count.className = 'entry-count';
      const number = document.createElement('strong');
      number.textContent = entry.count;
      count.replaceChildren(number, t('managerRulesSuffix'));
      meta.append(scope, count);
      row.append(checkbox, icon, copy, meta);
      $('entries').append(row);
    }
    $('total').textContent = $('search').value.trim() ? `${visible.length} / ${entries.length}` : entries.length;
    $('ruleTotal').textContent = t('managerRuleTotal', entries.reduce((sum, entry) => sum + entry.count, 0));
    $('empty').hidden = !!visible.length || loading;
    $('emptyTitle').textContent = t(entries.length ? 'managerEmptyNoMatch' : 'managerEmptyNone');
    $('emptyDescription').textContent = t(entries.length ? 'managerEmptyNoMatchDesc' : 'managerEmptyNoneDesc');
    updateSelection();
  }
  async function refresh({ preserveStatus = false } = {}) {
    if (loading || deleting) { refreshPending = true; return; }
    if ($('confirmDialog').open) { markStale(); return; }
    loading = true;
    $('refresh').disabled = true;
    updateSelection();
    if (!preserveStatus) status(t('managerLoading'));
    try {
      const data = await request({ type: 'rulesManagerList' });
      if (!data || !Array.isArray(data.entries) || data.revision === undefined) throw new Error(t('managerErrorLoad'));
      entries = data.entries;
      revision = data.revision;
      stale = false;
      const valid = new Set(entries.map(entry => entry.id));
      for (const id of selected) if (!valid.has(id)) selected.delete(id);
      if (!preserveStatus) status();
    } catch (error) { status(error.message || t('managerErrorLoadFallback'), true); }
    finally {
      loading = false;
      $('refresh').disabled = false;
      render();
      if (refreshPending) { refreshPending = false; void refresh({ preserveStatus: true }); }
    }
  }
  function markStale() {
    stale = true;
    $('confirmDelete').disabled = true;
    $('dialogStatus').textContent = t('managerStaleDialog');
  }
  $('search').addEventListener('input', render);
  $('refresh').addEventListener('click', () => void refresh());
  $('selectAll').addEventListener('change', () => {
    for (const entry of filtered()) {
      if ($('selectAll').checked) selected.add(entry.id); else selected.delete(entry.id);
    }
    render();
  });
  $('clearSelection').addEventListener('click', () => { selected.clear(); render(); });
  $('deleteSelected').addEventListener('click', () => {
    const targets = entries.filter(entry => selected.has(entry.id));
    if (!targets.length || loading) return;
    dialogIds = targets.map(entry => entry.id);
    dialogRevision = revision;
    $('confirmDescription').textContent = t('managerConfirmSummary', targets.length, targets.reduce((sum, entry) => sum + entry.count, 0));
    $('confirmEntries').replaceChildren();
    for (const entry of targets) {
      const item = document.createElement('li');
      const address = document.createElement('span');
      address.className = 'confirm-address';
      address.textContent = `${addressLabel(entry)} · ${scopeLabel(entry)}`;
      const count = document.createElement('span');
      count.className = 'confirm-count';
      count.textContent = t('managerCountShort', entry.count);
      item.append(address, count);
      $('confirmEntries').append(item);
    }
    $('dialogStatus').textContent = '';
    $('confirmDelete').disabled = stale;
    $('confirmDialog').showModal();
    $('cancelDelete').focus();
    if (stale) markStale();
  });
  $('confirmDialog').addEventListener('cancel', event => { if (deleting) event.preventDefault(); });
  $('confirmDialog').addEventListener('close', () => {
    if (stale || refreshPending) { refreshPending = false; void refresh({ preserveStatus: true }); }
  });
  $('confirmDelete').addEventListener('click', async () => {
    if (deleting || stale) return;
    deleting = true;
    $('confirmDelete').disabled = true;
    $('cancelDelete').disabled = true;
    $('confirmDelete').textContent = t('managerDeleting');
    try {
      await request({ type: 'rulesManagerDelete', payload: { ids: dialogIds, revision: dialogRevision } });
      for (const id of dialogIds) selected.delete(id);
      status(t('managerDeleted', dialogIds.length));
    } catch (error) {
      status(/revision|stale|conflict/i.test(`${error.code} ${error.message}`) ? t('managerStaleRetry') : t('managerDeleteFailed', error.message), true);
    } finally {
      deleting = false;
      stale = false;
      refreshPending = false;
      $('cancelDelete').disabled = false;
      $('confirmDelete').textContent = t('managerConfirmDelete');
      $('confirmDialog').close();
      await refresh({ preserveStatus: true });
    }
  });
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== 'local' || !Object.keys(_changes).some(key => key.startsWith('rules:'))) return;
    if (deleting) { refreshPending = true; return; }
    if ($('confirmDialog').open) markStale();
    else void refresh({ preserveStatus: true });
  });
  function showView(view) {
    const rules = view === 'rules';
    $('rules-view').hidden = !rules;
    $('settings-view').hidden = rules;
    $('nav-rules').setAttribute('aria-current', rules ? 'page' : 'false');
    $('nav-settings').setAttribute('aria-current', rules ? 'false' : 'page');
  }
  $('nav-rules').addEventListener('click', event => { event.preventDefault(); showView('rules'); });
  $('nav-settings').addEventListener('click', event => { event.preventDefault(); showView('settings'); });
  const uiLocale = $('uiLocale');
  chrome.storage.local.get('uiLocale').then(values => { uiLocale.value = values.uiLocale || 'default'; }).catch(() => {});
  uiLocale.addEventListener('change', async () => {
    try {
      if (uiLocale.value === 'default') await chrome.storage.local.remove(['uiLocale', 'uiMessages']);
      else {
        // Persist the message table with the choice: content scripts read the
        // table from storage instead of fetching extension files.
        const response = await fetch(chrome.runtime.getURL(`_locales/${uiLocale.value}/messages.json`));
        const messages = response.ok ? await response.json() : null;
        if (messages) await chrome.storage.local.set({uiLocale: uiLocale.value, uiMessages: messages});
        else await chrome.storage.local.remove('uiLocale');
      }
    } catch { /* Keep the previous language when saving fails. */ }
    try { location.reload(); } catch { /* Test environments have no location. */ }
  });
  globalThis.PagePureI18n.ready.then(() => { applyStatic(); void refresh(); });
})();
