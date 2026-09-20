'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const selected = new Set();
  let entries = [], revision, loading = false, deleting = false, stale = false, refreshPending = false;
  let dialogIds = [], dialogRevision;
  const filtered = () => {
    const query = $('search').value.trim().toLocaleLowerCase();
    return entries.filter(entry => [entry.address, entry.origin, entry.label].some(value => String(value || '').toLocaleLowerCase().includes(query)));
  };
  const scopeLabel = entry => entry.scope === 'page' ? '仅此页面' : entry.scope === 'type' ? '此类页面' : '整个网站';
  const addressLabel = entry => entry.address || entry.origin || entry.label || '未知地址';
  function status(message = '', error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) {
      const detail = result?.error;
      const error = new Error(typeof detail === 'string' ? detail : detail?.message || result?.message || '操作未完成，请重试。');
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
    $('selectedCount').textContent = selected.size ? `已选 ${selected.size} 个地址` : '未选择';
    $('clearSelection').hidden = !selected.size;
    $('deleteSelected').disabled = loading || !selected.size;
    $('deleteSelected').textContent = selected.size ? `清理所选（${selected.size}）` : '清理所选';
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
      checkbox.setAttribute('aria-label', `选择 ${addressLabel(entry)}，${scopeLabel(entry)}，${entry.count} 条规则`);
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
      count.append(number, '条规则');
      meta.append(scope, count);
      row.append(checkbox, icon, copy, meta);
      $('entries').append(row);
    }
    $('total').textContent = $('search').value.trim() ? `${visible.length} / ${entries.length}` : entries.length;
    $('ruleTotal').textContent = `共 ${entries.reduce((sum, entry) => sum + entry.count, 0)} 条规则`;
    $('empty').hidden = !!visible.length || loading;
    $('emptyTitle').textContent = entries.length ? '没有找到匹配的地址' : '还没有保存的规则';
    $('emptyDescription').textContent = entries.length ? '试试其他关键词，或清空搜索查看全部地址。' : '在网页中保存净化设置后，可以在这里统一管理。';
    updateSelection();
  }
  async function refresh({ preserveStatus = false } = {}) {
    if (loading || deleting) { refreshPending = true; return; }
    if ($('confirmDialog').open) { markStale(); return; }
    loading = true;
    $('refresh').disabled = true;
    updateSelection();
    if (!preserveStatus) status('正在读取规则…');
    try {
      const data = await request({ type: 'rulesManagerList' });
      if (!data || !Array.isArray(data.entries) || data.revision === undefined) throw new Error('规则读取失败，请刷新重试。');
      entries = data.entries;
      revision = data.revision;
      stale = false;
      const valid = new Set(entries.map(entry => entry.id));
      for (const id of selected) if (!valid.has(id)) selected.delete(id);
      if (!preserveStatus) status();
    } catch (error) { status(error.message || '读取失败，请刷新重试。', true); }
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
    $('dialogStatus').textContent = '规则已发生变化。请取消后重新确认清理范围。';
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
    $('confirmDescription').textContent = `将清理 ${targets.length} 个地址的 ${targets.reduce((sum, entry) => sum + entry.count, 0)} 条规则，无法撤销。未选中的网站共享规则仍可能生效。`;
    $('confirmEntries').replaceChildren();
    for (const entry of targets) {
      const item = document.createElement('li');
      const address = document.createElement('span');
      address.className = 'confirm-address';
      address.textContent = `${addressLabel(entry)} · ${scopeLabel(entry)}`;
      const count = document.createElement('span');
      count.className = 'confirm-count';
      count.textContent = `${entry.count} 条`;
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
    $('confirmDelete').textContent = '正在清理…';
    try {
      await request({ type: 'rulesManagerDelete', payload: { ids: dialogIds, revision: dialogRevision } });
      for (const id of dialogIds) selected.delete(id);
      status(`已清理 ${dialogIds.length} 个地址的规则。`);
    } catch (error) {
      status(/revision|stale|conflict|变化|过期/i.test(`${error.code} ${error.message}`) ? '规则已发生变化，已更新列表。请核对所选地址后重新确认。' : `${error.message} 已保留仍存在的所选地址，请核对后重试。`, true);
    } finally {
      deleting = false;
      stale = false;
      refreshPending = false;
      $('cancelDelete').disabled = false;
      $('confirmDelete').textContent = '确认清理';
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
  void refresh();
})();
