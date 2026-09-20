(() => {
  const labels = Object.freeze({
    content_feed: '普通信息流', content_detail: '正文与回答', advertisement: '广告',
    event_calendar: '活动与会议', course_catalog: '课程推荐', product_catalog: '商品与购物',
    job_listing: '招聘职位', project_catalog: '项目与作品', live_stream: '直播',
    community_recommend: '社区推荐', download_resource: '下载资源', media_player: '音视频播放',
    related_content: '相关阅读', author_profile: '作者与个人资料',
    creator: '创作入口', hot_search: '热搜榜单', follow_recommend: '推荐关注',
    promotion: '推广服务', membership: '会员与订阅', account: '账户与个人中心',
    notifications: '消息通知', cookie_consent: '隐私与 Cookie 提示',
    support: '客服与帮助', site_footer: '网站页脚', navigation: '导航与工具',
    comments: '评论互动', other: '无法确定'
  });
  function create(request, describe) {
    let records = new WeakMap(), entries = new Map(), queue = [], generation = 0;
    let worker = null, active = null, failure = '', update = () => {}, sequence = 0;
    const snapshot = node => {
      const {id: ignored, ...descriptor} = describe(node);
      return {descriptor, signature: JSON.stringify(descriptor)};
    };
    const notify = () => { try { update(); } catch { /* Rendering must not invalidate model results. */ } };
    function get(node) {
      if (node?.isConnected === false) return undefined;
      const record = records.get(node);
      if (!record || record.signature !== snapshot(node).signature) return undefined;
      return record.category;
    }
    async function process() {
      while (queue.length && !failure) {
        const epoch = generation;
        const batch = queue.splice(0, 5);
        active = {epoch, count: batch.length};
        try {
          const result = await request('classifyCategories', {
            blocks: batch.map(entry => ({...entry.descriptor, id: entry.id}))
          });
          if (epoch !== generation) continue;
          const decisions = result?.results;
          if (result?.errors?.length) throw new Error(result.errors[0].error || '分类失败，请重试');
          if (!Array.isArray(decisions)) throw new Error('分类结果格式不正确，请重试');
          const byId = new Map(decisions.map(item => [item.id, item.category]));
          if (batch.some(entry => !Object.hasOwn(labels, byId.get(entry.id)))) {
            throw new Error('分类结果不完整，请重试');
          }
          for (const entry of batch) {
            entry.category = byId.get(entry.id);
            for (const node of entry.nodes) {
              const record = records.get(node);
              if (node.isConnected !== false && record?.signature === entry.signature &&
                  snapshot(node).signature === entry.signature) record.category = entry.category;
            }
            entry.nodes.clear();
          }
        } catch (error) {
          if (epoch === generation) {
            failure = error?.message || String(error);
            queue = [];
            for (const entry of entries.values()) entry.nodes.clear();
          }
        } finally {
          active = null;
          if (epoch === generation) notify();
        }
      }
    }
    function scan(nodes, onUpdate) {
      if (onUpdate) update = onUpdate;
      if (failure) return worker || Promise.resolve();
      let changed = false;
      for (const node of nodes) {
        if (node?.isConnected === false) continue;
        const {descriptor, signature} = snapshot(node);
        const previous = records.get(node);
        if (previous?.signature === signature) continue;
        if (previous) entries.get(previous.signature)?.nodes.delete(node);
        let entry = entries.get(signature);
        if (!entry) {
          entry = {descriptor, signature, id: `category-${++sequence}`, nodes: new Set()};
          entries.set(signature, entry);
          queue.push(entry);
        }
        records.set(node, {signature, category: entry.category});
        if (!entry.category) entry.nodes.add(node);
        else changed = true;
      }
      if (changed) notify();
      if (!worker && queue.length) worker = process().finally(() => { worker = null; });
      return worker || Promise.resolve();
    }
    function reset() {
      generation++;
      records = new WeakMap(); entries = new Map(); queue = []; failure = '';
      update = () => {};
    }
    return {scan, get, reset,
      get pending() { return queue.length + (active?.epoch === generation ? active.count : 0); },
      get error() { return failure; }
    };
  }
  globalThis.JevCategories = {labels, create};
})();
