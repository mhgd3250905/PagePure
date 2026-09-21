(() => {
  'use strict';
  const {t} = globalThis.PagePureI18n;
  function mount() {
    if (!document.body || document.querySelector('[data-jev-ui="console"]')) return;
    const host = document.createElement('div');
    host.setAttribute('data-jev-ui', 'console');
    host.style.cssText = 'all:initial!important;position:fixed!important;left:16px!important;bottom:16px!important;z-index:2147483647!important;display:block!important;';
    const root = host.attachShadow({mode: 'closed'});
    root.innerHTML = `<style>
      :host { font:14px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif; }
      * { box-sizing:border-box; }
      button { font:inherit; cursor:pointer; }

      .launcher { position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:64px;height:64px;padding:0;border:1px solid #83aaa5;border-radius:50%;background:linear-gradient(145deg,#fff,#e8f3ee);color:#235d57;box-shadow:0 6px 22px #1e413c20,inset 0 0 0 3px #ffffff80;touch-action:none;user-select:none;cursor:grab; }
      .launcher::before {content:"";position:absolute;inset:4px;border:1px dashed #235d5766;border-radius:50%;pointer-events:none;}
      .launcher::after {content:"";width:16px;height:1px;background:#235d5773;margin-top:6px;transform:rotate(-8deg);}
      .launcher:hover,.launcher[aria-expanded="true"] {background:linear-gradient(145deg,#fff,#dceee8);box-shadow:0 6px 24px #1e413c30;}
      .launcher[data-dragging] {cursor:grabbing;}
      .seal-mark {width:10px;height:5px;border-left:2px solid #38766a;border-bottom:2px solid #38766a;transform:rotate(-53deg);margin-bottom:7px;pointer-events:none;}
      .seal-word {font-weight:650;line-height:1.2;transform:rotate(-8deg);pointer-events:none;white-space:nowrap;}
      button:focus-visible { outline:2px solid #315fe9; outline-offset:3px; }
      .panel { position:fixed; width:358px; height:480px; background:#fbfcfe; border:1px solid #e1e6ef; border-radius:20px; overflow:hidden; box-shadow:0 18px 64px #18223520,0 3px 12px #1822350a; }
      .panel[hidden] { display:none; }
      .bar { height:62px; padding:0 16px 0 20px; display:flex; align-items:center; justify-content:space-between; color:#182235; background:#fbfcfe; border-bottom:1px solid #edf0f5; }
      .brand {display:flex;align-items:center;gap:9px;font-size:15px;letter-spacing:.1px;}
      .brand img {display:block;}
      .brand-name{min-width:0;overflow-wrap:anywhere;font-size:14px;line-height:1.3}
      .brand-seal{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;width:36px;height:36px;border:1px solid #83aaa5;border-radius:50%;background:linear-gradient(145deg,#fff,#e8f3ee);color:#235d57;box-shadow:0 2px 6px #1e413c14}
      .brand-seal::before{content:"";position:absolute;inset:3px;border:1px dashed #235d5766;border-radius:50%}
      .brand-seal .seal-mark{width:6px;height:3px;border-width:1px;margin-bottom:3px}
      .brand-seal-word{font-weight:650;line-height:1.2;transform:rotate(-8deg)}
      .close { display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:9px;background:transparent;color:#7b8597;font-size:21px;line-height:1; }
      .close:hover {background:#edf1f7;color:#182235;}
      iframe { display:block; border:0; width:100%; height:calc(100% - 62px); background:#fbfcfe; }
    </style><section class="panel" id="jev-console-panel" aria-label="${t('consolePanelAria')}" hidden><div class="bar"><strong class="brand"><span class="brand-seal" aria-hidden="true"><span class="seal-mark"></span><span class="brand-seal-word"></span></span><span class="brand-name"></span></strong><button class="close" type="button" aria-label="${t('consoleCollapse')}">×</button></div></section><button class="launcher" type="button" aria-label="${t('consoleLauncherAria')}" aria-controls="jev-console-panel" aria-expanded="false"><span class="seal-mark" aria-hidden="true"></span><span class="seal-word" aria-hidden="true"></span></button>`;
    const panel = root.querySelector('.panel');
    const launcher = root.querySelector('.launcher');
    let frame;
    const viewport = () => ({width:window.innerWidth || document.documentElement.clientWidth || 1024,height:window.innerHeight || document.documentElement.clientHeight || 768});
    let position = {x:16,y:viewport().height - 80};
    const clamp = (value,min,max) => Math.max(min,Math.min(value,max));
    function layout() {
      const {width,height} = viewport();
      const size = Math.min(64,width,height);
      position.x = clamp(position.x,0,width-size);
      position.y = clamp(position.y,0,height-size);
      host.style.setProperty('left',`${position.x}px`,'important');
      host.style.setProperty('top',`${position.y}px`,'important');
      host.style.setProperty('bottom','auto','important');
      launcher.style.width = launcher.style.height = `${size}px`;
      const panelWidth = Math.max(0,Math.min(358,width-16));
      const panelHeight = Math.max(0,Math.min(480,height-16));
      panel.style.width = `${panelWidth}px`;
      panel.style.height = `${panelHeight}px`;
      panel.style.left = `${clamp(position.x,8,width-panelWidth-8)}px`;
      const above = position.y-panelHeight-10;
      panel.style.top = `${clamp(above>=8 ? above : position.y+size+10,8,height-panelHeight-8)}px`;
    }
    function localize() {
      const word = root.querySelector('.seal-word');
      const label = t('toolbarStamp');
      const length = [...label].length;
      word.textContent = label;
      word.style.fontSize = `${length<=2 ? 18 : length<=5 ? 12 : Math.max(7,58/(length*.65))}px`;
      word.style.letterSpacing = length<=2 ? '2px' : '0';
      root.querySelector('.brand-name').textContent=t('brandName');
      const brandWord=root.querySelector('.brand-seal-word');
      brandWord.textContent=label;
      brandWord.style.fontSize=`${length<=2?10:Math.min(8,28/(length*.65))}px`;
      launcher.setAttribute('aria-label',t('consoleLauncherAria'));
      launcher.title = t('consoleLauncherAria');
      panel.setAttribute('aria-label',t('consolePanelAria'));
      root.querySelector('.close').setAttribute('aria-label',t('consoleCollapse'));
      if(frame) frame.title = t('consoleFrameTitle');
    }
    localize();
    globalThis.PagePureI18n.ready?.then(localize);
    document.addEventListener('pagepure-locale-changed',localize);
    let drag = null, suppressClick = false;
    launcher.addEventListener('pointerdown',event => {
      if(event.button!==0 || event.isPrimary===false) return;
      suppressClick = false;
      drag = {id:event.pointerId,x:event.clientX,y:event.clientY,left:position.x,top:position.y,moved:false};
      launcher.setPointerCapture?.(event.pointerId);
    });
    launcher.addEventListener('pointermove',event => {
      if(!drag || drag.id!==event.pointerId) return;
      const dx = event.clientX-drag.x,dy = event.clientY-drag.y;
      if(!drag.moved && Math.hypot(dx,dy)<5) return;
      drag.moved = true;
      launcher.setAttribute('data-dragging','');
      position = {x:drag.left+dx,y:drag.top+dy};
      layout();
      event.preventDefault();
    });
    function finishDrag(event) {
      if(!drag || drag.id!==event.pointerId) return;
      suppressClick = drag.moved || event.type!=='pointerup';
      drag = null;
      launcher.removeAttribute('data-dragging');
      if(launcher.hasPointerCapture?.(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
    }
    launcher.addEventListener('pointerup',finishDrag);
    launcher.addEventListener('pointercancel',finishDrag);
    launcher.addEventListener('lostpointercapture',finishDrag);
    window.addEventListener('resize',layout);
    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      frame?.remove();
      frame = null;
      launcher.focus();
    }
    launcher.addEventListener('click', event => {
      if(suppressClick && event.detail!==0) { suppressClick=false;event.preventDefault();return; }
      suppressClick=false;
      layout();
      if (!panel.hidden) { close(); return; }
      frame = document.createElement('iframe');
      frame.title = t('consoleFrameTitle');
      frame.src = chrome.runtime.getURL('popup.html?embedded=1');
      panel.append(frame);
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      root.querySelector('.close').focus();
    });
    root.querySelector('.close').addEventListener('click', close);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    window.addEventListener('message', event => {
      if (frame && event.source === frame.contentWindow && event.data?.type === 'jev-console-close') close();
    });
    document.body.append(host);
    layout();
    // Search sites may replace body contents without reloading the document.
    // Reattach the existing console to retain its position and event handlers.
    let observedBody = document.body;
    const observer = new window.MutationObserver(() => {
      const body = document.body;
      if (!body) return;
      if (body !== observedBody) {
        observer.disconnect();
        observer.observe(document.documentElement, {childList:true});
        observer.observe(body, {childList:true});
        observedBody = body;
      }
      if (host.parentNode !== body) {
        close();
        drag = null;
        suppressClick = false;
        launcher.removeAttribute('data-dragging');
        body.append(host);
        layout();
      }
    });
    observer.observe(document.documentElement, {childList:true});
    observer.observe(observedBody, {childList:true});
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, {once:true});
})();
