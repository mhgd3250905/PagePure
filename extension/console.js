(() => {
  'use strict';
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
      .launcher img {display:block;border:0;border-radius:0;background:transparent;}
      .launcher { display:flex;align-items:center;gap:8px; border:1px solid #dde3ed; border-radius:16px; padding:10px 14px 10px 11px; background:#fbfcfe; color:#182235; font-size:13px;font-weight:650;letter-spacing:.1px;box-shadow:0 4px 18px #18223515,0 1px 3px #18223508; }
      .launcher:hover,.launcher[aria-expanded="true"] {border-color:#b8c7ec;background:#f3f6ff;}
      button:focus-visible { outline:2px solid #315fe9; outline-offset:3px; }
      .panel { position:absolute; bottom:56px; left:0; width:min(358px,calc(100vw - 32px)); height:min(480px,calc(100dvh - 90px)); background:#fbfcfe; border:1px solid #e1e6ef; border-radius:20px; overflow:hidden; box-shadow:0 18px 64px #18223520,0 3px 12px #1822350a; }
      .panel[hidden] { display:none; }
      .bar { height:62px; padding:0 16px 0 20px; display:flex; align-items:center; justify-content:space-between; color:#182235; background:#fbfcfe; border-bottom:1px solid #edf0f5; }
      .brand {display:flex;align-items:center;gap:9px;font-size:15px;letter-spacing:.1px;}
      .brand img {display:block;}
      .close { display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:9px;background:transparent;color:#7b8597;font-size:21px;line-height:1; }
      .close:hover {background:#edf1f7;color:#182235;}
      iframe { display:block; border:0; width:100%; height:calc(100% - 62px); background:#fbfcfe; }
    </style><section class="panel" id="jev-console-panel" aria-label="网页净化助手操作台" hidden><div class="bar"><strong class="brand"><img src="${chrome.runtime.getURL('icons/pagepure-48.png')}" alt="" width="28" height="28">PagePure</strong><button class="close" type="button" aria-label="收起操作台">×</button></div></section><button class="launcher" type="button" aria-label="打开 PagePure 净化操作台" aria-controls="jev-console-panel" aria-expanded="false"><img src="${chrome.runtime.getURL('icons/pagepure-48.png')}" alt="" width="23" height="23">PagePure</button>`;
    const panel = root.querySelector('.panel');
    const launcher = root.querySelector('.launcher');
    let frame;
    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      frame?.remove();
      frame = null;
      launcher.focus();
    }
    launcher.addEventListener('click', () => {
      if (!panel.hidden) { close(); return; }
      frame = document.createElement('iframe');
      frame.title = 'PagePure 网页净化助手设置';
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
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, {once:true});
})();
