(() => {
  const {t} = globalThis.PagePureI18n;
  const {scope, matches} = globalThis.JevManual;
  let active = false, host, ui, layer, layerRoot, resizing, toolbarResizing, timer;
  let candidates = [], selected = new Set(), hidden = new Set();
  let groups = [], config = {}, url = '', revision = 0, previewing = false, collapsed = false;
  let rulesReady=false, ruleCovered=new Set();
  function notifyRulesApplied(){
    const EventType=document.defaultView?.Event;
    if(EventType)document.dispatchEvent(new EventType('pagepure-rules-applied'));
  }
  let groupOffer=null;
  function clearGroupOffer(){
    groupOffer?.nodes.forEach(node=>node.removeAttribute('data-jev-group-offer'));
    groupOffer=null;
    if(ui)ui.querySelector('#group-offer').hidden=true;
  }
  function offerGroup(action,pageOnly){
    clearGroupOffer();
    const rule=globalThis.JevManual.describeGroupRule(focusNode);
    if(!rule)return false;
    groupOffer={...rule,action,pageOnly,focus:focusNode,url:page()};
    rule.nodes.forEach(node=>node.setAttribute('data-jev-group-offer',''));
    ui.querySelector('#group-offer').hidden=false;
    ui.querySelector('#group-message').textContent=t(action==='hide'?'groupHideOffer':'groupKeepOffer',rule.nodes.length);
    ui.querySelector('#group-confirm').textContent=t(action==='hide'?'groupHideConfirm':'groupKeepConfirm',rule.nodes.length);
    position();
    return true;
  }
  const diagnostics=[];
  const diagnosticSelector=selector=>(selector||'').replace(/\[(?:href|src)[^\]]*\]/gi,'[URL-attribute]').replace(/https?:\/\/[^\s"'\]]+/g,'[URL]').slice(0,1500);
  function renderDiagnostics(){
    const output=ui?.querySelector('#diagnostic-log');
    if(output)output.value=diagnostics.length?JSON.stringify(diagnostics,null,2):t('diagnosticsEmpty');
  }
  function recordDiagnostic(action,pageOnly,rule,rejected=false){
    const node=focusNode,covered=[...previewTargets].some(n=>n===node||n.contains(node));
    const current=scope(page(),'page'),editing=scope(page(),ui?.querySelector('#scope').value||'site');
    const sources=[...groups.filter(g=>g.key!==editing),{key:editing,rules:draftRules()}];
    const relatedKeeps=sources.flatMap(group=>group.rules.filter(r=>r.action==='keep'&&r.selector&&(!r.page||r.page===current)).filter(r=>[...matches(document,[r])].some(n=>n===node||n.contains(node)||node?.contains(n))).map(r=>({scope:r.page||group.key===current?'page':group.key.endsWith('|site')?'site':'type',selector:diagnosticSelector(r.selector)})));
    const rect=node?.getBoundingClientRect(),style=node&&globalThis.getComputedStyle?.(node);
    diagnostics.push({time:new Date().toISOString(),action,scope:pageOnly?'page':ui?.querySelector('#scope').value||'site',selector:diagnosticSelector(rule?.selector),reason:rejected?(!rule?'no-stable-selector':rule.selector.length>1500?'selector-too-long':/:nth-/.test(rule.selector)?'positional-selector':'document-root-selector'):action==='hide'&&!covered?(relatedKeeps.length?'related-keep-rules':'target-not-covered'):'draft-evaluated',result:rejected?'selector-rejected':covered?'draft-marked':'not-marked',matchedCount:rule?[...matches(document,[rule])].length:0,targetConnected:!!node?.isConnected,targetMatched:!!rule&&matches(document,[rule]).has(node),targetCovered:!!covered,candidateCount:candidates.length,selectedCount:selected.size,relatedKeeps,mode:previewing?'preview':collapsed?'collapsed':'editing',previewing,collapsed,display:style?.display||'',visibility:style?.visibility||'',previewHideAttribute:!!node?.hasAttribute('data-jev-preview-hide'),manualHideAttribute:!!node?.hasAttribute('data-jev-manual-hidden'),targetRect:rect?{top:Math.round(rect.top),left:Math.round(rect.left),width:Math.round(rect.width),height:Math.round(rect.height)}:null});
    if(diagnostics.length>20)diagnostics.shift();
    renderDiagnostics();
  }
  let syncing = false, applying = false, localRules = [], focusNode = null, focusTrail = [], showOriginal = false, previewNodes = new Set();
  const signature=node=>{const {id,...data}=globalThis.JevZhihu.describe(node);return JSON.stringify(data);};
  const page = () => document.location.href;
  const keys = () => ['site','type','page'].map(mode => scope(page(),mode));
  async function request(type,payload) {
    const response = await chrome.runtime.sendMessage({type,payload});
    if (!response?.ok) throw new Error(response?.error || t('previewNoHelper'));
    return response.data;
  }
  const canSplit = () => config.enabled && config.aiEnabled && config.configured;
  const rulesForScope = () => groups.find(g=>g.key===scope(page(),ui?.querySelector('#scope').value || 'site'))?.rules || [];
  let previewTargets=new Set();
  function draftRules() {return [...localRules];}
  function applicableRules(draft=false) {
    const current=scope(page(),'page'), editing=scope(page(),ui?.querySelector('#scope').value || 'site');
    const source=draft?[...groups.filter(g=>g.key!==editing),{key:editing,rules:draftRules()}]:groups;
    return source.flatMap(g=>g.rules.filter(r=>r.selector&&(!r.page||r.page===current)).map(r=>({...r,pageOnly:!!r.page||g.key===current})));
  }
  function visibility(rules) {
    const select=(pageOnly,keep)=>{
      const subset=rules.filter(r=>r.pageOnly===pageOnly&&(r.action==='keep')===keep);
      return matches(document,subset);
    };
    const hidden=select(false,false), kept=select(false,true), pageHidden=select(true,false), pageKept=select(true,true);
    const explicitFor=pageOnly=>matches(document,rules.filter(r=>r.pageOnly===pageOnly&&r.action!=='keep'));
    const explicitHidden=explicitFor(false),explicitPageHidden=explicitFor(true);
    const protectedBy=(node,keep,explicit)=>keep===node||node.contains(keep)||(keep.contains(node)&&!explicit.has(node));
    for(const node of hidden)if([...kept].some(k=>protectedBy(node,k,explicitHidden)))hidden.delete(node);
    for(const node of pageHidden)hidden.add(node);
    for(const node of hidden)if([...pageKept].some(k=>protectedBy(node,k,explicitPageHidden)))hidden.delete(node);
    for(const node of pageKept)kept.add(node);
    return {hidden,kept};
  }
  function loadRules() {localRules=rulesForScope().filter(r=>r.selector);}
  function restore() {hidden.forEach(n=>n.removeAttribute('data-jev-manual-hidden'));hidden.clear();}
  function apply() {
    if(applying)return;
    applying=true;
    try {
      ruleCovered=matches(document,applicableRules());
      if(active||showOriginal||!config.enabled){restore();globalThis.JevPage?.report?.();return;}
      const nextHidden=visibility(applicableRules()).hidden;
      for(const node of nextHidden)if(!node.hasAttribute('data-jev-manual-hidden'))node.setAttribute('data-jev-manual-hidden','');
      for(const node of hidden)if(!nextHidden.has(node))node.removeAttribute('data-jev-manual-hidden');
      hidden=nextHidden;
      globalThis.JevPage?.report?.();
    }finally{applying=false;notifyRulesApplied();}
  }
  async function refresh() {
    rulesReady=false;
    const version=++revision, nextUrl=page();
    if(url!==nextUrl){partitions.clear();showOriginal=false;}
    url=nextUrl;
    try {
      const [data,nextConfig]=await Promise.all([request('rulesGet',{keys:keys()}),request('configGet')]);
      if(version!==revision || url!==page())return;
      groups=data.groups;config=nextConfig;rulesReady=true;
      if(active)syncCandidates();else apply();
      if(config.enabled&&groups.some(g=>g.rules.some(r=>r.selector)))globalThis.JevStartup?.prepare(apply);
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
    const targeted=visibility(applicableRules(true)).hidden;
    previewTargets=targeted;
    for(const node of candidates) {
      const picked=[...targeted].some(n=>n===node||n.contains(node));
      node.toggleAttribute('data-jev-selected',picked);
      node.toggleAttribute('data-jev-preview-hide',picked&&(previewing||collapsed));
      if(picked){selected.add(node);if(previewing||collapsed)previewNodes.add(node);}
    }
    if(previewing||collapsed)for(const node of targeted){node.setAttribute('data-jev-preview-hide','');previewNodes.add(node);}
  }
  function renderStatus() {
    if(!ui)return;
    const rules=applicableRules(true);
    const requestedHide=focusNode&&matches(document,rules.filter(r=>r.action!=='keep')).has(focusNode);
    const focusHidden=focusNode&&[...previewTargets].some(node=>node===focusNode||node.contains(focusNode));
    ui.querySelector('#status').textContent=requestedHide&&!focusHidden?t('areaHideConflict'):(selected.size ? t('toolbarStatusHidden', selected.size) : '');
    ui.querySelector('#legacy').textContent=localRules.length?t('toolbarStatusLegacy', localRules.length):'';
    const rulesList=ui.querySelector('#rule-list');rulesList.replaceChildren();
    localRules.forEach((rule,index)=>{if(rule.page&&rule.page!==scope(page(),'page'))return;const b=document.createElement('button');b.type='button';b.textContent=t('ruleEntry', rule.page?t('rulePagePrefix'):'', rule.action==='keep'?t('actionKeep'):t('actionHide'), rule.label);b.addEventListener('click',()=>{localRules.splice(index,1);selectKnown();position();renderStatus();});rulesList.append(b);});
  }
  function moduleName(node) {
    const copy=node.cloneNode(true);copy.querySelectorAll('script,style,noscript,template,input,textarea,select,[contenteditable]').forEach(n=>n.remove());
    const data=globalThis.JevZhihu.describe(copy);
    return (data.text || data.images?.find(img=>img.alt)?.alt || (node.querySelector('iframe')?t('previewEmbedRegion'):t('previewImageRegion'))).slice(0,60);
  }
  let quickAnchor=null, splitting=false, learnedSplit=false;
  const partitions=new Map();
  function splitCandidates(parent) {
    const visible=n=>{const r=n.getBoundingClientRect();return r.width>=24&&r.height>=20&&!n.matches('script,style,noscript,template,input,textarea,select,svg,[contenteditable],[data-jev-ui]')&&!n.closest('[contenteditable],[data-jev-ui]');};
    let parts=[...parent.children].filter(visible);
    for(let depth=0;parts.length===1&&depth<5;depth++)parts=[...parts[0].children].filter(visible);
    return parts.length>=2&&parts.length<=20?parts:[];
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
        throw new Error(t('splitUnstableSave'));
      const pageType=key.endsWith('|site')?scope(page(),'type'):undefined;
      specs.set((pageType||'')+'|'+rules[0].selector,{parent:rules[0].selector,parts:rules.slice(1).map(r=>r.selector),...(pageType?{pageType}:{})});
    }
    return [...specs.values()].slice(-40);
  }
  function collectRegions(){
    const restored=new Map([...savedPartitions(),...partitions]);
    let nodes=globalThis.JevZhihu.collect(document);
    for(const [parent,parts] of restored){if(!parent.isConnected){partitions.delete(parent);continue;}
      if(parts.some(n=>!n.isConnected||!parent.contains(n)))continue;
      nodes=nodes.filter(n=>n!==parent&&!parent.contains(n)&&!n.contains(parent));nodes.push(...parts);
    }
    return [...new Set(nodes)];
  }
  async function splitFocus(){
    if(splitting||!focusNode?.isConnected)return;
    if(!canSplit()){ui.querySelector('#status').textContent=t('splitNeedsAi');return;}
    const parent=focusNode,expectedUrl=page(),expectedHost=host;
    const parts=splitCandidates(parent);
    if(parts.length<2||parts.length>20){ui.querySelector('#status').textContent=t('splitExpandFirst');return;}
    const fingerprints=parts.map(signature);
    splitting=true;ui.querySelector('#q-split').disabled=true;ui.querySelector('#q-split').textContent=t('splitInProgress');
    try{
      const result=await request('splitBlock',{resetLearning:!learnedSplit,parent:{...globalThis.JevZhihu.describe(parent),id:'parent'},blocks:parts.map((n,i)=>({...globalThis.JevZhihu.describe(n),id:'part-'+i}))});
      if(!active||host!==expectedHost||page()!==expectedUrl||!parent.isConnected)return;
      if(parts.some((n,i)=>!n.isConnected||signature(n)!==fingerprints[i]))throw new Error(t('splitErrorChanged'));
      const accepted=parts.filter((n,i)=>result.ids?.includes('part-'+i));
      if(accepted.length<2)throw new Error(t('splitErrorTooFew'));
      partitions.set(parent,parts);learnedSplit=true;syncCandidates();focus(accepted[0]);
      ui.querySelector('#status').textContent=t('splitDone', parts.length);
    }catch(error){if(ui)ui.querySelector('#status').textContent=error.message;}
    finally{splitting=false;if(ui){ui.querySelector('#q-split').disabled=false;ui.querySelector('#q-split').textContent=t('splitLabel');}}
  }
  function positionQuick() {
    const quick=ui?.querySelector('#quick');if(!quick)return;
    quick.hidden=!focusNode?.isConnected;
    if(quick.hidden)return;
    const r=focusNode.getBoundingClientRect(),w=Math.min(320,innerWidth-16);
    const x=quickAnchor?.x ?? r.left, y=quickAnchor?.y ?? r.top;
    quick.style.left=Math.max(8,Math.min(x+12,innerWidth-w-8))+'px';
    quick.style.width=w+'px';
    const height=quick.getBoundingClientRect().height || 60;
    quick.style.top=Math.max(8,Math.min(y+12,innerHeight-height-8))+'px';
    ui.querySelector('#quick-name').textContent=t('quickSelectedRegion');
    ui.querySelector('#quick-name').title=moduleName(focusNode);
    ui.querySelector('#q-smaller').disabled=!focusTrail.length;
    ui.querySelector('#q-save').disabled=ui.querySelector('#save').disabled;
  }
  function focus(node, reset=true) {
    if(previewing||!node?.isConnected)return;
    clearGroupOffer();
    focusNode?.removeAttribute('data-jev-focus');focusNode=node;
    if(reset)focusTrail=[];
    node.setAttribute('data-jev-focus','');
    ui.querySelector('#selection').hidden=false;
    ui.querySelector('#selection-name').textContent=t('selectionName', moduleName(node));
    ui.querySelector('#smaller').disabled=!focusTrail.length;positionQuick();renderStatus();
  }
  function toggle(node,event) {quickAnchor=event&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)?{x:event.clientX,y:event.clientY}:null;focus(node);}
  function areaRule(action,pageOnly=false,confirmedRule=null) {
    if(!confirmedRule)clearGroupOffer();
    const rule=confirmedRule||globalThis.JevManual.describeRule(focusNode);
    if(!rule || rule.selector.length>1500 || /:nth-|^html(?: |>)/.test(rule.selector)) {
      recordDiagnostic(action,pageOnly,rule,true);
      if(offerGroup(action,pageOnly))return;
      const message=t('areaRuleFallback');
      ui.querySelector('#status').textContent=message;ui.querySelector('#quick-name').textContent=message;
      return;
    }
    const current=scope(page(),'page');
    localRules=localRules.filter(r=>r.selector!==rule.selector||(pageOnly?r.page!==current:!!r.page&&r.page!==current));
    if(action==='hide')localRules=localRules.filter(r=>{
      if(r.action!=='keep'||(pageOnly?r.page!==current:!!r.page&&r.page!==current))return true;
      const nodes=[...matches(document,[r])];
      // Replace an earlier restoration only when all its matches are inside
      // this explicit selection. Preserve rules for other areas and scopes.
      const targets=confirmedRule?[...matches(document,[confirmedRule])]:[focusNode];
      return !nodes.length||!nodes.every(node=>targets.some(target=>node===target||target.contains(node)));
    });
    localRules.push({...rule,label:moduleName(focusNode),action,...(pageOnly?{page:current}:{})});
    selectKnown();position();renderStatus();
    recordDiagnostic(action,pageOnly,rule);
    if(pageOnly&&(action==='keep'||[...previewTargets].some(node=>node===focusNode||node.contains(focusNode))))ui.querySelector('#status').textContent=t(action==='keep'?'previewPageOnlyKeep':'previewPageOnlyHide');
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
    if(!globalThis.requestAnimationFrame){position();return;}
    if(positionFrame)return;
    positionFrame=requestAnimationFrame(()=>{positionFrame=null;position();});
  }
  function position() {
    if(!layerRoot)return;
    [...layerRoot.querySelectorAll('button')].forEach((button,index)=>{
      const node=candidates[index],r=coverageRect(node);
      button.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;display:${previewing||node.closest('[data-jev-preview-hide]')||r.width<1||r.height<1?'none':'block'};border:2px ${selected.has(node)?'solid #64748b':'dashed #3886f5'};background:${selected.has(node)?'transparent':'transparent'};padding:0;margin:0;pointer-events:auto;cursor:crosshair;box-sizing:border-box;`;
      button.setAttribute('aria-pressed',String(selected.has(node)));
      button.setAttribute('aria-label',t('candidateAria', index+1));
      button.title=t('candidateTitle');
    });
    layerRoot.querySelectorAll('[data-mask]').forEach(n=>n.remove());
    const targets=new Set([...selected,...previewTargets]);
    if(!previewing&&!collapsed)for(const node of targets) {
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
      const word=document.createElement('span');const stampWord=t('toolbarStamp');const wide=[...stampWord].length>2;word.textContent=stampWord;word.style.cssText=`font:600 ${compact?(wide?12:16):(wide?16:23)}px "Microsoft YaHei",system-ui;letter-spacing:${compact?(wide?1:4):(wide?2:6)}px;padding-left:${compact?(wide?1:4):(wide?2:6)}px;line-height:1.2;`;stamp.append(word);
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
      selectKnown();
      if(layerRoot) {
        layerRoot.replaceChildren();resizing?.disconnect();
        candidates.forEach(node=>{const button=document.createElement('button');button.type='button';button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggle(node,event);});layerRoot.append(button);resizing?.observe(node);});
        position();
      }
      renderStatus();
    }finally{syncing=false;}
  }
  function leave() {
    clearGroupOffer();
    globalThis.cancelAnimationFrame?.(positionFrame);positionFrame=null;clearMarks();partitions.clear();learnedSplit=false;focusNode?.removeAttribute('data-jev-focus');focusNode=null;quickAnchor=null;active=false;previewing=false;collapsed=false;
    layer?.remove();layer=null;layerRoot=null;resizing?.disconnect();resizing=null;toolbarResizing?.disconnect();toolbarResizing=null;
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
    await globalThis.PagePureI18n.ready;
    await refresh();active=true;showOriginal=false;globalThis.JevPage?.suspend();restore();
    loadRules();
    host=document.createElement('div');host.setAttribute('data-jev-ui','preview');host.style.cssText='position:fixed!important;top:16px!important;right:16px!important;z-index:2147483647!important;';
    ui=host.attachShadow({mode:'open'});
    ui.innerHTML=`<style>
      :host{font:13px system-ui,-apple-system,sans-serif;color:#263549;color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}
      button,summary,select{font:inherit}button,summary{cursor:pointer;white-space:nowrap}button{height:34px;padding:0 10px;border:1px solid #d8e1ec;border-radius:7px;background:#f6f8fb;color:inherit;font-weight:500;box-shadow:0 1px 2px #172b3a08;transition:background .12s,border-color .12s,box-shadow .12s}button:not(:disabled):hover,summary:hover{background:#eaf1fa;border-color:#a7bdd9;box-shadow:0 2px 5px #172b3a12}button:not(:disabled):active{transform:translateY(1px);box-shadow:none}button:focus-visible,summary:focus-visible,select:focus-visible{outline:2px solid #1768ed;outline-offset:2px}button:disabled{color:#a5afbd;background:#fafbfd;border-color:#edf0f5;box-shadow:none;cursor:not-allowed}
      #quick{position:fixed;z-index:2147483647;padding:8px;background:#fff;border:1px solid #dce3ec;border-radius:12px;box-shadow:0 8px 28px #0f172a24;max-height:calc(100dvh - 16px);overflow:auto}
      .main-actions{display:flex;align-items:center;gap:5px;padding:0 2px 10px}
      #quick-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#53647b;font-size:12px;font-weight:600}
      .range-row{margin-bottom:6px}.range{display:flex;gap:3px}.range button{flex:1}.range button{height:28px;font-size:11px;padding:0 6px;background:#fff;box-shadow:none}
      #cancel{width:28px;height:28px;padding:0;color:#7b889b;background:#fff;box-shadow:none}
      #more-toggle{list-style:none;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid #d8e1ec;background:#fff;border-radius:7px;font-size:17px}#more-toggle::-webkit-details-marker{display:none}#more[open] #more-toggle{background:#edf3fc;border-color:#b9ceeb}
      .action-row{display:grid;grid-template-columns:58px 1fr 1fr;align-items:center;gap:6px;padding:8px;background:#f5f7fb;border:1px solid #e8edf4;border-radius:9px}.scope-label{font-size:11px;color:#64748b;font-weight:500;padding-left:2px}
      .action-row button{background:#fff;box-shadow:0 1px 2px #172b3a06;font-size:12px;padding:0 6px}
      #q-hide{color:#155bc6;background:#edf4ff;border-color:#c9dcfa}#q-hide:hover{background:#dceaff}
      #more-actions{margin-top:6px}
      #group-offer{margin-top:8px;padding:10px;border:1px solid #9bbef5;border-radius:8px;background:#edf4ff}#group-message{margin:0 0 8px;font-size:12px;line-height:1.6}#group-offer button{white-space:normal;height:auto;min-height:32px;margin-right:5px}#group-confirm{background:#1768ed;color:#fff;border-color:#1768ed}
      #diagnostics{margin-top:8px;font-size:12px;color:#53647b}#diagnostics summary{padding:6px 0;color:#155bc6}#diagnostics p{line-height:1.5;margin:4px 0}#diagnostic-log{display:block;width:100%;height:150px;resize:vertical;border:1px solid #d8e1ec;border-radius:7px;padding:6px;background:#f6f8fb;color:#263549;font:11px ui-monospace,monospace}
      #collapse{width:100%;height:auto;min-height:32px;white-space:normal;margin-top:6px;font-size:12px;color:#155bc6;background:#f5f8ff;border-color:#dbe6fa}#collapse[aria-pressed=true]{background:#edf4ff;border-color:#9bbef5}
      .footer-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:8px;border-top:1px solid #e8edf4;margin-top:10px;padding-top:10px}
      #quick:has(#more[open]) .footer-actions{margin-top:0}
      #q-save{background:#1768ed;color:#fff;border-color:#1768ed;box-shadow:0 2px 5px #1768ed25}#q-save:hover{background:#1255c5}
      #status{margin:6px 6px 0;font-size:12px;line-height:1.5;color:#64748b;overflow-wrap:anywhere}#status:empty{display:none}
      @media(max-width:300px){.action-row{grid-template-columns:48px 1fr 1fr;padding:6px;gap:4px}.range button{padding:0 4px}button{padding:0 4px}}
    </style>
    <div id="quick" role="toolbar" aria-label="${t('toolbarAria')}" hidden>
      <div class="main-actions">
        <span id="quick-name"></span>
        <details id="more"><summary id="more-toggle" aria-label="${t('moreAria')}" title="${t('moreAria')}">···</summary></details>
        <button id="cancel" aria-label="${t('cancelAria')}" title="${t('cancelAria')}">×</button>
      </div>
      <div class="action-row range-row"><span class="scope-label">${t('scopeRangeLabel')}</span><div class="range" role="group" aria-label="${t('rangeGroupAria')}"><button id="q-larger" title="${t('largerTitle')}">${t('largerBtn')}</button><button id="q-smaller" title="${t('smallerTitle')}">${t('smallerBtn')}</button></div><button id="q-split" title="${t('splitTitle')}">${t('splitLabel')}</button></div>
      <div class="action-row" role="group" aria-label="${t('areaGroupAria')}"><span class="scope-label">${t('areaScopeLabel')}</span><button id="q-hide">${t('hideAreaBtn')}</button><button id="q-keep">${t('keepAreaBtn')}</button></div>
      <div id="more-actions" hidden>
        <div class="action-row" role="group" aria-label="${t('pageGroupAria')}"><span class="scope-label">${t('pageScopeLabel')}</span><button id="q-page-hide" aria-label="${t('pageHideAria')}">${t('hideAreaBtn')}</button><button id="q-page-keep" aria-label="${t('pageKeepAria')}">${t('keepAreaBtn')}</button></div>
        <details id="diagnostics"><summary>${t('diagnosticsTitle')}</summary><p>${t('diagnosticsHint')}</p><textarea id="diagnostic-log" readonly aria-label="${t('diagnosticsTitle')}" spellcheck="false"></textarea></details>
      </div>
      <div id="group-offer" hidden><p id="group-message" role="status"></p><button id="group-confirm"></button><button id="group-cancel">${t('groupHideCancel')}</button></div>
      <button id="collapse" aria-pressed="false">${t('collapseHidden')}</button>
      <div class="footer-actions"><button id="effect">${t('effectPreview')}</button><button id="q-save">${t('saveBtn')}</button></div>
      <p id="status" role="status" aria-live="polite"></p>
    </div>
    <div hidden aria-hidden="true"><div id="selection" hidden><p id="selection-name"></p></div><button id="hide-area"></button><button id="keep-area"></button><button id="page-hide"></button><button id="page-keep"></button><button id="larger"></button><button id="smaller"></button><button id="save"></button><button id="retry"></button><select id="scope"><option value="site">${t('scopeSite')}</option><option value="type">${t('scopeType')}</option><option value="page">${t('scopeCurrentPage')}</option></select><p id="legacy"></p><div id="rule-list"></div></div>`;
    ui.querySelector('#more').addEventListener('toggle',()=>{
      ui.querySelector('#more-actions').hidden=!ui.querySelector('#more').open;
      positionQuick();
    });
    ui.querySelector('#scope option[value=site]').selected=true;
    document.body.append(host);
    layer=document.createElement('div');layer.setAttribute('data-jev-ui','selection-layer');layer.style.cssText='position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;';
    layerRoot=layer.attachShadow({mode:'open'});document.body.append(layer);
    if(globalThis.ResizeObserver){resizing=new ResizeObserver(position);toolbarResizing=new ResizeObserver(positionQuick);toolbarResizing.observe(ui.querySelector('#quick'));}
    globalThis.addEventListener?.('scroll',afterLayout,true);globalThis.addEventListener?.('resize',afterLayout);
    ui.querySelector('#cancel').addEventListener('click',leave);
    ui.querySelector('#group-cancel').addEventListener('click',()=>{clearGroupOffer();position();renderStatus();});
    ui.querySelector('#group-confirm').addEventListener('click',()=>{
      const offer=groupOffer;
      if(!offer)return;
      const fresh=globalThis.JevManual.describeGroupRule(focusNode);
      const unchanged=offer.focus===focusNode&&offer.url===page()&&fresh?.selector===offer.selector&&fresh.nodes.length===offer.nodes.length&&fresh.nodes.every(node=>offer.nodes.includes(node)&&node.isConnected);
      clearGroupOffer();
      if(!unchanged){areaRule(offer.action,offer.pageOnly);return;}
      areaRule(offer.action,offer.pageOnly,{selector:offer.selector,label:offer.label});
      position();
    });
    ui.querySelector('#q-split').addEventListener('click',splitFocus);
    ui.querySelector('#collapse').addEventListener('click',()=>{
      collapsed=!collapsed;
      ui.querySelector('#collapse').textContent=t(collapsed?'expandHidden':'collapseHidden');
      ui.querySelector('#collapse').setAttribute('aria-pressed',String(collapsed));
      if(previewing)selectKnown();else syncCandidates();
      position();
      if(focusNode)recordDiagnostic('collapse-toggle',false,globalThis.JevManual.describeRule(focusNode));
    });
    renderDiagnostics();
    ui.querySelector('#diagnostics').addEventListener('toggle',positionQuick);
    for(const [quick,target] of [['q-larger','larger'],['q-smaller','smaller'],['q-hide','hide-area'],['q-save','save'],['q-keep','keep-area'],['q-page-hide','page-hide'],['q-page-keep','page-keep']])ui.querySelector('#'+quick).addEventListener('click',()=>ui.querySelector('#'+target).click());
    ui.querySelector('#hide-area').addEventListener('click',()=>areaRule('hide'));
    ui.querySelector('#keep-area').addEventListener('click',()=>areaRule('keep'));
    ui.querySelector('#page-hide').addEventListener('click',()=>areaRule('hide',true));
    ui.querySelector('#page-keep').addEventListener('click',()=>areaRule('keep',true));
    ui.querySelector('#larger').addEventListener('click',()=>{
      const parent=focusNode?.parentElement;
      if(!parent||parent.matches('body,html')||parent.querySelector('[data-jev-ui]')){ui.querySelector('#status').textContent=t('maxRangeReached');return;}
      focusTrail.push(focusNode);focus(parent,false);
    });
    ui.querySelector('#smaller').addEventListener('click',()=>{const child=focusTrail.pop();if(child)focus(child,false);});
    ui.querySelector('#scope').addEventListener('change',()=>{clearMarks();focusNode?.removeAttribute('data-jev-focus');focusNode=null;ui.querySelector('#selection').hidden=true;loadRules();previewing=false;ui.querySelector('#effect').textContent=t('effectPreview');syncCandidates();});
    ui.querySelector('#effect').addEventListener('click',()=>{previewing=!previewing;selectKnown();ui.querySelector('#effect').textContent=previewing?t('effectBack'):t('effectPreview');if(!previewing)syncCandidates();position();if(focusNode)recordDiagnostic('preview-toggle',false,globalThis.JevManual.describeRule(focusNode));});
    ui.querySelector('#retry').addEventListener('click',async()=>{await refresh();syncCandidates();});
    ui.querySelector('#save').addEventListener('click',async()=>{
      const button=ui.querySelector('#save');button.disabled=true;positionQuick();
      const savingUrl=page();
      try {
        const key=scope(page(),ui.querySelector('#scope').value || 'site'),rules=draftRules();
        const boundaries=serializePartitions(key);
        await request('rulesSet',{key,rules,partitions:boundaries,learnSplit:learnedSplit,...(key.endsWith('|site')?{baseRules:rulesForScope()}:{})});
        groups=groups.filter(g=>g.key!==key);groups.push({key,rules,partitions:boundaries});
        if(!await refresh()||page()!==savingUrl)throw new Error(t('savePageChanged'));
        partitions.clear();leave();
      }catch(error){if(ui){ui.querySelector('#status').textContent=error.message;button.disabled=false;positionQuick();}}
    });
    document.addEventListener('click',click,true);document.addEventListener('keydown',keydown,true);syncCandidates();
  }
  new MutationObserver(changes=>{
    changes=changes.filter(change=>{
      if(change.type!=='attributes')return true;
      const expected=change.attributeName==='data-jev-manual-hidden'?hidden:null;
      return !expected||change.target.hasAttribute(change.attributeName)!==expected.has(change.target);
    });
    if(!changes.length)return;
    if(changes.length&&changes.every(change=>change.target?.closest?.('[data-jev-ui]')))return;
    // Mutation callbacks run before paint: protect newly inserted modules now,
    // rather than letting them render during the debounce delay.
    if(url===page()&&!active&&groups.length){clearTimeout(timer);apply();return;}
    clearTimeout(timer);timer=setTimeout(()=>{if(url!==page()){if(active)leave();void refresh();}else if(active)syncCandidates();else apply();},200);
  }).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','id','role','data-testid','data-test','data-component','src','href','style','data-jev-manual-hidden']});
  chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
    if(msg.type==='rulesChanged'||msg.type==='configChanged'){if(msg.source==='manager'&&active)leave();void refresh();}
    if(msg.type==='pageAction') {
      const work=msg.action==='toggleVisibility'?(async()=>{if(active)leave();showOriginal=!showOriginal;if(showOriginal)globalThis.JevPage?.suspend();else void globalThis.JevPage?.resume();apply();})():msg.action==='undoSave'?(async()=>{if(active)leave();await request('rulesUndo',{keys:keys()});await refresh();})():msg.action==='preview'?start():msg.action==='clearRules'?(async()=>{if(active)leave();await request('rulesDelete',{keys:keys()});await refresh();void globalThis.JevPage?.resume();})():Promise.reject(new Error(t('unknownAction')));
      work.then(()=>respond({ok:true})).catch(error=>respond({ok:false,error:error.message}));return true;
    }
  });
  globalThis.JevPreview={get active(){return active;},get hasRules(){return showOriginal || groups.length>0;},get aiReady(){return rulesReady&&url===page()&&!active&&!showOriginal&&config.enabled&&globalThis.JevStartup?.released!==false;},aiAllows(node){return !!node?.isConnected&&![...ruleCovered].some(target=>target===node||target.contains(node)||node.contains(target));},get pending(){return 0;},get error(){return undefined;},start};
  document.addEventListener('pagepure-locale-changed',()=>{if(active)position();});
  globalThis.addEventListener?.('popstate',()=>{if(active)leave();void refresh();});
  globalThis.navigation?.addEventListener('navigatesuccess',()=>{if(active)leave();void refresh();});
  void refresh();
})();
