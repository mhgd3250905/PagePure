import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import './extension/manual.js';
import './extension/layout-snapshot.js';
const {key, region, matchRegion} = globalThis.JevLayoutSnapshot;
const documentFor = html => parseHTML(`<html><body>${html}</body></html>`).document;

test('automatic region discovery bounds selector queries and leaves manual fallback available', () => {
  const doc = documentFor('<main class="Main Shell"><section class="Feed List"><article class="Card Item"><a href="/first">One</a></article><article class="Card Item"><a href="/second">Two</a></article></section></main>');
  const node = doc.querySelector('article'), query = doc.querySelectorAll.bind(doc);
  const selectors = [];
  doc.querySelectorAll = selector => {selectors.push(selector); return query(selector);};
  Object.defineProperty(node, 'innerText', {get() {throw new Error('Snapshot must not read rendered text');}, configurable:true});
  assert.equal(region(node), null);
  assert.ok(selectors.length <= 24, `queries: ${selectors.length}`);
  assert.ok(selectors.every(selector => !/:has|:nth/.test(selector)));
  delete node.innerText;
  const rule = globalThis.JevManual.describeRule(node, doc);
  assert.ok(rule);
  assert.deepEqual([...query(rule.selector)], [node]);
});

test('layout keys survive replaced text, links and image sources', () => {
  const doc = documentFor('<main class="Main"><article class="FeedCard"><a href="/old">Old title</a><img src="old.png"></article></main>');
  const node = doc.querySelector('article'), before = key(node);
  assert.ok(before);
  node.querySelector('a').textContent = 'Entirely different title and length';
  node.querySelector('a').setAttribute('href', '/new');
  node.querySelector('img').setAttribute('src', 'new.png');
  assert.equal(key(node), before);
});

test('advertisement semantic structure differs from ordinary content', () => {
  const doc = documentFor('<main><article class="Card"><div class="ContentItem"><a>Article</a></div></article><article class="Card"><div class="Advertisement"><a>Article</a></div></article></main>');
  const cards = doc.querySelectorAll('article');
  assert.notEqual(key(cards[0]), key(cards[1]));
});

test('bare tags cannot form a reusable layout key', () => {
  const doc = documentFor('<main><div><span>Text</span><a href="/anything">Link</a></div></main>');
  assert.equal(key(doc.querySelector('div')), '');
});

test('ancestor regions isolate otherwise identical cards', () => {
  const doc = documentFor('<main class="Feed"><div class="Card"><a>Text</a></div></main><aside class="Sidebar"><div class="Card"><a>Text</a></div></aside>');
  const cards = doc.querySelectorAll('.Card');
  assert.notEqual(key(cards[0]), key(cards[1]));
});

test('repeated children and extension UI do not change the key', () => {
  const doc = documentFor('<main><div class="Feed"><article class="Card"><a>One</a></article></div></main>');
  const node = doc.querySelector('.Feed'), before = key(node);
  node.append(node.firstElementChild.cloneNode(true));
  const ui = doc.createElement('div'); ui.setAttribute('data-jev-ui', ''); ui.innerHTML = '<span class="Toolbar">Controls</span>'; node.append(ui);
  assert.equal(key(node), before);
  assert.equal(key(ui), '');
});

test('page region survives answer hydration, counters and surrounding wrappers', () => {
  const doc = documentFor('<main><article class="AnswerCard"><h1>Old title</h1><span>12 votes</span></article></main>');
  const node = doc.querySelector('article'), snapshot = region(node);
  assert.ok(snapshot);
  node.innerHTML = '<header><h1>New title</h1><span>1234 votes</span></header><div class="RichContent"><img src="new.png"><p>Loaded answer</p></div>';
  const wrapper = doc.createElement('section'); wrapper.className = 'HydratedWrapper';
  node.parentElement.append(wrapper); wrapper.append(node);
  assert.deepEqual(region(node), snapshot);
  assert.equal(matchRegion(node, snapshot.identity), true);
  node.className = 'Advertisement';
  assert.equal(matchRegion(node, snapshot.identity), false);
});

test('page region rejects anonymous dynamic elements and positional selectors', () => {
  const doc = documentFor('<main><div><a href="/service">Link</a></div><article class="Card">One</article><article class="Card">Two</article></main>');
  assert.equal(region(doc.querySelector('div')), null);
  for (const node of doc.querySelectorAll('.Card')) assert.equal(region(node), null);
  assert.equal(matchRegion(doc.querySelector('div'), ''), false);
});

test('page regions accept stable own data attributes, roles and IDs', () => {
  for (const attribute of ['data-testid="answer"', 'data-test="answer"', 'data-component="answer"', 'role="article"', 'id="answer"']) {
    const doc = documentFor(`<main><div ${attribute}>Answer</div></main>`);
    const node = doc.querySelector('div'), snapshot = region(node);
    assert.ok(snapshot, attribute);
    assert.equal(matchRegion(node, snapshot.identity), true);
  }
});

test('page regions reject descendant and href anchors for duplicate semantic cards', () => {
  const doc = documentFor('<main><article class="Card"><a href="/first">One</a></article><article class="Card"><a href="/second">Two</a></article></main>');
  for (const node of doc.querySelectorAll('.Card')) assert.equal(region(node), null);
});
