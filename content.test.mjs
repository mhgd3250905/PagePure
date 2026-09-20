import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';

const blocksSource = readFileSync(new URL('./extension/blocks.js', import.meta.url), 'utf8');
const contentSource = readFileSync(new URL('./extension/content.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

async function environment() {
  const {document, window} = parseHTML('<html><body><div class="Topstory-container"><main><article id="reading" class="Card TopstoryItem--advertCard">阅读文章</article><article id="promotion" class="Card">推广活动</article></main></div></body></html>');
  window.HTMLElement.prototype.getBoundingClientRect = () => ({width: 650, height: 180});
  let config = {enabled: true, configured: true, context: '保留阅读内容'};
  let listener, mutation, timerId = 0;
  const timers = new Map(), calls = [], reports = [];
  const context = {
    document, URL,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    chrome: {runtime: {
      onMessage: {addListener(callback) { listener = callback; }},
      sendMessage(msg) {
        if (msg.type === 'configGet') return Promise.resolve({ok: true, data: {...config}});
        if (msg.type === 'statusSet') { reports.push(msg.payload); return Promise.resolve({ok: true}); }
        if (msg.type === 'classify') return new Promise(resolve => calls.push({blocks: msg.payload.blocks, resolve}));
        throw new Error(`Unexpected message ${msg.type}`);
      }
    }}
  };
  runInNewContext(blocksSource, context);
  runInNewContext(contentSource, context);
  await settle();
  const flush = async () => {
    const work = [...timers.values()]; timers.clear(); work.forEach(callback => callback()); await settle();
  };
  await flush();
  return {
    document, calls, reports, flush,
    mutate: () => mutation([]),
    change: async values => { config = {...config, ...values}; listener({type: 'configChanged'}, {}, () => {}); await settle(); await flush(); },
    answer: async (call, hide) => {
      call.resolve({ok: true, data: {results: call.blocks.map(block => ({id: block.id, hide: hide(block)}))}});
      await settle();
    },
    marked: () => Array.from(document.querySelectorAll('[data-jev-zhihu-hidden]'), node => node.id).sort()
  };
}

test('visibility follows Jev decisions, ignoring advertising class names; disabling restores DOM', async () => {
  const env = await environment();
  assert.deepEqual(env.marked(), [], 'pending blocks stay visible');
  assert.equal(env.calls[0].blocks.length, 2);
  await env.answer(env.calls[0], block => block.text === '推广活动');
  assert.deepEqual(env.marked(), ['promotion']);
  assert.ok(env.document.querySelector('#reading.TopstoryItem--advertCard'));
  await env.change({enabled: false});
  assert.deepEqual(env.marked(), []);
  assert.ok(env.document.querySelector('#promotion'), 'hide must preserve original DOM');
});

test('late classification cannot hide blocks after disable', async () => {
  const env = await environment();
  await env.change({enabled: false});
  await env.answer(env.calls[0], () => true);
  assert.deepEqual(env.marked(), []);
  assert.equal(env.calls.length, 1);
});

test('changed reading goal discards stale results and processes the new configuration', async () => {
  const env = await environment();
  await env.change({context: '新的阅读目标'});
  await env.answer(env.calls[0], () => true);
  assert.deepEqual(env.marked(), []);
  assert.equal(env.calls.length, 2, 'new configuration is classified after old request completes');
  await env.answer(env.calls[1], () => false);
  assert.deepEqual(env.marked(), []);
});

test('dynamic blocks are classified without re-requesting unchanged cards', async () => {
  const env = await environment();
  await env.answer(env.calls[0], () => false);
  const late = env.document.createElement('article'); late.className = 'Card'; late.id = 'late'; late.textContent = '新加载内容';
  env.document.querySelector('main').append(late);
  env.mutate(); env.mutate(); await env.flush();
  assert.equal(env.calls.length, 2);
  assert.equal(env.calls[1].blocks.length, 1);
  assert.equal(env.calls[1].blocks[0].text, '新加载内容');
  await env.answer(env.calls[1], () => true);
  assert.deepEqual(env.marked(), ['late']);
});

test('SPA transition into question details invalidates homepage requests and starts classification', async () => {
  const env = await environment();
  Object.defineProperty(env.document, 'location', {value: {href:'https://www.zhihu.com/question/123', pathname:'/question/123'}, configurable:true});
  const root = env.document.querySelector('.Topstory-container');
  root.className = 'QuestionPage';
  root.innerHTML = '<article class="Card" id="answer">新页面的回答</article><aside><div class="Card" id="sidebar">广告推广</div></aside>';
  env.mutate(); await env.flush(); await env.flush();
  await env.answer(env.calls[0], () => true);
  assert.deepEqual(env.marked(), []);
  assert.equal(env.calls.length, 2);
  assert.ok(env.calls[1].blocks.some(block => block.text === '新页面的回答'));
  await env.answer(env.calls[1], block => block.text === '广告推广');
  assert.deepEqual(env.marked(), ['sidebar']);
});
