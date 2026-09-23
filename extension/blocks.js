(() => {
  const boundary = '.Card, .List-item, article, section, aside, header, footer, nav, [role="article"], [role="listitem"]';
  const ignored = 'script,style,noscript,template,svg,input,textarea,select';
  const hidden = '[data-jev-zhihu-hidden], [data-jev-manual-hidden]';
  const ownedHidden = new WeakMap();
  // DOM attributes are page-writable. Keep extension UI ownership in this
  // isolated-world registry and use the marker only for diagnostics/CSS.
  const uiRoots = new Set(), uiByRole = new Map();
  function registerUi(node, role) {
    if (!node || node.nodeType !== 1) throw new TypeError('Extension UI root must be an element');
    uiRoots.add(node);
    if (role) uiByRole.set(role, node);
    return node;
  }
  function unregisterUi(node) {
    uiRoots.delete(node);
    for (const [role, root] of uiByRole) if (root === node) uiByRole.delete(role);
  }
  function isUi(node) {
    for (let current = node; current; current = current.parentElement || current.getRootNode?.().host) {
      if (uiRoots.has(current)) return true;
      if (current.nodeType === 9) break;
    }
    return false;
  }
  function containsUi(node) {
    if (!node || isUi(node)) return Boolean(node && isUi(node));
    for (const root of uiRoots) if (root === node || node.contains?.(root)) return true;
    return false;
  }
  const findUi = role => uiByRole.get(role) || null;
  const hideAttributes = new Set(['data-jev-zhihu-hidden', 'data-jev-manual-hidden', 'data-jev-preview-hide']);
  function setOwnedAttribute(registry, node, attribute, enabled) {
    let attributes = registry.get(node);
    if (enabled) {
      if (!attributes) registry.set(node, attributes = new Map());
      const record = attributes.get(attribute);
      if (record) {
        // Re-establish our marker if the page removed it, but do not overwrite
        // a value the page deliberately wrote while the marker was active.
        if (record.added && !node.hasAttribute(attribute)) node.setAttribute(attribute, record.value);
      } else {
        const existed = node.hasAttribute(attribute);
        const value = existed ? node.getAttribute(attribute) : '';
        attributes.set(attribute, { added: !existed, value });
        if (!existed) node.setAttribute(attribute, value);
      }
    } else {
      const record = attributes?.get(attribute);
      attributes?.delete(attribute);
      // Remove only the exact marker value this isolated world added. The page
      // may have owned the attribute already or changed it while hidden.
      if (record?.added && node.getAttribute(attribute) === record.value) node.removeAttribute(attribute);
    }
  }
  function setHidden(node, attribute, enabled) {
    if (!hideAttributes.has(attribute)) throw new Error('Unknown hide attribute');
    setOwnedAttribute(ownedHidden, node, attribute, enabled);
  }
  const isOwnedHidden = node => [...(ownedHidden.get(node) || [])]
    .some(([attribute, record]) => record.added && node.getAttribute(attribute) === record.value);
  const compact = text => (text || '').replace(/\s+/g, ' ').trim();
  function excluded(node) {
    if (String(node.ownerDocument.designMode).toLowerCase() === 'on') return true;
    for (let current = node; current; current = current.parentElement) {
      const editable = current.getAttribute('contenteditable')?.toLowerCase();
      if (current.matches(ignored) || isUi(current) ||
          editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
      const style = current.ownerDocument.defaultView?.getComputedStyle?.(current) || current.style;
      const cssValue = (property, cssProperty) =>
        style?.[property] ?? style?.getPropertyValue?.(cssProperty) ?? current.style?.[property] ?? current.style?.getPropertyValue?.(cssProperty);
      const opacity = Number.parseFloat(cssValue('opacity', 'opacity'));
      const filter = String(cssValue('filter', 'filter') || '');
      const zeroOpacityFilter = [...filter.matchAll(/opacity\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?\s*\)/gi)]
        .some(match => Number(match[1]) <= 0);
      const contentVisibility = cssValue('contentVisibility', 'content-visibility');
      // Our own display:none is a reversible classification state. Keep its
      // descriptor stable so subsequent scans do not reclassify an empty block.
      if (current.hasAttribute('hidden') || style?.visibility === 'hidden' || style?.visibility === 'collapse' ||
          (Number.isFinite(opacity) && opacity <= 0) || zeroOpacityFilter || contentVisibility === 'hidden' ||
          (style?.display === 'none' && !isOwnedHidden(current))) return true;
    }
    return false;
  }
  function readableCopy(node) {
    const copy = node.cloneNode(false);
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        if (!excluded(child)) copy.appendChild(readableCopy(child));
      } else if (child.nodeType === 3) copy.appendChild(child.cloneNode(true));
    }
    return copy;
  }
  function pathOnly(raw, base) {
    try { const url = new URL(raw, base); return /^https?:$/.test(url.protocol) ? (url.origin + url.pathname).slice(0, 400) : ''; }
    catch { return ''; }
  }
  function sectionContext(node) {
    for(let parent=node.parentElement,depth=0;parent && depth<5;parent=parent.parentElement,depth++) {
      if(parent.matches('body,main,[role="main"]'))break;
      const headings=[...parent.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
        .filter(h=>!node.contains(h) && !excluded(h));
      if(headings.length===1) {
        const heading = readableCopy(headings[0]);
        return compact(heading.textContent).slice(0,160);
      }
      if(headings.length>1)break;
    }
    return '';
  }
  function regionContext(node) {
    const regions = [];
    for (let parent = node.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth++) {
      if (parent.matches('body,html')) break;
      if (excluded(parent)) continue;
      const role = parent.getAttribute('role') || '';
      const landmark = parent.matches('main,aside,nav,header,footer,[role="main"],[role="complementary"],[role="navigation"],[role="dialog"],[role="feed"],[role="list"]');
      if (landmark) regions.push(`${parent.tagName} role=${role}`);
      if (depth < 3) regions.push(`container ${parent.tagName} ${String(parent.className || '').slice(0,100)}`);
    }
    return regions.join(' > ').slice(0,500);
  }
  function describe(node) {
    if (excluded(node)) return {text: '', tag: '', role: '', structural: '', images: [], links: []};
    const copy = readableCopy(node);
    const elements = selector => [...(copy.matches(selector) ? [copy] : []), ...copy.querySelectorAll(selector)];
    const embeds = elements('iframe,object,embed').slice(0, 3).map(item =>
      `${item.tagName} ${compact(item.getAttribute('title')).slice(0, 100)} ${pathOnly(item.getAttribute('src') || item.getAttribute('data') || '', node.ownerDocument.baseURI)}`
    ).join('; ').slice(0, 600);
    return {
      text: compact(copy.textContent).slice(0, 5000),
      tag: node.tagName,
      role: compact(`${node.getAttribute('role') || ''} ${node.className || ''}`).slice(0, 80),
      structural: compact(`Embeds ${embeds}; Section ${sectionContext(node)}; Regions ${regionContext(node)}; Parent ${node.parentElement?.tagName || ''} ${node.parentElement?.className || ''}; ${node.parentElement?.children.length > 1 ? 'multiple sibling blocks' : 'single child'}; headings ${copy.querySelectorAll('h1,h2,h3').length}; paragraphs ${copy.querySelectorAll('p').length}; text length ${compact(copy.textContent).length}; ancestor ${node.closest('main,aside,nav,footer,[role="main"],[role="feed"]')?.tagName || ''}`).slice(0,1500),
      images: elements('img').slice(0, 6).map(img => ({
        alt: compact(`${img.alt || ''} ${img.title || ''} ${img.parentElement?.className || ''}`).slice(0, 200),
        src: pathOnly(img.getAttribute('src') || img.getAttribute('data-src') || '', node.ownerDocument.baseURI)
      })),
      links: [...new Set(elements('a[href]').map(a => pathOnly(a.getAttribute('href'), node.ownerDocument.baseURI)).filter(Boolean))].slice(0, 8)
    };
  }
  // Layout boundaries never determine visibility. A card can be reading
  // content, a promotion, or another module: all are sent to Jev.
  function collect(doc, measure = node => node.getBoundingClientRect(), knownRegions = []) {
    const result = [];
    const regions=new Set(knownRegions.filter(node=>node.isConnected&&!excluded(node))), ancestors=new Set();
    for(const node of regions)for(let parent=node.parentElement;parent;parent=parent.parentElement)ancestors.add(parent);
    const root = doc.querySelector('.Topstory-container, .QuestionPage') ||
      (/^\/p\//.test(doc.location?.pathname || '') ? doc.querySelector('main, article') : null) || doc.body;
    if (!root) return result;
    function walk(node) {
      if (excluded(node)) return;
      if(regions.has(node)){result.push(node);return;}
      if (node.matches(hidden)) { result.push(node); return; }
      const children = [...node.children].filter(child => !excluded(child));
      if(ancestors.has(node)){children.forEach(walk);return;}
      // Collapsing a child must not promote its layout wrapper into a new
      // candidate and lose the already-hidden child on the next scan.
      if(node.querySelector(hidden)){children.forEach(walk);return;}
      const rect = measure(node);
      const floating = ['fixed','sticky'].includes(doc.defaultView?.getComputedStyle?.(node)?.position);
      if(floating && rect.width>=24 && rect.height>=24){result.push(node);return;}
      if (rect.width < 120 || rect.height < 20) {
        children.forEach(walk);
        return;
      }
      // A detail page can wrap several answers in one Card. Its list items
      // are separate decisions, while one answer's paragraphs stay together.
      const atomic = node.matches('.Card, .List-item, article, [role="article"], [role="listitem"]');
      if ((atomic && !node.querySelector('.List-item, [role="listitem"], article')) ||
          (node.matches(boundary) && !node.querySelector(boundary))) {
        result.push(node); return;
      }
      // Link cards and repeated compact components are indivisible samples.
      // This preserves thumbnail, title and actions without using site names.
      const repeated = node.classList.length && [...(node.parentElement?.children || [])]
        .filter(sibling => sibling.tagName === node.tagName && sibling.className === node.className).length > 1;
      if (!node.querySelector(boundary) && (node.matches('a[href]') ||
          (repeated && rect.height <= 500 && node.querySelector('a[href]')))) {
        result.push(node); return;
      }
      // Never classify a whole feed container instead of its individual cards.
      if (node.querySelector(boundary)) { children.forEach(walk); return; }
      const largeChildren = children.filter(child => {
        const size = measure(child);
        return size.width >= Math.min(rect.width * 0.65, 220) && size.height >= 35;
      });
      if (largeChildren.length > 1) {
        children.forEach(walk); return;
      }
      // Transparent layout wrappers may have only one substantial child.
      // Continue through them so a whole application is not one model input.
      const ownText = [...node.childNodes].some(child => child.nodeType === 3 && compact(child.textContent));
      if (!ownText && largeChildren.length === 1 &&
          largeChildren[0].matches('div,main,section,ul,ol,[role="main"],[role="feed"],[role="list"]')) {
        children.forEach(walk); return;
      }
      const data = describe(node);
      if (data.text || data.images.length || data.links.length ||
          node.matches('iframe,object,embed,video,canvas') || node.querySelector('iframe,object,embed,video,canvas')) result.push(node);
    }
    [...root.children].forEach(walk);
    // Site toolbars can live outside the main reading root or inside zero-size wrappers.
    const covered=new Set(result);
    function visitFloating(node) {
      // A known block owns its subtree. Do not enumerate thousands of answer
      // descendants only to test each against every block again.
      if(covered.has(node)||excluded(node))return;
      if(node.matches(hidden)||regions.has(node)){result.push(node);return;}
      const rect=measure(node);
      if(rect.width>=24&&rect.height>=24&&doc.defaultView?.getComputedStyle?.(node)?.position==='fixed'){result.push(node);return;}
      for(const child of node.children)visitFloating(child);
    }
    if(doc.body)for(const node of doc.body.children)visitFloating(node);
    return result;
  }
  globalThis.JevZhihu = {collect, describe, setHidden, registerUi, unregisterUi, isUi, containsUi, findUi};
})();
