import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import './i18n-support.mjs';
import './extension/manual.js';
const {scope, describeRule, describeGroupRule, matches} = globalThis.JevManual;
const documentFor = html => parseHTML(`<html><body>${html}</body></html>`).document;

test('repeated image blocks use distant region ancestor without positional selectors',()=>{
 const doc=documentFor('<main><div><img class="AdvertImg Banner-image"></div></main><aside id="rail"><div><div><img class="AdvertImg Banner-image"></div></div></aside>');
 const target=doc.querySelector('aside img'),rule=describeRule(target);
 assert.doesNotMatch(rule.selector,/:nth-/);assert.deepEqual([...matches(doc,[rule])],[target]);
});

test('split wrapper uses descendant module class without a link or stable id', () => {
  const doc = documentFor('<aside><div class="Card"><div>Hot</div></div><div class="Card"><div class="KfeCollection-CreateSaltCard"><div class="KfeCollection-CreateSaltCard-header"><svg><defs><linearGradient id="id-1978186969-a"></linearGradient></defs></svg><span>盐言作者平台</span></div><div class="KfeCollection-CreateSaltCard-button">去投稿</div></div></div></aside>');
  const module = doc.querySelector('.KfeCollection-CreateSaltCard');
  assert.equal(describeRule(module).selector, 'div.KfeCollection-CreateSaltCard');
  const wrapper = module.parentElement, rule = describeRule(wrapper);
  assert.doesNotMatch(rule.selector, /:nth-|^html|1978186969/);
  assert.match(rule.selector, /KfeCollection-CreateSaltCard/);
  doc.querySelector('aside').append(doc.querySelector('.Card'));
  module.textContent = '新的文案';
  assert.deepEqual([...matches(doc, [rule])], [wrapper]);
});

test('scopes separate sites and page types and support exact pages', () => {
  assert.equal(scope('https://www.zhihu.com/question/123/answer/456?x=1#part'), 'https://www.zhihu.com|type:/question/:id/answer/:id');
  assert.equal(scope('https://example.com/item/12345678-abcd-4321-abcd-123456789012'), 'https://example.com|type:/item/:id');
  assert.notEqual(scope('https://www.zhihu.com/'), scope('https://www.zhihu.com/question/123'));
  assert.notEqual(scope('https://example.com/question/123'), scope('https://www.zhihu.com/question/123'));
  assert.equal(scope('https://example.com/a?x=1#part', 'page'), 'https://example.com|page:/a?x=1');
  assert.equal(scope('https://example.com/a?x=1', 'site'), 'https://example.com|site');
});

test('repeated cards produce a selector for exactly the selected card', () => {
  const doc = documentFor('<main><article class="Card">first</article><article class="Card">second</article><article class="Card">third</article></main>');
  const selected = doc.querySelectorAll('article')[1];
  const rule = describeRule(selected, doc);
  assert.deepEqual([...matches(doc, [rule])], [selected]);
  assert.notEqual(rule.selector, 'article.Card');
});

test('semantic module survives changed text and neighboring insertion', () => {
  const doc = documentFor('<main><section class="reading">old title</section><aside data-testid="recommendations">old recommendations</aside></main>');
  const node = doc.querySelector('aside');
  const rule = describeRule(node, doc);
  node.textContent = 'completely different content';
  doc.querySelector('main').insertAdjacentHTML('afterbegin', '<section>new block</section>');
  assert.deepEqual([...matches(doc, [rule])], [node]);
});

test('ambiguous module class is anchored to stable parent', () => {
  const doc = documentFor('<main><div class="Card">keep</div></main><aside id="sidebar"><div class="Card">hide</div></aside>');
  const rule = describeRule(doc.querySelector('aside > div'), doc);
  assert.match(rule.selector, /sidebar/);
  assert.equal(matches(doc, [rule]).size, 1);
});

test('invalid and broad roots or extension UI never match', () => {
  const doc = documentFor('<main><section>article</section></main><div data-jev-ui><button>control</button></div>');
  assert.equal(matches(doc, [{selector: '['}, {selector:'html'}, {selector:'body'}, {selector:'[data-jev-ui]'}, {selector:'button'}]).size, 0);
  assert.equal(describeRule(doc.body, doc), null);
  assert.equal(describeRule(doc.querySelector('button'), doc), null);
});

test('generated IDs are not used and special selectors are escaped', () => {
  const doc = documentFor('<aside id="react-123456789" class="recommend:box">recommendations</aside>');
  const node = doc.querySelector('aside');
  const rule = describeRule(node, doc);
  assert.doesNotMatch(rule.selector, /react-/);
  assert.deepEqual([...matches(doc, [rule])], [node]);
});

test('CSDN article type ignores author while page and site scopes remain separate',()=>{
 const alice='https://blog.csdn.net/alice/article/details/123';
 const bob='https://blog.csdn.net/bob/article/details/456';
 assert.equal(scope(alice),'https://blog.csdn.net|type:/:author/article/details/:id');
 assert.equal(scope(alice),scope(bob));
 assert.notEqual(scope(alice,'page'),scope(bob,'page'));
 assert.notEqual(scope(alice),scope('https://www.csdn.net/'));
 assert.notEqual(scope(alice),scope('https://blog.csdn.net/alice'));
 assert.equal(scope('https://example.org/alice/article/details/123'),'https://example.org|type:/alice/article/details/:id');
});


test('split anonymous service card uses descendant entry and survives sibling reorder',()=>{
 const doc=documentFor('<aside><div class="Card"><a href="/hot">Hot</a></div><div class="Card"><div><a href="https://www.zhihu.com/creator/salt">盐言作者平台</a></div></div><div class="Card"><a href="/learn">Learn</a></div></aside>');
 const target=doc.querySelectorAll('.Card')[1],rule=describeRule(target);
 assert.ok(rule);assert.doesNotMatch(rule.selector,/:nth-|^html/);assert.match(rule.selector,/:has/);
 doc.querySelector('aside').prepend(doc.querySelectorAll('.Card')[2]);target.querySelector('a').textContent='Updated content';
 assert.deepEqual([...matches(doc,[rule])],[target]);
});

test('anonymous media wrapper uses its sidebar and survives campaign changes and reorder',()=>{
 const doc=documentFor('<main><div class="Card"><img src="/feed.jpg"></div></main><aside id="rail"><div class="Card"><span>Links</span></div><div class="Card"><img src="/campaign-123456.jpg"></div></aside>');
 const target=doc.querySelector('aside img').parentElement,rule=describeRule(target);
 assert.doesNotMatch(rule.selector,/:nth-|^html|campaign/);
 assert.match(rule.selector,/:has/);
 doc.querySelector('aside').prepend(target);
 target.querySelector('img').setAttribute('src','/new-campaign.jpg');
 assert.deepEqual([...matches(doc,[rule])],[target]);
});

test('duplicate descendant signatures are scoped to their layout region',()=>{
 const doc=documentFor('<main><div class="Card"><span class="Sponsor">Feed</span></div></main><aside id="rail"><div class="Card"><span>Links</span></div><div class="Card"><span class="Sponsor">Ad</span></div></aside>');
 const target=doc.querySelector('aside .Sponsor').parentElement,rule=describeRule(target);
 assert.doesNotMatch(rule.selector,/:nth-|^html/);
 assert.deepEqual([...matches(doc,[rule])],[target]);
});

test('indistinguishable neighboring media cards still require a positional fallback',()=>{
 const doc=documentFor('<aside><div class="Card"><img src="/one.jpg"></div><div class="Card"><img src="/two.jpg"></div></aside>');
 const rule=describeRule(doc.querySelector('.Card'));
 assert.match(rule.selector,/:nth-/);
});

const adCard = '<div class="Pc-card Card"><a class="Banner-link"><div class="AdvertImg Banner-image"><img src="/campaign.jpg"></div></a></div>';
test('on-demand group uses a stable region and structural paths through generated wrappers',()=>{
 const doc=documentFor('<main>'+adCard+'</main><div class="Topstory-container"><div class="css-bkewaf"><div class="css-18888ld">'+adCard+adCard+'</div></div></div>');
 const cards=[...doc.querySelectorAll('.Topstory-container .Pc-card')],rule=describeGroupRule(cards[0]);
 assert.ok(rule);assert.equal(rule.nodes.length,2);
 assert.doesNotMatch(rule.selector,/:nth-|css-|campaign|href|src/);
 assert.match(rule.selector,/Topstory-container/);assert.match(rule.selector,/Banner-link/);
 const parent=cards[0].parentElement;
 parent.prepend(cards[1]);parent.insertAdjacentHTML('afterbegin','<div class="Card">unrelated</div>');
 cards[0].querySelector('img').src='/replacement.jpg';cards[1].querySelector('a').setAttribute('href','/new-campaign');
 parent.className='css-newgenerated';parent.parentElement.className='css-another';
 assert.deepEqual(new Set(matches(doc,[rule])),new Set(cards));
 parent.insertAdjacentHTML('beforeend',adCard);
 assert.equal(matches(doc,[rule]).size,3);
 const reloaded=documentFor(doc.body.innerHTML);
 assert.equal(matches(reloaded,[rule]).size,3);
});

test('group rejects generic cards, bare images, unique blocks and broad multi-parent matches',()=>{
 for(const html of [
  '<aside><div class="Card"><img></div><div class="Card"><img></div></aside>',
  '<aside><img class="AdvertImg"><img class="AdvertImg"></aside>',
  '<aside>'+adCard+'</aside>',
  '<div class="Topstory-container"><div>'+adCard+adCard+'</div><div>'+adCard+adCard+'</div></div>',
  '<aside>'+adCard.repeat(21)+'</aside>'
 ]) {
  const doc=documentFor(html),target=doc.querySelector('.Pc-card,.Card,img');
  assert.equal(describeGroupRule(target),null,html);
 }
});

test('group does not combine components whose shallow structures differ',()=>{
 const doc=documentFor('<aside>'+adCard+adCard.replace('</a>','<span>other component</span></a>')+'</aside>');
 assert.equal(describeGroupRule(doc.querySelector('.Pc-card')),null);
});
