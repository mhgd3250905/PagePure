import test from 'node:test';
import assert from 'node:assert/strict';
import './extension/categories.js';

const node = text => ({text, isConnected: true});
const describe = node => ({text: node.text});
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
const response = (blocks, category = 'content_feed') => ({results: blocks.map(({id}) => ({id,category}))});

test('semantic categories group different articles and distinguish advertisements with model decisions', async () => {
  const calls = [];
  const engine = JevCategories.create(async (type, {blocks}) => {
    calls.push({type, blocks});
    return {results: blocks.map(({id,text}) => ({id,category: text === 'sponsored' ? 'advertisement' : 'content_feed'}))};
  }, describe);
  const nodes = ['sports', 'technology', 'sponsored', 'sports'].map(node);
  await engine.scan(nodes);
  assert.deepEqual(nodes.map(engine.get), ['content_feed','content_feed','advertisement','content_feed']);
  assert.equal(calls[0].type, 'classifyCategories');
  assert.equal(calls[0].blocks.length, 3);
  const later = node('sports');
  await engine.scan([later]);
  assert.equal(engine.get(later), 'content_feed');
  assert.equal(calls.length, 1);
});

test('sequential batches include later nodes without overlapping requests', async () => {
  let concurrent = 0, maximum = 0;
  const sizes = [], first = deferred();
  const engine = JevCategories.create(async (_, {blocks}) => {
    maximum = Math.max(maximum, ++concurrent); sizes.push(blocks.length);
    if (sizes.length === 1) await first.promise;
    concurrent--; return response(blocks);
  }, describe);
  const nodes = Array.from({length: 8}, (_,i) => node(String(i)));
  const pending = engine.scan(nodes);
  const late = node('late'); engine.scan([late]);
  assert.equal(engine.pending, 9);
  first.resolve(); await pending;
  assert.deepEqual(sizes, [5,4]); assert.equal(maximum, 1);
  assert.equal(engine.get(late), 'content_feed'); assert.equal(engine.pending, 0);
});

test('changed and disconnected nodes never receive stale classifications', async () => {
  const first = deferred(); let count = 0;
  const engine = JevCategories.create(async (_, {blocks}) => {
    if (++count === 1) await first.promise;
    return response(blocks, blocks[0].text === 'old' ? 'content_feed' : 'advertisement');
  }, describe);
  const original = node('old'), removed = node('old');
  const done = engine.scan([original, removed]);
  original.text = 'new'; removed.isConnected = false;
  engine.scan([original]); first.resolve(); await done;
  assert.equal(engine.get(original), 'advertisement'); assert.equal(engine.get(removed), undefined);
  original.text = 'changed again'; assert.equal(engine.get(original), undefined);
});

test('reset invalidates in-flight results while processing new work sequentially', async () => {
  const first = deferred(); let count = 0, oldUpdates = 0;
  const engine = JevCategories.create(async (_, {blocks}) => {
    if (++count === 1) await first.promise;
    return response(blocks, count === 1 ? 'advertisement' : 'content_feed');
  }, describe);
  const old = node('same'); const done = engine.scan([old], () => oldUpdates++);
  engine.reset(); const fresh = node('same'); engine.scan([fresh]);
  first.resolve(); await done;
  assert.equal(engine.get(old), undefined); assert.equal(engine.get(fresh), 'content_feed');
  assert.equal(oldUpdates, 0); assert.equal(count, 2);
});

test('errors leave unknown blocks visible and stop retries until reset', async () => {
  let count = 0;
  const engine = JevCategories.create(async (_, {blocks}) => {
    if (++count === 1) throw new Error('network offline');
    return response(blocks, 'other');
  }, describe);
  const sample = node('article'); await engine.scan([sample]);
  assert.equal(engine.get(sample), undefined); assert.equal(engine.error, 'network offline');
  await engine.scan([sample, node('new')]); assert.equal(count, 1); assert.equal(engine.pending, 0);
  engine.reset(); await engine.scan([sample]);
  assert.equal(engine.get(sample), 'other'); assert.equal(engine.error, '');
});

test('backend per-block errors and incomplete results cannot become hidden categories', async () => {
  for (const result of [
    {results: [], errors: [{id: 'category-1', error: 'model unavailable'}]},
    {results: [{id: 'category-1', category: 'unsupported_category'}], errors: []},
    {results: [], errors: []}
  ]) {
    const engine = JevCategories.create(async () => result, describe);
    const sample = node('article');
    await engine.scan([sample]);
    assert.equal(engine.get(sample), undefined);
    assert.ok(engine.error);
    assert.equal(engine.pending, 0);
  }
});


test('frontend and model share the expanded reusable taxonomy', async () => {
 const {CATEGORY_LABELS,classifyCategory}=await import('./extension/classifier.mjs');
 assert.deepEqual(JevCategories.labels,CATEGORY_LABELS);
 assert.ok(Object.keys(CATEGORY_LABELS).length>=25);
 for(const category of ['product_catalog','job_listing','project_catalog','live_stream','community_recommend','download_resource','account','cookie_consent']) {
   const answer=await classifyCategory({id:category,text:'sample',structural:'Regions ASIDE'},'test',async (_,options)=>{
     const body=JSON.parse(options.body);
     assert.deepEqual(Object.keys(body.questions.category.criteria).sort(),Object.keys(CATEGORY_LABELS).sort());
     assert.equal(body.state.block.structural,'Regions ASIDE');
     assert.match(body.questions.category.instructions,/主内容\/侧栏/);
     return {ok:true,json:async()=>({answers:{category:{type:'choice',choice:category,confidence:.99,probabilities:Object.fromEntries(Object.keys(CATEGORY_LABELS).map(key=>[key,key===category?1:0]))}}})};
   });
   assert.equal(answer.category,category);
 }
});
