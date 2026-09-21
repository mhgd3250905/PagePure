(() => {
  const forbidden = 'html, body, script, style, template, [data-jev-ui]';
  const escape = value => Array.from(String(value)).map((char, index) =>
    /[a-zA-Z_-]/.test(char) || (index > 0 && /[0-9]/.test(char)) ? char : `\\${char.codePointAt(0).toString(16)} `).join('');
  const quote = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, ' ')}"`;
  const stable = value => value && value.length < 100 &&
    !/^(?:css|jsx|sc)-|[a-f0-9]{8,}|\d{5,}|^:|^react[-_]/i.test(value);

  function scope(raw, mode = 'type') {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error(globalThis.PagePureI18n.t('manualHttpOnly'));
    if (mode === 'site') return url.origin + '|site';
    if (mode === 'page') return url.origin + '|page:' + url.pathname + url.search;
    if (url.hostname === 'blog.csdn.net' && /^\/[^/]+\/article\/details\/\d+\/?$/.test(url.pathname)) return url.origin + '|type:/:author/article/details/:id';
    const path = url.pathname.split('/').map(segment =>
      /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(segment) ? ':id' : segment).join('/');
    return url.origin + '|type:' + path;
  }

  function describeRule(node, doc = node?.ownerDocument, {snapshotOnly=false} = {}) {
    if (!node || !doc || node.matches(forbidden) || node.closest('[data-jev-ui]') || node.querySelector('[data-jev-ui]')) return null;
    let attempts=0;
    const unique = selector => {
      if(snapshotOnly&&++attempts>24)return false;
      try { const found = doc.querySelectorAll(selector); return found.length === 1 && found[0] === node; }
      catch { return false; }
    };
    function segments(element) {
      const tag = element.localName;
      const result = [];
      if (stable(element.id)) result.push(`#${escape(element.id)}`);
      for (const attribute of ['data-testid', 'data-test', 'data-component']) {
        const value = element.getAttribute(attribute);
        if (stable(value)) result.push(`${tag}[${attribute}=${quote(value)}]`);
      }
      const classes = [...element.classList].filter(stable).filter(value => !/^jev[-_]/.test(value));
      for (const value of classes) result.push(`${tag}.${escape(value)}`);
      if (classes.length > 1) result.push(tag + classes.map(value => `.${escape(value)}`).join(''));
      for (const attribute of ['role', 'aria-label']) {
        const value = element.getAttribute(attribute);
        if (value) result.push(`${tag}[${attribute}=${quote(value)}]`);
      }
      result.push(tag);
      return result;
    }
    const label = snapshotOnly ? '' : (node.getAttribute('aria-label') || node.getAttribute('data-testid') ||
      node.innerText || node.textContent || node.localName).replace(/\s+/g, ' ').trim().slice(0, 80);
    // Anonymous split containers can be identified by a stable descendant
    // (e.g. a service entry link), rather than the container's sibling index.
    for(const candidate of segments(node))if(unique(candidate))return {selector:candidate,label};
    // Repeated modules may be distinguished by a distant layout ancestor.
    // Keep semantic descendants instead of turning every intermediate wrapper
    // into nth-of-type before reaching that ancestor.
    const targets=segments(node).filter(value=>value!==node.localName);
    for(let ancestor=node.parentElement,depth=0;ancestor&&ancestor!==doc.body&&depth++<8;ancestor=ancestor.parentElement) {
      if(snapshotOnly&&attempts>=24)break;
      for(const prefix of segments(ancestor))for(const target of targets) {
        const candidate=prefix+' '+target;
        if(candidate.length<=1500&&unique(candidate))return {selector:candidate,label};
      }
    }
    if(snapshotOnly)return null;
    const anchors=[...node.querySelectorAll('[data-testid],[data-component],[id],a[href],[aria-label],[class]')].filter(anchor =>
      !anchor.closest('svg,script,style,[contenteditable],[data-jev-ui]')).slice(0,80);
    for(const anchor of anchors) {
      if(anchor.closest('script,style,[contenteditable],[data-jev-ui]'))continue;
      const hints=segments(anchor).filter(value=>value!==anchor.localName);
      const href=anchor.getAttribute('href');
      if(href && !/^(?:javascript:|#)/i.test(href)) {
        const base=href.split(/[?#]/)[0];
        if(base.length>1 && !/\d{5,}/.test(base))hints.push(`a[href^=${quote(base)}]`);
      }
      for(const hint of hints) {
        let relative=hint,current=anchor.parentElement,depth=0;
        while(current&&current!==node&&depth++<6){relative=current.localName+' > '+relative;current=current.parentElement;}
        if(current!==node)continue;
        for(const prefix of segments(node)) {
          const selector=prefix+':has(> '+relative+')';
          if(selector.length<=1500&&unique(selector))return {selector,label};
        }
      }
    }
    let tail = '';
    for (let current = node; current && current !== doc.documentElement; current = current.parentElement) {
      const alternatives = segments(current);
      for (const segment of alternatives) {
        const selector = segment + tail;
        if (unique(selector)) return {selector, label};
      }
      // Anchor an ambiguous module to a parent before resorting to its position.
      const parent = current.parentElement;
      if (parent) for (const prefix of segments(parent)) for (const segment of alternatives) {
        const selector = `${prefix} > ${segment}${tail}`;
        if (unique(selector)) return {selector, label};
      }
      const sameTag = parent ? [...parent.children].filter(child => child.localName === current.localName) : [current];
      const structural = `${current.localName}:nth-of-type(${sameTag.indexOf(current) + 1})`;
      tail = ` > ${structural}${tail}`;
    }
    const selector = `html${tail}`;
    return unique(selector) ? {selector, label} : null;
  }

  function matches(doc, rules) {
    const result = new Set();
    for (const rule of Array.isArray(rules) ? rules : []) {
      if (typeof rule?.selector !== 'string' || !rule.selector || rule.selector.length > 4096) continue;
      try {
        for (const node of doc.querySelectorAll(rule.selector)) {
          if (!node.matches(forbidden) && !node.closest('[data-jev-ui]') && !node.querySelector('[data-jev-ui]')) result.add(node);
        }
      } catch { /* A site's old or malformed selector must not interrupt other rules. */ }
    }
    return result;
  }
  globalThis.JevManual = {scope, describeRule, matches};
})();
