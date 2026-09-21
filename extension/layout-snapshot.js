(() => {
  const ignored = 'script,style,noscript,template,svg,[contenteditable="true"],[data-jev-ui]';
  const stable = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
    !/^(?:jev[-_]|css-|jsx-|sc-|react[-_])|[a-f0-9]{8,}|\d{5,}/i.test(value) &&
    !/^(?:is-|has-)?(?:active|selected|focused|hover|loading|hidden)$/i.test(value);
  function describe(node) {
    const classes = [...(node.classList || [])].filter(stable).sort();
    const attributes = ['role', 'data-testid', 'data-test', 'data-component']
      .map(name => [name, node.getAttribute(name)]).filter(([, value]) => stable(value));
    return {feature: JSON.stringify([node.localName, classes, attributes]), anchored: classes.length > 0 || attributes.length > 0};
  }
  function key(node) {
    if (!node?.matches || node.closest(ignored)) return '';
    let anchored = false;
    const describeFeature = element => {
      const data = describe(element); anchored ||= data.anchored; return data.feature;
    };
    const ancestors = [];
    for (let parent = node.parentElement, depth = 0; parent && !parent.matches('body,html') && depth < 6; parent = parent.parentElement, depth++) {
      ancestors.push(describeFeature(parent));
    }
    const root = describeFeature(node), features = new Set();
    const queue = [...node.children].map(child => ({node: child, path: [], depth: 1}));
    let visited = 0;
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      if (item.node.matches(ignored)) continue;
      if (++visited > 600) return '';
      const path = [...item.path, describeFeature(item.node)];
      features.add(JSON.stringify(path));
      if (item.depth < 5) for (const child of item.node.children) queue.push({node: child, path, depth: item.depth + 1});
    }
    if (!anchored) return '';
    // Sets omit repeated-card counts; text, URLs, image sources and positions
    // never participate. Callers must reject keys with conflicting categories.
    const result = 'layout-v1:'+JSON.stringify([ancestors, root, [...features].sort()]);
    return result.length <= 16000 ? result : '';
  }
  function regionIdentity(node) {
    if (!node?.matches || node.matches('html,body') || node.closest(ignored)) return '';
    const data = describe(node), id = stable(node.id) ? node.id : '';
    if (!data.anchored && !id) return '';
    // Only this element's semantic identity participates. Hydration, content,
    // counters and surrounding wrappers may all change while it loads.
    return 'region-v1:' + JSON.stringify([data.feature, id]);
  }
  function region(node) {
    const identity = regionIdentity(node);
    if (!identity) return null;
    const rule = globalThis.JevManual?.describeRule(node,node.ownerDocument,{snapshotOnly:true});
    const selector = rule?.selector;
    // Positional paths and descendant/content anchors are not reliable during
    // loading. A bare tag can become ambiguous as more page content arrives.
    if (!selector || /:|\[\s*(?:href|aria-label)\b|(?:^|[\s>+~])(?:html|body)(?=[\s>+~.#\[]|$)/i.test(selector) ||
        /^[a-z][a-z0-9-]*$/i.test(selector)) return null;
    try {
      const found = node.ownerDocument.querySelectorAll(selector);
      if (found.length !== 1 || found[0] !== node) return null;
    } catch { return null; }
    return {selector, identity};
  }
  function matchRegion(node, identity) {
    return typeof identity === 'string' && identity.length > 0 && regionIdentity(node) === identity;
  }
  globalThis.JevLayoutSnapshot = {key, region, matchRegion, regionIdentity};
})();
