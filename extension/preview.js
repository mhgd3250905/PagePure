(() => {
  const {scope, matches} = globalThis.JevManual;
  const {labels, create} = globalThis.JevCategories;
  let active = false, host, ui, layer, layerRoot, resizing, timer;
  let candidates = [], selected = new Set(), hidden = new Set(), chosen = new Set();
  let groups = [], config = {}, url = '', revision = 0, previewing = false, focusCategory = '';
  let syncing = false, applying = false, correctionNode = null, overrides = [], localRules = [], focusNode = null, focusTrail = [], showOriginal = false, previewNodes = new Set();
  let snapshot = new Map(), snapshotTimer, snapshotRevision='', lastSnapshot='';
  let signatureCache=null, layoutCache=null, descriptorCache=null, categoryCache=null, regionCache=null;
  const learnedRegions=new WeakMap();
  const describe=node=>{
    if(descriptorCache?.has(node))return descriptorCache.get(node);
    const value=globalThis.JevZhihu.describe(node);descriptorCache?.set(node,value);return value;
  };
  const signature=node=>{
    if(signatureCache?.has(node))return signatureCache.get(node);
    const {id,...data}=describe(node), value=JSON.stringify(data);
    signatureCache?.set(node,value);return value;
  };
  const layoutKey=node=>{
    if(snapshot.has('layout-v1:disabled'))return '';
    if(layoutCache?.has(node))return layoutCache.get(node);
    const value=globalThis.JevLayoutSnapshot?.key(node) || '';
    layoutCache?.set(node,value);return value;
  };
  function cachedCategory(node) {
    const restored=regionCache?.get(node);
    if(restored&&restored!=='other')return restored;
    const exact=snapshot.get(signature(node));
    if(exact)return exact;
    const key=layoutKey(node), category=key&&snapshot.get(key);
    return category && category!=='other' ? category : undefined;
  }
  function remember(nodes) {
    for(const node of nodes) {
      const fresh=engine.get(node);
      if(!fresh&&regionCache?.has(node))continue;
      const category=fresh || snapshot.get(signature(node)) || (()=>{const key=layoutKey(node),value=key&&snapshot.get(key);return value!=='other'?value:undefined;})();
      if(!category)continue;
      snapshot.set(signature(node),category);
      let region=learnedRegions.get(node);
      if(!region||!globalThis.JevLayoutSnapshot?.matchRegion(node,region.identity)) {
        region=globalThis.JevLayoutSnapshot?.region(node);
        if(region)learnedRegions.set(node,region);
      }
      if(region&&!snapshot.has('layout-v1:disabled')) {
        const key='region-v1:'+JSON.stringify(region), previous=snapshot.get(key);
        snapshot.set(key,previous&&previous!==category?'other':category);
      }
      const key=layoutKey(node);
      if(key) {
        const previous=snapshot.get(key);
        snapshot.set(key,previous && previous!==category ? 'other' : category);
      }
    }
    while(snapshot.size>200) {
      const discard=[...snapshot].find(([key])=>!key.startsWith('layout-v1:')&&!key.startsWith('region-v1:')) ||
        [...snapshot].find(([key,value])=>key!=='layout-v1:disabled'&&value!=='other');
      if(discard)snapshot.delete(discard[0]);
      else {snapshot.clear();snapshot.set('layout-v1:disabled','other');}
    }
  }
  function restoreRegions() {
    const restored=new Map();
    if(snapshot.has('layout-v1:disabled'))return restored;
    for(const [key,category] of snapshot)if(key.startsWith('region-v1:')&&category!=='other') {
      try {
        const {selector,identity}=JSON.parse(key.slice(10)), found=document.querySelectorAll(selector);
        if(found.length===1&&globalThis.JevLayoutSnapshot?.matchRegion(found[0],identity))restored.set(found[0],category);
      }catch { /* Old or unmatched anchors are classified normally. */ }
    }
    return restored;
  }
  const page = () => document.location.href;
  const keys = () => ['site','type','page'].map(mode => scope(page(),mode));
  async function request(type,payload) {
    const response = await chrome.runtime.sendMessage({type,payload});
    if (!response?.ok) throw new Error(response?.error || '无法连接助手，请刷新页面');
    return response.data;
  }
  const engine = create(request, describe);
  const canClassify = () => config.enabled && config.aiEnabled && config.configured;
  const persistedCategories = () => new Set(groups.flatMap(g => g.rules).filter(r=>r.action!=='keep').map(r=>r.category).filter(Boolean));
  const rulesForScope = () => groups.find(g=>g.key===scope(page(),ui?.querySelector('#scope').value || 'site'))?.rules || [];
  const overlaps=(a,b)=>a===b||a.contains(b)||b.contains(a);
  let previewTargets=new Set();
  function draftRules() {
    const rules=[...chosen].map(category=>{const selectors=overrides.filter(r=>r.category===category).map(r=>r.selector);return {category,label:labels[category],...(selectors.length?{overrides:selectors}:{})};});
    return [...rules,...rulesForScope().filter(r=>r.category&&r.action==='keep'&&!chosen.has(r.category)),...localRules];
  }
  function applicableRules(draft=false) {
    const current=scope(page(),'page'), editing=scope(page(),ui?.querySelector('#scope').value || 'site');
    const source=draft?[...groups.filter(g=>g.key!==editing),{key:editing,rules:draftRules()}]:groups;
    return source.flatMap(g=>g.rules.filter(r=>!r.page||r.page===current).map(r=>({...r,pageOnly:!!r.page||g.key===current})));
  }
  function visibility(rules,nodes) {
    const select=(pageOnly,keep)=>{
      const subset=rules.filter(r=>r.pageOnly===pageOnly&&(r.action==='keep')===keep);
      const found=matches(document,subset), categories=new Set(subset.map(r=>r.category).filter(Boolean));
      if(categories.size)for(const node of nodes)if(categories.has(categoryOf(node)))found.add(node);
      return found;
    };
    const hidden=select(false,false), kept=select(false,true), pageHidden=select(true,false), pageKept=select(true,true);
    const explicitFor=pageOnly=>matches(document,rules.filter(r=>r.pageOnly===pageOnly&&r.action!=='keep').flatMap(r=>r.selector?[r]:(r.overrides||[]).map(selector=>({selector}))));
    const explicitHidden=explicitFor(false),explicitPageHidden=explicitFor(true);
    const protectedBy=(node,keep,explicit)=>keep===node||node.contains(keep)||(keep.contains(node)&&!explicit.has(node));
    for(const node of hidden)if([...kept].some(k=>protectedBy(node,k,explicitHidden)))hidden.delete(node);
    for(const node of pageHidden)hidden.add(node);
    for(const node of hidden)if([...pageKept].some(k=>protectedBy(node,k,explicitPageHidden)))hidden.delete(node);
    for(const node of pageKept)kept.add(node);
    return {hidden,kept};
  }
  const savedOverrides = () => groups.flatMap(g=>g.rules).flatMap(r=>(r.overrides||[]).map(selector=>({selector,category:r.category})));
  function categoryOf(node) {
    if(categoryCache?.has(node))return categoryCache.get(node);
    const rules=active?overrides:savedOverrides();
    let category;
    for(const rule of [...rules].reverse()) {try {if(node.matches(rule.selector)){category=rule.category;break;}}catch{}}
    category ||= engine.get(node) || cachedCategory(node);
    categoryCache?.set(node,category);return category;
  }
  function loadOverrides() { localRules=rulesForScope().filter(r=>r.selector); overrides=rulesForScope().flatMap(r=>(r.overrides||[]).map(selector=>({selector,category:r.category}))); }
  const awaitingDecision=new Set();
  function restore() {hidden.forEach(n=>n.removeAttribute('data-jev-manual-hidden'));hidden.clear();awaitingDecision.forEach(n=>n.removeAttribute('data-jev-awaiting'));awaitingDecision.clear();}
  function classify(nodes) {if(canClassify()) void engine.scan(nodes, onClassification);}
  function onClassification() {
    if (active) { selectKnown(); position(); renderStatus(); if(focusNode?.isConnected)focus(focusNode,false); }
    else {apply();scheduleSnapshot();}
    globalThis.JevPage?.report?.();
  }
  function scheduleSnapshot() {
    if(snapshotTimer||active||!groups.length)return;
    const expectedUrl=page(),expectedRevision=snapshotRevision;
    snapshotTimer=setTimeout(()=>{
      snapshotTimer=null;
      if(active||page()!==expectedUrl||snapshotRevision!==expectedRevision)return;
      void persistSnapshot().catch(()=>{lastSnapshot='';});
    },500);
  }
  async function persistSnapshot() {
    const entries=[...snapshot].slice(-200).map(([signature,category])=>({signature,category}));
    const serialized=JSON.stringify(entries), expectedRevision=snapshotRevision,expectedUrl=page();
    if(serialized===lastSnapshot)return;
    await request('snapshotSet',{key:scope(expectedUrl,'page'),revision:expectedRevision,entries});
    if(snapshotRevision===expectedRevision&&page()===expectedUrl)lastSnapshot=serialized;
  }
  function apply() {
    if (applying) return;
    applying = true;
    signatureCache=new WeakMap();layoutCache=new WeakMap();descriptorCache=new WeakMap();categoryCache=new WeakMap();regionCache=restoreRegions();
    try {
      if(active || showOriginal || !config.enabled) {restore();globalThis.JevPage?.report?.();return;}
      const rules = applicableRules();
      const categories = persistedCategories();
      const explicit=matches(document,rules);
      const pending=new Set();
      const nodes = collectRegions();
      if(categories.size) {
        remember(nodes);
        categoryCache=new WeakMap();
        classify(nodes.filter(node=>!explicit.has(node)&&!categoryOf(node)));
        categoryCache=new WeakMap();
        for(const node of nodes)if(!explicit.has(node)&&!categoryOf(node)&&canClassify()&&!engine.error)pending.add(node);
        for(const node of autoPending)pending.add(node);
      }
      const decision=visibility(rules,nodes),keep=decision.kept,nextHidden=decision.hidden,nextAwaiting=new Set();
      for(const node of pending)if(!nextHidden.has(node)&&![...keep].some(k=>overlaps(k,node))) {
        // Content may change while scrolling. Keep a previously hidden region
        // collapsed until its new decision is available, rather than flashing it.
        if(hidden.has(node))nextHidden.add(node);else nextAwaiting.add(node);
      }
      // Add protection before releasing old protection. Unchanged nodes never
      // leave the hidden state, so layout/sticky observers see no reveal cycle.
      for(const node of nextHidden)if(!node.hasAttribute('data-jev-manual-hidden'))node.setAttribute('data-jev-manual-hidden','');
      for(const node of nextAwaiting)if(!node.hasAttribute('data-jev-awaiting'))node.setAttribute('data-jev-awaiting','');
      for(const node of hidden)if(!nextHidden.has(node))node.removeAttribute('data-jev-manual-hidden');
      for(const node of awaitingDecision)if(!nextAwaiting.has(node))node.removeAttribute('data-jev-awaiting');
      hidden=nextHidden;awaitingDecision.clear();nextAwaiting.forEach(node=>awaitingDecision.add(node));
      scheduleSnapshot();
      globalThis.JevPage?.report?.();
    } finally {applying=false;signatureCache=null;layoutCache=null;descriptorCache=null;categoryCache=null;regionCache=null;}
  }
  async function refresh() {
    const version=++revision, nextUrl=page();
    if(url!==nextUrl){engine.reset();partitions.clear();autoAttempted=new WeakSet();autoPending.clear();autoBudget=3;showOriginal=false;snapshot=new Map();lastSnapshot='';}
    url=nextUrl;
    try {
      const [data,nextConfig]=await Promise.all([request('rulesGet',{keys:keys()}),request('configGet')]);
      if(version!==revision || url!==page())return;
      groups=data.groups;config=nextConfig;
      const nextRevision=JSON.stringify(groups.map(g=>[g.key,g.rules]));
      if(snapshotRevision!==nextRevision || !snapshot.size) {
        snapshotRevision=nextRevision;snapshot=new Map();lastSnapshot='';
        try {const [current,legacy]=await Promise.all([
          request('snapshotGet',{key:scope(page(),'page'),revision:nextRevision}),
          request('snapshotGet',{key:scope(page(),'type'),revision:nextRevision})
        ]);
          if(version!==revision||page()!==nextUrl)return;
          snapshot=new Map([...(legacy.entries||[]).filter(e=>!e.signature.startsWith('region-v1:')),...(current.entries||[])].map(e=>[e.signature,e.category]));
        }catch { /* Snapshot availability must not block live classification. */ }
      }
      if(groups.length)globalThis.JevPage?.suspend();
      if(!canClassify())engine.reset();
      if(active)syncCandidates();else apply();
      if(config.enabled&&groups.some(g=>g.rules.length))globalThis.JevStartup?.prepare(apply);
      else globalThis.JevStartup?.release();
      return true;
    } catch(error){globalThis.JevStartup?.release();if(ui)ui.querySelector('#status').textContent=error.message;}
  }
  function clearMarks() {
    previewNodes.forEach(n=>n.removeAttribute('data-jev-preview-hide'));previewNodes.clear();
    for(const node of candidates)for(const attr of ['data-jev-candidate','data-jev-selected','data-jev-preview-hide'])node.removeAttribute(attr);
  }
  function selectKnown() {
    previewNodes.forEach(n=>n.removeAttribute('data-jev-preview-hide'));previewNodes.clear();
    selected=new Set();
    const targeted=visibility(applicableRules(true),candidates).hidden;
    previewTargets=targeted;
    for(const node of candidates) {
      const picked=[...targeted].some(n=>n===node||n.contains(node));
      node.toggleAttribute('data-jev-selected',picked);
      node.toggleAttribute('data-jev-preview-hide',picked&&previewing);
      if(picked){selected.add(node);if(previewing)previewNodes.add(node);}
    }
    if(previewing)for(const node of targeted){node.setAttribute('data-jev-preview-hide','');previewNodes.add(node);}
  }
  function renderStatus() {
    if(!ui)return;
    const counts=new Map();let unknown=0;
    for(const node of candidates){const category=categoryOf(node);if(!category||category==='other')unknown++;else counts.set(category,(counts.get(category)||0)+1);}
    ui.querySelector('#status').textContent=engine.error || (!canClassify()?'可以直接选择区域；在设置中开启智能识别后，也能选择同类内容。':
      `${focusCategory ? labels[focusCategory]+'：' : ''}已选择 ${chosen.size} 类 / ${selected.size} 块${engine.pending ? ' · 正在识别 '+engine.pending+' 块' : ''}${unknown ? ' · '+unknown+' 块待确定' : ''}`);
    const list=ui.querySelector('#categories');list.replaceChildren();
    for(const category of new Set([...counts.keys(),...chosen])) {
      const button=document.createElement('button');button.type='button';button.textContent=`${chosen.has(category)?'☑':'☐'} ${labels[category]}（${counts.get(category)||0}）`;
      button.setAttribute('aria-pressed',String(chosen.has(category)));
      button.addEventListener('click',()=>toggleCategory(category));list.append(button);
    }
    ui.querySelector('#legacy').textContent=localRules.length?`另有 ${localRules.length} 条区域规则（含保留例外）`:'';
    const rulesList=ui.querySelector('#rule-list');rulesList.replaceChildren();
    localRules.forEach((rule,index)=>{if(rule.page&&rule.page!==scope(page(),'page'))return;const b=document.createElement('button');b.type='button';b.textContent=`${rule.page?'仅当前页面':''}${rule.action==='keep'?'恢复':'隐藏'}：${rule.label} ×`;b.addEventListener('click',()=>{localRules.splice(index,1);selectKnown();position();renderStatus();});rulesList.append(b);});
  }
  function toggleCategory(category) {
    if(!category||category==='other'||previewing)return;
    if(chosen.has(category))chosen.delete(category);else chosen.add(category);
    focusCategory=category;selectKnown();position();renderStatus();
  }
  function moduleName(node) {
    const copy=node.cloneNode(true);copy.querySelectorAll('script,style,noscript,template,input,textarea,select,[contenteditable]').forEach(n=>n.remove());
    const data=globalThis.JevZhihu.describe(copy);
    return (data.text || data.images?.find(img=>img.alt)?.alt || (node.querySelector('iframe')?'嵌入内容区域':'图片或内容区域')).slice(0,60);
  }
  let quickAnchor=null, splitting=false, learnedSplit=false;
  const partitions=new Map();
  let autoAttempted=new WeakSet(),autoBudget=3;
  const autoPending=new Set();
  function splitCandidates(parent) {
    const visible=n=>{const r=n.getBoundingClientRect();return r.width>=24&&r.height>=20&&!n.matches('script,style,noscript,template,input,textarea,select,svg,[contenteditable],[data-jev-ui]')&&!n.closest('[contenteditable],[data-jev-ui]');};
    let parts=[...parent.children].filter(visible);
    for(let depth=0;parts.length===1&&depth<5;depth++)parts=[...parts[0].children].filter(visible);
    return parts.length>=2&&parts.length<=20?parts:[];
  }
  function learnRegions(nodes,restored,known=[]) {
    if(active||!groups.length||!canClassify()||!config.splitExperienceAvailable)return;
    for(const parent of nodes) {
      if(autoBudget<=0)break;
      if(known.some(root=>root===parent||root.contains(parent))||categoryOf(parent)||autoAttempted.has(parent)||[...restored.values()].some(parts=>parts.includes(parent)))continue;
      autoAttempted.add(parent);
      const parts=splitCandidates(parent);if(!parts.length)continue;
      autoBudget--;autoPending.add(parent);
      const expectedUrl=page(),version=revision,fingerprints=parts.map(signature);
      void request('splitBlock',{auto:true,parent:{...globalThis.JevZhihu.describe(parent),id:'parent'},blocks:parts.map((n,i)=>({...globalThis.JevZhihu.describe(n),id:'part-'+i}))}).then(result=>{
        if(version!==revision||page()!==expectedUrl||active||!parent.isConnected||parts.some((n,i)=>!parent.contains(n)||signature(n)!==fingerprints[i]))return;
        if(parts.filter((n,i)=>result.ids?.includes('part-'+i)).length>=2)partitions.set(parent,parts);
      }).catch(()=>{}).finally(()=>{autoPending.delete(parent);if(version===revision){if(active)syncCandidates();else apply();}});
    }
  }
  function savedPartitions() {
    const result=new Map();
    for(const group of groups)for(const spec of group.partitions||[]) {
      if(spec.pageType&&spec.pageType!==scope(page(),'type'))continue;
      const parents=[...matches(document,[{selector:spec.parent}])];
      if(parents.length!==1)continue;
      const parent=parents[0],parts=spec.parts.map(selector=>[...matches(document,[{selector}])]);
      if(parts.some(found=>found.length!==1||found[0]===parent||!parent.contains(found[0])))continue;
      const nodes=parts.map(found=>found[0]);
      if(nodes.some((n,i)=>nodes.some((other,j)=>i!==j&&(n===other||n.contains(other)))))continue;
      result.set(parent,nodes);
    }
    return result;
  }
  function serializePartitions(key) {
    const specs=new Map((groups.find(g=>g.key===key)?.partitions||[]).map(p=>[(p.pageType||'')+'|'+p.parent,p]));
    for(const [parent,parts] of partitions) {
      if(!parent.isConnected)continue;
      const rules=[parent,...parts].map(n=>globalThis.JevManual.describeRule(n));
      if(rules.some(r=>!r||r.selector.length>1500) || /^html(?: |>)/.test(rules[0].selector))
        throw new Error('这次拆分的边界还无法稳定保存，请调整范围后再保存；原有规则未更改。');
      const pageType=key.endsWith('|site')?scope(page(),'type'):undefined;
      specs.set((pageType||'')+'|'+rules[0].selector,{parent:rules[0].selector,parts:rules.slice(1).map(r=>r.selector),...(pageType?{pageType}:{})});
    }
    return [...specs.values()].slice(-40);
  }
  function collectRegions(){
    const restored=new Map([...savedPartitions(),...partitions]);
    const corrections=matches(document,applicableRules().flatMap(rule=>(rule.overrides||[]).map(selector=>({selector}))));
    // A confirmed region remains one decision during normal browsing. Only
    // explicit saved splits reopen its children for independent decisions.
    const known=active?[]:[...new Set([
      ...[...(regionCache?.keys()||[])],
      ...matches(document,applicableRules().filter(rule=>rule.selector))
    ])].filter(node=>![...restored.keys()].some(parent=>node===parent||node.contains(parent)));
    let nodes=globalThis.JevZhihu.collect(document,undefined,active?[]:[...known,...corrections]);
    for(const [parent,parts] of restored){if(!parent.isConnected){partitions.delete(parent);continue;}
      if(parts.some(n=>!n.isConnected||!parent.contains(n)))continue;
      nodes=nodes.filter(n=>n!==parent&&!parent.contains(n)&&!n.contains(parent));nodes.push(...parts);
    }
    if(!active) {
      const roots=known.filter(node=>!known.some(other=>other!==node&&other.contains(node)));
      nodes=[...new Set([...nodes,...roots,...corrections])].filter(node=>corrections.has(node)||!roots.some(root=>root!==node&&root.contains(node)));
    }
    learnRegions(nodes,restored,known);
    return [...new Set(nodes)].filter(n=>active||!autoPending.has(n));
  }
  async function splitFocus(){
    if(splitting||!focusNode?.isConnected)return;
    if(!canClassify()){ui.querySelector('#status').textContent='智能拆分需要开启此网站的 Jev 判断并配置密钥';return;}
    const parent=focusNode,expectedUrl=page(),expectedHost=host;
    const parts=splitCandidates(parent);
    if(parts.length<2||parts.length>20){ui.querySelector('#status').textContent='未找到合适的内部区域，请调整范围再拆分（最多 20 个候选）';return;}
    const fingerprints=parts.map(signature);
    splitting=true;ui.querySelector('#q-split').disabled=true;ui.querySelector('#q-split').textContent='拆分中…';
    try{
      const result=await request('splitBlock',{resetLearning:!learnedSplit,parent:{...globalThis.JevZhihu.describe(parent),id:'parent'},blocks:parts.map((n,i)=>({...globalThis.JevZhihu.describe(n),id:'part-'+i}))});
      if(!active||host!==expectedHost||page()!==expectedUrl||!parent.isConnected)return;
      if(parts.some((n,i)=>!n.isConnected||signature(n)!==fingerprints[i]))throw new Error('区域内容已变化，请重新拆分');
      const accepted=parts.filter((n,i)=>result.ids?.includes('part-'+i));
      if(accepted.length<2)throw new Error('未找到至少两个独立模块，保留原区域');
      partitions.set(parent,parts);learnedSplit=true;syncCandidates();focus(accepted[0]);
      ui.querySelector('#status').textContent=`已细分 ${parts.length} 个区域，其中 ${accepted.length} 个经 Jev 确认；请点选需要隐藏的区域。`;
    }catch(error){if(ui)ui.querySelector('#status').textContent=error.message;}
    finally{splitting=false;if(ui){ui.querySelector('#q-split').disabled=false;ui.querySelector('#q-split').textContent='智能拆分';}}
  }
  function positionQuick() {
    const quick=ui?.querySelector('#quick');if(!quick)return;
    quick.hidden=!focusNode?.isConnected;
    if(quick.hidden)return;
    const r=focusNode.getBoundingClientRect(),w=Math.min(410,innerWidth-16);
    const x=quickAnchor?.x ?? r.left, y=quickAnchor?.y ?? r.top;
    quick.style.left=Math.max(8,Math.min(x+12,innerWidth-w-8))+'px';
    quick.style.top=Math.max(8,Math.min(y+12,innerHeight-94))+'px';
    quick.style.width=w+'px';
    ui.querySelector('#quick-name').textContent=moduleName(focusNode);
    ui.querySelector('#q-smaller').disabled=!focusTrail.length;
    ui.querySelector('#q-save').disabled=ui.querySelector('#save').disabled;
  }
  function focus(node, reset=true) {
    if(previewing||!node?.isConnected)return;
    focusNode?.removeAttribute('data-jev-focus');focusNode=node;
    if(reset)focusTrail=[];
    node.setAttribute('data-jev-focus','');
    ui.querySelector('#selection').hidden=false;
    ui.querySelector('#selection-name').textContent=`已选：${labels[categoryOf(node)]||'尚未识别'} · ${moduleName(node)}`;
    ui.querySelector('#same').disabled=!categoryOf(node)||categoryOf(node)==='other';
    ui.querySelector('#smaller').disabled=!focusTrail.length;positionQuick();
  }
  function toggle(node,event) {quickAnchor=event&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)?{x:event.clientX,y:event.clientY}:null;focus(node);}
  function areaRule(action,pageOnly=false) {
    const rule=globalThis.JevManual.describeRule(focusNode);
    if(!rule || rule.selector.length>1500 || /:nth-|^html(?: |>)/.test(rule.selector)) {
      const category=categoryOf(focusNode);
      if(!pageOnly&&action==='hide'&&category&&category!=='other') {
        chosen.add(category);selectKnown();position();renderStatus();
        const message=`已选中同类「${labels[category]}」；此区域没有独立定位，将按类别保存。`;
        ui.querySelector('#status').textContent=message;ui.querySelector('#quick-name').textContent=message;
      } else {
        const message='暂时无法稳定保存这个区域，请扩大范围或先纠正类别。';
        ui.querySelector('#status').textContent=message;ui.querySelector('#quick-name').textContent=message;
      }
      return;
    }
    const current=scope(page(),'page');
    localRules=localRules.filter(r=>r.selector!==rule.selector||(pageOnly?r.page!==current:!!r.page&&r.page!==current));
    localRules.push({...rule,label:moduleName(focusNode),action,...(pageOnly?{page:current}:{})});
    selectKnown();position();renderStatus();
    if(pageOnly)ui.querySelector('#status').textContent=`已设为仅当前页面${action==='keep'?'恢复':'隐藏'}，点击保存后生效；其他页面不变。`;
  }
  function coverageRect(node) {
    const base=node.getBoundingClientRect();
    let left=base.left,top=base.top,right=base.right,bottom=base.bottom;
    for(const child of node.querySelectorAll('*')) {
      if(!['fixed','sticky'].includes(globalThis.getComputedStyle?.(child)?.position))continue;
      const r=child.getBoundingClientRect();if(r.width<1||r.height<1)continue;
      left=Math.min(left,r.left);top=Math.min(top,r.top);right=Math.max(right,r.right);bottom=Math.max(bottom,r.bottom);
    }
    return {left,top,width:right-left,height:bottom-top};
  }
  let positionFrame;
  function afterLayout() {
    position();
    if(globalThis.requestAnimationFrame){globalThis.cancelAnimationFrame?.(positionFrame);positionFrame=requestAnimationFrame(position);}
  }
  function position() {
    if(!layerRoot)return;
    [...layerRoot.querySelectorAll('button')].forEach((button,index)=>{
      const node=candidates[index],r=coverageRect(node),category=categoryOf(node);
      button.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;display:${previewing||r.width<1||r.height<1?'none':'block'};border:2px ${selected.has(node)?'solid #64748b':'dashed #3886f5'};background:${selected.has(node)?'transparent':'transparent'};padding:0;margin:0;pointer-events:auto;cursor:crosshair;box-sizing:border-box;`;
      button.setAttribute('aria-pressed',String(selected.has(node)));
      button.setAttribute('aria-label',`${labels[category]||'待识别'} · 区域 ${index+1}`);
      button.title='点击选择这个区域，再决定隐藏范围';
    });
    layerRoot.querySelectorAll('[data-mask]').forEach(n=>n.remove());
    const targets=new Set([...selected,...previewTargets]);
    if(!previewing)for(const node of targets) {
      if([...targets].some(p=>p!==node&&p.contains(node)))continue;
      const r=coverageRect(node);if(r.width<1||r.height<1)continue;
      const mask=document.createElement('div');mask.setAttribute('data-mask','');
      mask.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:linear-gradient(135deg,rgba(241,245,249,.28),rgba(226,232,240,.40));backdrop-filter:blur(5px) saturate(.55);-webkit-backdrop-filter:blur(5px) saturate(.55);pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden;box-sizing:border-box;border:1px solid rgba(255,255,255,.65);border-radius:8px;box-shadow:inset 0 0 28px rgba(255,255,255,.35);`;
      const stamp=document.createElement('span');stamp.setAttribute('data-purify-seal','');
      const visibleLeft=Math.max(0,r.left),visibleTop=Math.max(0,r.top);
      const visibleWidth=Math.min(innerWidth,r.left+r.width)-visibleLeft,visibleHeight=Math.min(innerHeight,r.top+r.height)-visibleTop;
      const compact=visibleHeight<100||visibleWidth<140;
      stamp.style.cssText=`position:absolute;left:${visibleLeft-r.left+visibleWidth/2}px;top:${visibleTop-r.top+visibleHeight/2}px;display:flex;align-items:center;justify-content:center;flex-direction:column;width:${compact?72:94}px;height:${compact?32:94}px;flex-shrink:0;box-sizing:border-box;border:1px solid rgba(30,88,83,.48);border-radius:${compact?'9px':'50%'};color:#235d57;transform:translate(-50%,-50%) rotate(-8deg);background:linear-gradient(145deg,rgba(255,255,255,.82),rgba(232,243,238,.55));box-shadow:0 6px 22px rgba(30,65,60,.12),inset 0 0 0 4px rgba(255,255,255,.5);`;
      const ring=document.createElement('i');ring.style.cssText=`position:absolute;inset:5px;border:1px dashed rgba(35,93,87,.4);border-radius:${compact?'5px':'50%'};`;stamp.append(ring);
      if(!compact){const mark=document.createElement('i');mark.style.cssText='width:14px;height:7px;border-left:2px solid #38766a;border-bottom:2px solid #38766a;transform:rotate(-45deg);margin:0 0 12px;';stamp.append(mark);}
      const word=document.createElement('span');word.textContent='净化';word.style.cssText=`font:600 ${compact?16:23}px "Microsoft YaHei",system-ui;letter-spacing:${compact?4:6}px;padding-left:${compact?4:6}px;line-height:1.2;`;stamp.append(word);
      if(!compact){const line=document.createElement('i');line.style.cssText='width:22px;height:1px;background:rgba(35,93,87,.45);margin-top:10px;';stamp.append(line);}
      mask.append(stamp);layerRoot.append(mask);
    }
    positionQuick();
  }
  function syncCandidates() {
    if(!active||previewing||syncing)return;
    syncing=true;
    try {
      clearMarks();candidates=collectRegions();
      candidates.forEach(n=>n.setAttribute('data-jev-candidate',''));
      classify(candidates);selectKnown();
      if(layerRoot) {
        layerRoot.replaceChildren();resizing?.disconnect();
        candidates.forEach(node=>{const button=document.createElement('button');button.type='button';button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggle(node,event);});button.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();correctionNode=node;ui.querySelector('#correction').hidden=false;ui.querySelector('#manual-category').value=categoryOf(node)==='other'?'promotion':(categoryOf(node)||'promotion');ui.querySelector('#status').textContent='手动纠正这个模块的类别，确认后检查高亮范围。';});layerRoot.append(button);resizing?.observe(node);});
        position();
      }
      renderStatus();
    }finally{syncing=false;}
  }
  function leave() {
    globalThis.cancelAnimationFrame?.(positionFrame);clearMarks();partitions.clear();learnedSplit=false;focusNode?.removeAttribute('data-jev-focus');focusNode=null;quickAnchor=null;correctionNode=null;active=false;previewing=false;focusCategory='';
    layer?.remove();layer=null;layerRoot=null;resizing?.disconnect();resizing=null;
    globalThis.removeEventListener?.('scroll',afterLayout,true);globalThis.removeEventListener?.('resize',afterLayout);
    host?.remove();host=null;ui=null;
    document.removeEventListener('click',click,true);document.removeEventListener('keydown',keydown,true);
    apply();void globalThis.JevPage?.resume();
  }
  function own(event){return event.composedPath().some(n=>n?.hasAttribute?.('data-jev-ui'));}
  function click(event){if(own(event))return;event.preventDefault();event.stopImmediatePropagation();const node=candidates.find(n=>n===event.target||n.contains(event.target));if(node)toggle(node,event);}
  function keydown(event){if(event.key==='Escape'){event.preventDefault();leave();}}
  async function start() {
    if(active||!document.body)return;
    await refresh();active=true;showOriginal=false;engine.reset();globalThis.JevPage?.suspend();restore();
    chosen=new Set(rulesForScope().filter(r=>r.action!=='keep').map(r=>r.category).filter(Boolean));loadOverrides();
    host=document.createElement('div');host.setAttribute('data-jev-ui','preview');host.style.cssText='position:fixed!important;top:16px!important;right:16px!important;z-index:2147483647!important;';
    ui=host.attachShadow({mode:'open'});
    ui.innerHTML=`<style>:host{font:14px system-ui;color:#172b3a}*{box-sizing:border-box}.box{width:min(380px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:18px;background:white;border:1px solid #d6e3f5;border-radius:14px;box-shadow:0 8px 35px #132c4a33}h2{font-size:16px;margin:0 0 8px}p{font-size:12px;line-height:1.7}select,button{font:inherit;padding:8px;border:1px solid #cad6e5;border-radius:7px;background:white}select{width:100%;margin-bottom:10px}.actions,#categories{display:flex;flex-wrap:wrap;gap:8px}#categories{margin-bottom:12px}#categories button{font-size:12px}button[aria-pressed=true]{background:#fff0f0;border-color:#ef4444}button{cursor:pointer}#save{background:#1768ed;color:white;border:0}button:disabled{opacity:.5}#status,#legacy{overflow-wrap:anywhere}#legacy{color:#9a6420}#quick{position:fixed;z-index:2147483647;background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:10px;box-shadow:0 8px 28px #0f172a30}#quick-name{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px}#quick .actions{gap:5px}#quick button{font-size:12px;padding:7px}#q-hide{background:#475569;color:white}#q-save{background:#1768ed;color:white}</style><div id="quick" role="toolbar" aria-label="区域快捷操作" hidden><div id="quick-name"></div><div class="actions"><button id="q-larger">扩大</button><button id="q-smaller">缩小</button><button id="q-split">智能拆分</button><button id="q-hide">选定隐藏</button><button id="q-save">保存</button><details><summary>更多</summary><div class="actions"><button id="q-keep">恢复这个区域</button><button id="q-page-hide">仅当前页面隐藏</button><button id="q-page-keep">仅当前页面恢复</button></div></details></div></div>
    <section class="box" aria-label="按类别净化网页"><h2>点选你不想看的内容</h2><p>点击网页上的蓝框，选择隐藏这个区域或同类内容。先预览，满意再保存；随时可以恢复。</p><div id="selection" hidden><p id="selection-name"></p><div class="actions"><button id="hide-area">隐藏这个区域</button><button id="same">隐藏同类内容</button><button id="keep-area">恢复这个区域</button></div><details><summary>仅当前页面</summary><p>只影响当前网址，优先于普通规则；其他问题页不受影响。保存后生效。</p><div class="actions"><button id="page-hide">仅当前页面隐藏</button><button id="page-keep">仅当前页面恢复</button></div></details><details><summary>调整范围或纠正识别</summary><div class="actions"><button id="larger">扩大范围</button><button id="smaller">缩小范围</button><button id="correct">纠正类别</button></div></details></div><p id="status" role="status"></p><details><summary>更多选项与规则</summary><label>应用到<select id="scope"><option value="site">整个网站（共享规则）</option><option value="type">仅此类页面</option><option value="page">仅当前网址</option></select></label><div id="categories"></div><p id="legacy"></p><div id="rule-list" class="actions"></div></details><div id="correction" hidden><label>手动指定类别<select id="manual-category">${Object.entries(labels).filter(([key])=>key!=='other').map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><p>按模块结构记住纠正结果；确认后请检查同类高亮范围，再保存。</p><button id="assign">指定并选中整类</button><button id="dismiss-correction">关闭</button></div><div class="actions"><button id="effect">预览效果</button><button id="save">保存并应用</button><button id="retry">重试识别</button><button id="cancel">取消</button></div></section>`;
    // Keep the original region toolbar; fold the former standalone panel into More.
    const extra=ui.querySelector('.box');
    extra.classList.remove('box');
    extra.querySelector('h2').remove();
    extra.querySelector('p').remove();
    ui.querySelector('#quick details').append(extra);
    ui.querySelector('#scope option[value=site]').selected=true;
    document.body.append(host);
    layer=document.createElement('div');layer.setAttribute('data-jev-ui','selection-layer');layer.style.cssText='position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;';
    layerRoot=layer.attachShadow({mode:'open'});document.body.append(layer);
    if(globalThis.ResizeObserver)resizing=new ResizeObserver(position);
    globalThis.addEventListener?.('scroll',afterLayout,true);globalThis.addEventListener?.('resize',afterLayout);
    ui.querySelector('#cancel').addEventListener('click',leave);
    ui.querySelector('#q-split').addEventListener('click',splitFocus);
    for(const [quick,target] of [['q-larger','larger'],['q-smaller','smaller'],['q-hide','hide-area'],['q-save','save'],['q-keep','keep-area'],['q-page-hide','page-hide'],['q-page-keep','page-keep']])ui.querySelector('#'+quick).addEventListener('click',()=>ui.querySelector('#'+target).click());
    ui.querySelector('#hide-area').addEventListener('click',()=>areaRule('hide'));
    ui.querySelector('#keep-area').addEventListener('click',()=>areaRule('keep'));
    ui.querySelector('#page-hide').addEventListener('click',()=>areaRule('hide',true));
    ui.querySelector('#page-keep').addEventListener('click',()=>areaRule('keep',true));
    ui.querySelector('#same').addEventListener('click',()=>toggleCategory(categoryOf(focusNode)));
    ui.querySelector('#correct').addEventListener('click',()=>{correctionNode=focusNode;ui.querySelector('#correction').hidden=false;});
    ui.querySelector('#larger').addEventListener('click',()=>{
      const parent=focusNode?.parentElement;
      if(!parent||parent.matches('body,html')||parent.querySelector('[data-jev-ui]')){ui.querySelector('#status').textContent='已到达可选择的最大范围';return;}
      focusTrail.push(focusNode);focus(parent,false);
    });
    ui.querySelector('#smaller').addEventListener('click',()=>{const child=focusTrail.pop();if(child)focus(child,false);});
    ui.querySelector('#dismiss-correction').addEventListener('click',()=>{correctionNode=null;ui.querySelector('#correction').hidden=true;});
    ui.querySelector('#assign').addEventListener('click',()=>{
      const rule=globalThis.JevManual.describeRule(correctionNode);
      if(!rule || rule.selector.length>1500 || /:nth-|^html(?: |>)/.test(rule.selector)) {ui.querySelector('#status').textContent='这个模块缺少稳定结构，暂时无法保存可复用的类别纠正。';return;}
      const category=ui.querySelector('#manual-category').value;
      overrides=overrides.filter(r=>r.selector!==rule.selector);overrides.push({selector:rule.selector,category});
      chosen.add(category);focusCategory=category;correctionNode=null;ui.querySelector('#correction').hidden=true;
      selectKnown();position();renderStatus();
    });
    ui.querySelector('#scope').addEventListener('change',()=>{clearMarks();focusNode?.removeAttribute('data-jev-focus');focusNode=null;ui.querySelector('#selection').hidden=true;chosen=new Set(rulesForScope().filter(r=>r.action!=='keep').map(r=>r.category).filter(Boolean));loadOverrides();correctionNode=null;ui.querySelector('#correction').hidden=true;previewing=false;ui.querySelector('#effect').textContent='预览效果';syncCandidates();});
    ui.querySelector('#effect').addEventListener('click',()=>{previewing=!previewing;selectKnown();ui.querySelector('#effect').textContent=previewing?'返回选择':'预览效果';if(!previewing)syncCandidates();position();});
    ui.querySelector('#retry').addEventListener('click',async()=>{engine.reset();await refresh();syncCandidates();});
    ui.querySelector('#save').addEventListener('click',async()=>{
      const button=ui.querySelector('#save');button.disabled=true;positionQuick();
      const savingUrl=page();
      try {
        const key=scope(page(),ui.querySelector('#scope').value || 'site'),rules=draftRules();
        const boundaries=serializePartitions(key);
        await request('rulesSet',{key,rules,partitions:boundaries,learnSplit:learnedSplit,...(key.endsWith('|site')?{baseRules:rulesForScope()}:{})});
        groups=groups.filter(g=>g.key!==key);groups.push({key,rules,partitions:boundaries});
        if(!await refresh()||page()!==savingUrl)throw new Error('规则已保存，但页面状态已变化，请再次保存以更新快照。');
        remember(collectRegions());
        try {await persistSnapshot();}catch {throw new Error('规则已保存，但快速显示快照未写入成功，请再次点击保存。');}
        partitions.clear();leave();
      }catch(error){if(ui){ui.querySelector('#status').textContent=error.message;button.disabled=false;positionQuick();}}
    });
    document.addEventListener('click',click,true);document.addEventListener('keydown',keydown,true);syncCandidates();
  }
  new MutationObserver(changes=>{
    changes=changes.filter(change=>{
      if(change.type!=='attributes')return true;
      const expected=change.attributeName==='data-jev-manual-hidden'?hidden:change.attributeName==='data-jev-awaiting'?awaitingDecision:null;
      return !expected||change.target.hasAttribute(change.attributeName)!==expected.has(change.target);
    });
    if(!changes.length)return;
    if(changes.length&&changes.every(change=>change.target?.closest?.('[data-jev-ui]')))return;
    // Mutation callbacks run before paint: protect newly inserted modules now,
    // rather than letting them render during the debounce/classification delay.
    if(url===page()&&!active&&groups.length)apply();
    clearTimeout(timer);timer=setTimeout(()=>{if(url!==page()){if(active)leave();void refresh();}else if(active)syncCandidates();else apply();},200);
  }).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','id','role','data-testid','data-test','data-component','src','href','style','data-jev-manual-hidden','data-jev-awaiting']});
  chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
    if(msg.type==='rulesChanged'||msg.type==='configChanged')void refresh();
    if(msg.type==='pageAction') {
      const work=msg.action==='toggleVisibility'?(async()=>{if(active)leave();showOriginal=!showOriginal;if(showOriginal)globalThis.JevPage?.suspend();else void globalThis.JevPage?.resume();apply();})():msg.action==='undoSave'?(async()=>{if(active)leave();await request('rulesUndo',{keys:keys()});await refresh();})():msg.action==='preview'?start():msg.action==='clearRules'?(async()=>{if(active)leave();await request('rulesDelete',{keys:keys()});await refresh();void globalThis.JevPage?.resume();})():Promise.reject(new Error('未知操作'));
      work.then(()=>respond({ok:true})).catch(error=>respond({ok:false,error:error.message}));return true;
    }
  });
  globalThis.JevPreview={get active(){return active;},get hasRules(){return showOriginal || groups.length>0;},get pending(){return engine.pending+autoPending.size;},get error(){return engine.error;},start};
  globalThis.addEventListener?.('popstate',()=>{if(active)leave();void refresh();});
  globalThis.navigation?.addEventListener('navigatesuccess',()=>{if(active)leave();void refresh();});
  void refresh();
})();
