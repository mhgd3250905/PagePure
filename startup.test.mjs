import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
const source=readFileSync(new URL('./extension/startup.js',import.meta.url),'utf8');
function setup(){const {document,window}=parseHTML('<html><body><article>Content</article></body></html>');document.readyState='loading';let timeout;const context={document,MutationObserver:window.MutationObserver,setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){}};runInNewContext(source,context);return {document,window,gate:context.JevStartup,timeout:()=>timeout()};}
test('startup applies snapshot before releasing initial reveal gate',()=>{const e=setup();assert.ok(e.document.querySelector('[data-jev-ui=startup]'));let applied=false;e.gate.prepare(()=>{assert.ok(e.document.querySelector('[data-jev-ui=startup]'));applied=true;});assert.equal(applied,false);e.document.dispatchEvent(new e.window.Event('DOMContentLoaded'));assert.equal(applied,true);assert.equal(e.document.querySelector('[data-jev-ui=startup]'),null);});
test('unconfigured pages and timeout release gate without waiting for model',()=>{const a=setup();a.gate.release();assert.equal(a.document.querySelector('[data-jev-ui=startup]'),null);const b=setup();b.timeout();assert.equal(b.document.querySelector('[data-jev-ui=startup]'),null);});
