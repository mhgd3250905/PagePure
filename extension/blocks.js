(() => {
  const boundary = '.Card, .List-item, article, section, aside, header, footer, nav, [role="article"], [role="listitem"]';
  const ignored = 'script,style,noscript,template,svg,input,textarea,select,[contenteditable="true"],[data-jev-ui]';
  const hidden = '[data-jev-zhihu-hidden], [data-jev-manual-hidden]';
  const compact = text => (text || '').replace(/\s+/g, ' ').trim();
  function pathOnly(raw, base) {
    try { const url = new URL(raw, base); return /^https?:$/.test(url.protocol) ? (url.origin + url.pathname).slice(0, 400) : ''; }
    catch { return ''; }
  }
  function sectionContext(node) {
    for(let parent=node.parentElement,depth=0;parent && depth<5;parent=parent.parentElement,depth++) {
      if(parent.matches('body,main,[role="main"]'))break;
      const headings=[...parent.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
        .filter(h=>!node.contains(h) && !h.closest(ignored));
      if(headings.length===1) {
        const heading = headings[0].cloneNode(true);
        heading.querySelectorAll(ignored).forEach(item => item.remove());
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
      if (parent.closest(ignored)) continue;
      const role = parent.getAttribute('role') || '';
      const landmark = parent.matches('main,aside,nav,header,footer,[role="main"],[role="complementary"],[role="navigation"],[role="dialog"],[role="feed"],[role="list"]');
      if (landmark) regions.push(`${parent.tagName} role=${role}`);
      if (depth < 3) regions.push(`container ${parent.tagName} ${String(parent.className || '').slice(0,100)}`);
    }
    return regions.join(' > ').slice(0,500);
  }
  function describe(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll(ignored).forEach(item => item.remove());
    const elements = selector => [...(copy.matches(selector) ? [copy] : []), ...copy.querySelectorAll(selector)];
    return {
      text: compact(copy.textContent).slice(0, 5000),
      tag: node.tagName,
      role: compact(`${node.getAttribute('role') || ''} ${node.className || ''}`).slice(0, 80),
      structural: compact(`Section ${sectionContext(node)}; Regions ${regionContext(node)}; Parent ${node.parentElement?.tagName || ''} ${node.parentElement?.className || ''}; ${node.parentElement?.children.length > 1 ? 'multiple sibling blocks' : 'single child'}; headings ${copy.querySelectorAll('h1,h2,h3').length}; paragraphs ${copy.querySelectorAll('p').length}; text length ${compact(copy.textContent).length}; ancestor ${node.closest('main,aside,nav,footer,[role="main"],[role="feed"]')?.tagName || ''}`).slice(0,1500),
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
    const regions=new Set(knownRegions.filter(node=>node.isConnected&&!node.closest(ignored))), ancestors=new Set();
    for(const node of regions)for(let parent=node.parentElement;parent;parent=parent.parentElement)ancestors.add(parent);
    const root = doc.querySelector('.Topstory-container, .QuestionPage') ||
      (/^\/p\//.test(doc.location?.pathname || '') ? doc.querySelector('main, article') : null) || doc.body;
    if (!root) return result;
    function walk(node) {
      if (node.matches(ignored)) return;
      if(regions.has(node)){result.push(node);return;}
      if (node.matches(hidden)) { result.push(node); return; }
      const children = [...node.children].filter(child => !child.matches(ignored));
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
    for(const node of doc.querySelectorAll('body *')) {
      if(node.closest(ignored)||result.some(parent=>parent===node||parent.contains(node)))continue;
      // Already-hidden floating blocks have no measurable layout. Keep them
      // tracked without temporarily revealing them to rediscover their size.
      if(node.matches(hidden)||regions.has(node)){result.push(node);continue;}
      const rect=measure(node);if(rect.width<24||rect.height<24)continue;
      if(doc.defaultView?.getComputedStyle?.(node)?.position==='fixed')result.push(node);
    }
    return result;
  }
  globalThis.JevZhihu = {collect, describe};
})();
