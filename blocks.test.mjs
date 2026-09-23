import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';

const source = readFileSync(new URL('./extension/blocks.js', import.meta.url), 'utf8');
function setup(body) {
  const {document} = parseHTML(`<!doctype html><html><head><base href="https://www.zhihu.com/"></head><body>${body}</body></html>`);
  const context = {URL};
  runInNewContext(source, context);
  return {document, ...context.JevZhihu};
}
const rect = () => ({width: 650, height: 180});

test('editable roots, inherited editors, and alternate contenteditable values never enter descriptors', () => {
  for (const value of ['', 'true', 'TrUe', 'plaintext-only', 'PLAINTEXT-ONLY']) {
    const {document, describe, collect} = setup(`<div class="Topstory-container"><article id="normal">Public text</article><article id="editor" contenteditable="${value}"><h2>SECRET heading</h2><div id="nested" contenteditable="invalid"><a href="https://example.com/SECRET">SECRET draft</a><img alt="SECRET" src="https://example.com/SECRET"></div></article></div>`);
    for (const id of ['editor', 'nested']) {
      const data = describe(document.getElementById(id));
      assert.equal(data.text, '');
      assert.doesNotMatch(JSON.stringify(data), /SECRET/);
      assert.equal(data.images.length + data.links.length, 0);
    }
    assert.deepEqual(Array.from(collect(document, rect), n => n.id), ['normal']);
    assert.equal(describe(document.getElementById('normal')).text, 'Public text');
  }
});

test('false and invalid contenteditable outside an editor remain readable; designMode excludes all', () => {
  const {document, describe, collect} = setup('<article contenteditable="false" id="normal">Public <span contenteditable="invalid">text</span></article>');
  assert.equal(describe(document.getElementById('normal')).text, 'Public text');
  document.designMode = 'on';
  assert.equal(describe(document.getElementById('normal')).text, '');
  assert.equal(collect(document, rect).length, 0);
});

test('computed opacity, opacity filters, and content-visibility exclude unreadable private text', () => {
  const {document, describe, collect} = setup(`<div class="Topstory-container"><article id="public">Visible <span id="transparent">OPACITY_SECRET</span><span id="filtered">FILTER_SECRET</span><span id="skipped">SKIPPED_SECRET</span></article><article id="transparent-root">ROOT_SECRET</article></div>`);
  document.defaultView.getComputedStyle = node => ({
    display: 'block', visibility: 'visible',
    opacity: node.id === 'transparent' || node.id === 'transparent-root' ? '0' : '1',
    filter: node.id === 'filtered' ? 'opacity(0)' : 'none',
    contentVisibility: node.id === 'skipped' ? 'hidden' : 'visible'
  });
  const data = describe(document.getElementById('public'));
  assert.equal(data.text, 'Visible');
  assert.doesNotMatch(JSON.stringify(data), /OPACITY_SECRET|FILTER_SECRET|SKIPPED_SECRET|ROOT_SECRET/);
  assert.deepEqual(Array.from(collect(document, rect), node => node.id), ['public']);
});

test('page-forged data-jev-ui is ordinary page content', () => {
  const {document, collect, describe} = setup('<div class="Topstory-container"><article id="forged" data-jev-ui>Visible page content</article><article id="nested">Public <span data-jev-ui>Visible marked span</span></article></div>');
  assert.deepEqual(Array.from(collect(document, rect), node => node.id), ['forged', 'nested']);
  assert.equal(describe(document.getElementById('forged')).text, 'Visible page content');
  assert.equal(describe(document.getElementById('nested')).text, 'Public Visible marked span');
});

test('registered extension UI is excluded independently of its forgeable marker', () => {
  const {document, collect, describe, registerUi} = setup('<div class="Topstory-container"><article id="reading">Public content</article><article id="owned" data-jev-ui><button>Extension control</button></article></div>');
  assert.equal(typeof registerUi, 'function');
  registerUi(document.getElementById('owned'), 'test');
  assert.deepEqual(Array.from(collect(document, rect), node => node.id), ['reading']);
  assert.equal(describe(document.getElementById('owned')).text, '');
});

test('descriptions filter original DOM CSS visibility, hidden roots, ancestors and section headings', () => {
  const {document, describe, collect} = setup(`<main><section><h3 class="css-hidden">SECRET heading</h3><article id="normal">Public <span hidden>SECRET hidden</span><span class="css-hidden"><a href="https://example.com/SECRET">SECRET CSS</a><img src="https://example.com/SECRET"></span><span style="visibility:hidden">SECRET invisible</span><span contenteditable="">SECRET draft</span></article></section><section class="css-hidden"><article id="nested">SECRET ancestor</article></section><article id="hidden" hidden>SECRET root</article></main>`);
  document.defaultView.getComputedStyle = node => {
    assert.equal(node.isConnected, true, 'computed styles must be read on the original live DOM');
    return {display: node.matches('.css-hidden') ? 'none' : node.style.display || 'block', visibility: node.style.visibility || 'visible'};
  };
  const data = describe(document.getElementById('normal'));
  assert.equal(data.text, 'Public');
  assert.doesNotMatch(JSON.stringify(data), /SECRET/);
  assert.equal(describe(document.querySelector('.css-hidden')).text, '');
  assert.equal(describe(document.getElementById('nested')).text, '');
  assert.equal(describe(document.getElementById('hidden')).text, '');
  assert.deepEqual(Array.from(collect(document, rect), n => n.id), ['normal']);
});

test('extension-hidden descriptors remain stable while private descendants are excluded', () => {
  const {document, describe, collect, setHidden} = setup('<article id="card">Public <span hidden>SECRET</span><a href="https://example.com/read?q=SECRET#SECRET">link</a><img src="https://example.com/image?q=SECRET#SECRET"></article>');
  document.defaultView.getComputedStyle = node => ({display: node.matches('[data-jev-zhihu-hidden],[data-jev-manual-hidden],[data-jev-preview-hide]') ? 'none' : 'block', visibility: 'visible'});
  const card = document.getElementById('card'), before = JSON.stringify(describe(card));
  for (const attribute of ['data-jev-zhihu-hidden', 'data-jev-manual-hidden', 'data-jev-preview-hide']) {
    setHidden(card, attribute, true);
    assert.equal(JSON.stringify(describe(card)), before);
    assert.equal(collect(document, rect)[0], card);
    setHidden(card, attribute, false);
  }
  assert.doesNotMatch(before, /SECRET/);
});

test('page-forged extension hide markers cannot reveal CSS-hidden private text or media', () => {
  for(const attribute of ['data-jev-zhihu-hidden','data-jev-manual-hidden','data-jev-preview-hide']) {
    const {document,describe,setHidden}=setup(`<article id="card">Public <div ${attribute} style="display:none">SECRET<a href="https://example.com/SECRET">link</a><img alt="SECRET" src="https://example.com/SECRET"></div></article>`);
    document.defaultView.getComputedStyle=node=>({display:node.style.display||'block',visibility:'visible'});
    const card=document.getElementById('card'), child=card.querySelector('div');
    assert.equal(describe(card).text,'Public');
    assert.doesNotMatch(JSON.stringify(describe(card)),/SECRET/);
    assert.equal(describe(child).text,'');
    setHidden(card,attribute,true);
    assert.doesNotMatch(JSON.stringify(describe(card)),/SECRET/,'ownership of parent does not grant child ownership');
    setHidden(card,attribute,false);
    card.setAttribute(attribute,'');card.style.display='none';
    assert.equal(describe(card).text,'','removed ownership cannot be recovered by forging the attribute');
  }
});

test('setHidden preserves pre-existing or page-modified attribute values', () => {
  for (const attribute of ['data-jev-zhihu-hidden', 'data-jev-manual-hidden', 'data-jev-preview-hide']) {
    const {document, setHidden} = setup(`<article id="card" ${attribute}="page-owned"></article>`);
    const card = document.getElementById('card');
    setHidden(card, attribute, false);
    assert.equal(card.getAttribute(attribute), 'page-owned', `${attribute} is not owned by the extension`);
    setHidden(card, attribute, true);
    setHidden(card, attribute, false);
    assert.equal(card.getAttribute(attribute), 'page-owned', 'disabling must preserve the original value');
    card.removeAttribute(attribute);
    setHidden(card, attribute, true);
    assert.equal(card.getAttribute(attribute), '');
    card.setAttribute(attribute, 'page-modified');
    setHidden(card, attribute, false);
    assert.equal(card.getAttribute(attribute), 'page-modified', 'page changes made while active are preserved');
  }
});

test('a collapsed hidden child does not promote its parent into a replacement candidate',()=>{
 const {document,collect}=setup('<div class="Topstory-container"><div id="wrapper">Heading<div id="hidden" data-jev-manual-hidden><a href="/ad">Ad</a></div><div id="visible"><a href="/read">Reading</a></div></div></div>');
 const nodes=collect(document,node=>node.closest('[data-jev-manual-hidden]')?{width:0,height:0}:rect());
 assert.deepEqual(Array.from(nodes,n=>n.id).sort(),['hidden','visible']);
});

test('an image-free iframe advert remains a selectable block', () => {
  const {document, collect} = setup('<div class="Topstory-container"><div id="embed"><iframe src="https://ads.example/frame"></iframe></div></div>');
  assert.deepEqual(Array.from(collect(document,rect), node=>node.id), ['embed']);
});

test('extracts feed cards, image banner and footer individually without classifying layout wrappers', () => {
  const {document, collect} = setup(`<div class="Topstory-container"><main id="main">
    <div id="banner"><a href="/campaign"><img alt="校园活动" src="https://pic.example/banner.png"></a></div>
    <div id="feed"><article id="a" class="Card">问题一</article><article id="b" class="Card">问题二</article></div>
    </main><aside id="sidebar"><section id="follow" class="Card">推荐关注</section><footer id="footer">关于知乎 举报中心</footer></aside>
    </div><article id="outside">页面外内容</article>`);
  assert.deepEqual(Array.from(collect(document, rect), node => node.id).sort(), ['a', 'b', 'banner', 'follow', 'footer']);
  assert.equal(document.querySelector('[data-jev-zhihu-hidden]'), null);
});

test('ad and creator class names remain candidates and never cause local hiding', () => {
  const {document, collect} = setup('<div class="Topstory-container"><article id="ad" class="TopstoryItem--advertCard">普通阅读内容</article><section id="creator" class="Card CreatorEntrance">问题讨论</section></div>');
  assert.deepEqual(Array.from(collect(document, rect), node => node.id), ['ad', 'creator']);
  assert.equal(document.querySelector('[data-jev-zhihu-hidden]'), null);
});

test('descriptions omit input and editable text and strip URL queries and fragments', () => {
  const {document, describe} = setup(`<article id="card"><h2>可读标题</h2><input value="INPUT_SECRET"><textarea>TEXT_SECRET</textarea>
    <div contenteditable="true">EDIT_SECRET<a href="https://example.com/EDIT_SECRET">draft</a><img src="https://example.com/EDIT_SECRET.png"></div><script>SCRIPT_SECRET</script>
    <a href="https://www.zhihu.com/question/123?token=LINK_SECRET#private">问题</a>
    <img alt="图片说明" src="https://pic.example/image.png?token=IMAGE_SECRET#private"></article>`);
  const data = describe(document.querySelector('#card'));
  assert.match(data.text, /可读标题/);
  assert.doesNotMatch(JSON.stringify(data), /SECRET|private/);
  assert.deepEqual(Array.from(data.links), ['https://www.zhihu.com/question/123']);
  assert.equal(data.images[0].src, 'https://pic.example/image.png');
  assert.match(data.images[0].alt, /图片说明/);
});

test('hidden blocks remain tracked when their layout parent collapses', () => {
  const {document, collect} = setup('<div class="Topstory-container"><aside><section id="hidden" class="Card" data-jev-zhihu-hidden>推广</section></aside></div>');
  assert.deepEqual(Array.from(collect(document, () => ({width: 0, height: 0})), n => n.id), ['hidden']);
});

test('iframe descriptions include embed evidence without query tokens or editable content', () => {
  const {document, describe} = setup('<div id="embed"><iframe title="Sponsored placement" src="https://ads.example/placement?token=SECRET#SECRET"></iframe><div contenteditable="true"><iframe src="https://draft.example/SECRET"></iframe></div></div>');
  const data = describe(document.querySelector('#embed'));
  assert.match(data.structural, /IFRAME Sponsored placement https:\/\/ads.example\/placement/);
  assert.doesNotMatch(JSON.stringify(data), /SECRET/);
  assert.match(describe(document.querySelector('iframe')).structural, /IFRAME Sponsored placement/);
  assert.ok(data.structural.length <= 1500);
});

test('manually hidden blocks remain tracked when their layout parent collapses', () => {
  const {document, collect} = setup('<div class="Topstory-container"><aside><section id="hidden" class="Card" data-jev-manual-hidden>推广</section></aside></div>');
  assert.deepEqual(Array.from(collect(document, () => ({width: 0, height: 0})), n => n.id), ['hidden']);
});

test('hidden floating blocks outside the reading root stay tracked without collecting extension UI', () => {
  const {document, collect, registerUi} = setup(`<div class="Topstory-container"><article id="reading">Article</article></div>
    <div><div id="manual" style="position:fixed" data-jev-manual-hidden><button>Help</button></div></div>
    <div id="classified" style="position:fixed" data-jev-zhihu-hidden>Promotion</div>
    <div data-jev-ui><div id="ui" style="position:fixed" data-jev-manual-hidden>Controls</div></div>`);
  registerUi(document.querySelector('[data-jev-ui]'), 'fixture');
  document.defaultView.getComputedStyle = n => ({position: n.style.position || 'static'});
  const measure = n => n.closest('[data-jev-manual-hidden], [data-jev-zhihu-hidden]') ? {width: 0, height: 0} : rect();
  assert.deepEqual(Array.from(collect(document, measure), n => n.id).sort(), ['classified', 'manual', 'reading']);
});

test('question details split answers, adverts and sidebar without selecting answer-list wrapper', () => {
  const {document, collect} = setup(`<div class="QuestionPage"><div><section id="question">问题标题和描述</section></div>
    <main><div class="Card" id="answer">当前回答正文和操作</div><div id="ad">广告</div>
    <div class="Card MoreAnswers" id="group"><div><div class="List-item" id="answer2">回答二</div><div class="List-item" id="answer3">回答三</div></div></div></main>
    <aside><div class="Card" id="author">作者介绍</div><footer id="footer">关于网站</footer></aside></div>
    <div data-jev-ui>操作台</div>`);
  const nodes = collect(document, rect);
  assert.deepEqual(Array.from(nodes, n => n.id).filter(Boolean).sort(), ['ad','answer','answer2','answer3','author','footer','question']);
  assert.ok(nodes.some(n => n.textContent === '问题标题和描述'));
  assert.ok(!nodes.some(n => n.id === 'group'));
});


test('generic single-child layout wrappers expose nested columns and modules', () => {
  const {document,collect}=setup(`<div><div><main><div><div><div id="banner"><a><img alt="banner"></a></div><div><div><div id="news">News card</div><div id="project">Project card</div></div><div><div id="advert"><iframe></iframe></div><div id="community">Community recommendations</div><div id="live">Live events</div></div></div></div></div></main></div></div>`);
  assert.deepEqual(Array.from(collect(document,rect),n=>n.id).sort(),['advert','banner','community','live','news','project']);
});


test('generic repeated cards and linked tiles retain text and thumbnail together', () => {
 const {document,collect}=setup('<div><div><div class="entry" id="one"><a href="/1">Author and title</a><div><p>Summary</p><img></div></div><div class="entry" id="two"><a href="/2">Title two</a><p>Summary two</p></div></div><div><a href="/3" id="tile"><img><p>News title</p></a><div id="ad"><iframe></iframe></div></div></div>');
 assert.deepEqual(Array.from(collect(document,rect),n=>n.id).sort(),['ad','one','tile','two']);
});


test('descriptors include nearest section heading without borrowing other column headings', () => {
 const {document,describe}=setup('<main><div><h3>活动日历</h3><div><div id="event">9月23日 技术大会 苏州</div></div></div><div><h3>精品课程</h3><div id="course">Java之路 VIP 共4节</div></div><div id="article">普通文章</div></main>');
 assert.match(describe(document.querySelector('#event')).structural,/Section 活动日历/);
 assert.match(describe(document.querySelector('#course')).structural,/Section 精品课程/);
 assert.doesNotMatch(describe(document.querySelector('#article')).structural,/活动日历|精品课程/);
});

test('context captures semantic landmarks without editable heading content or sibling text', () => {
 const {document,describe}=setup('<main><article id="main">Article</article></main><aside role="complementary"><section><h3>推荐社区 <span contenteditable="true">DRAFT_SECRET</span></h3><div id="community">开发者社区</div><div>NEIGHBOR_PRIVATE_TEXT</div></section></aside>');
 const main=describe(document.querySelector('#main')), side=describe(document.querySelector('#community'));
 assert.match(main.structural,/Regions MAIN/);
 assert.match(side.structural,/ASIDE role=complementary/);
 assert.match(side.structural,/Section 推荐社区/);
 assert.doesNotMatch(JSON.stringify(side),/DRAFT_SECRET|NEIGHBOR_PRIVATE_TEXT/);
 assert.ok(side.structural.length<=1500);
});


test('narrow fixed toolbar outside reading root and zero-size wrapper is selectable',()=>{
 const {document,collect}=setup('<div class="Topstory-container"><article id="reading">Article</article></div><div id="zero"><div id="tools" style="position:fixed"><button>Help</button></div></div>');
 document.defaultView.getComputedStyle=n=>({position:n.style.position||'static'});
 const measure=n=>n.id==='zero'?{width:0,height:0}:n.id==='tools'?{width:44,height:220}:rect();
 assert.ok(collect(document,measure).some(n=>n.id==='tools'));
});

test('floating discovery skips descendants of already collected reading blocks',()=>{
 const {document,collect}=setup('<div class="Topstory-container">'+Array.from({length:50},(_,i)=>`<article id="card${i}">${'<p><span>Reading</span></p>'.repeat(30)}</article>`).join('')+'</div>');
 let containmentChecks=0;
 for(const article of document.querySelectorAll('article')){const contains=article.contains.bind(article);article.contains=node=>{containmentChecks++;return contains(node);};}
 assert.equal(collect(document,rect).length,50);
 assert.equal(containmentChecks,0,'floating discovery must prune known blocks instead of checking every descendant against them');
});
