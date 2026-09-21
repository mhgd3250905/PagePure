# 网页净化助手 PagePure 商店发布指南（Edge Add-ons）

## 发布状态台账

| 市场 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| Edge Add-ons | ✅ 已提交审核（In review） | 2026-09-20 | v0.6.24；微软口径 7 个工作日内反馈；结果邮件发 sk18101652104@outlook.com |
| Chrome Web Store | ⏳ 未计划 | — | 全站 host_permissions + 广告屏蔽类功能在 Chrome 审核更严，暂不提交 |

**发布账号（Edge）**：复用 Jev 邮件助手已注册的 Microsoft 个人账户 `sk18101652104@outlook.com`；开发者发布者名 `Bboyugk`（中国区 / Individual）。Partner Center：https://partner.microsoft.com/dashboard/microsoftedge/overview 。同一账号可发布多个扩展，无需重新注册。

**已提交信息快照（Edge v0.6.24，2026-09-20）**：
- 类别：高效工作（Productivity）；可见性：公用（Public）；语言：English (United States)
- 商店名称（锁定自 manifest）：网页净化助手 · PagePure；商店描述：英文版（功能/隐私/安装三节，存于 Partner Center 提交记录与本文档第二节）
- 商店 logo：`extension/icons/pagepure-256.png`（256×256）
- 截图：`assets/store/screenshot-select.png`、`screenshot-clean.png`（1280×800，取自 demo.html 演示页，无隐私内容）
- 隐私政策：https://gist.github.com/mhgd3250905/3ff8cf844b63c9379e105d5d3e7026a4 （中英双语）
- 数据披露：勾选 Website content（网站内容）；三项证明全部勾选；权限理由与远程代码声明见第三节
- 认证说明：已说明手动功能免密钥可用、BYOK 模式及逐按钮测试步骤（存于提交记录）
- Microsoft Store ID：`0RDCKDS5H0H3`；CRX ID：`ijiaoneehjiebocilhnbmkoohlleaeen`；产品 ID：`647794d8-17b4-4ca3-954f-ecd211d3b985`
- 审核通过后待办：把商店链接回填本文档台账和 README.md

**发布经验来源**：`E:\AII-Jev\0919\STORE_PUBLISH.md`（Jev 邮件助手已于 2026-09-20 用同一账号成功提审）。

## 0.6.32 本地更新

按用户要求移除类别净化系列，仅保留区域规则操作及显式智能拆分；旧类别规则停用。交付 `PagePure-0.6.32.zip`，2026-09-21用户确认实测通过；尚未提交商店。下方0.6.24文案为历史提审材料，不代表当前功能。

### 0.6.32 后续更新文案（草稿，未提交）

简短描述：

> Select a page region, adjust its size, and hide or restore it. Save site or page rules; optional AI splitting uses your own key.

版本说明：

> Removed category-wide hiding and category correction. Region selection, expand/shrink, hide/restore, page exceptions, preview, undo, and explicit smart splitting remain available. Existing region rules are preserved; legacy category rules are inactive. Improved compatibility with Twinkstar Browser.

后续更新须同步商店截图和功能说明，移除“27 categories”“similar-block classification”和类别快照快速恢复宣传。普通AI自动判断与显式智能拆分仍为可选功能，因此不能沿用旧权限文案中“never uploads page content to any server”的绝对表述；应说明用户启用AI时会向TypeSafe发送处理所需的模块信息。这里仅记录文档对齐，不修改已提交材料或外部隐私政策。

## 0.6.31 本地更新

修复星愿浏览器缺失可选存储API导致后台启动失败。真实星愿浏览器验证设置读取及无密钥手动选择；交付 `PagePure-0.6.31.zip`，尚未提交商店。

## 0.6.30 本地更新

操作台初始化增加超时反馈与重新连接，状态轮询避免重叠；交付 `PagePure-0.6.30.zip`，尚未提交商店。

## 0.6.29 本地更新

基于真实性能记录修复自动快照定位热点，保留手动选区完整定位。交付 `PagePure-0.6.29.zip`，尚未提交商店。

## 0.6.28 本地更新

减少净化重复扫描与选区滚动定位开销；交付 `PagePure-0.6.28.zip`，尚未提交商店。

## 0.6.27 本地更新

新增独立净化规则管理页，支持按地址搜索与单选/多选清理；交付 `PagePure-0.6.27.zip`，尚未提交商店。

## 0.6.26 本地更新

恢复默认可见的“智能拆分”，交付 `PagePure-0.6.26.zip`；尚未提交商店。

## 0.6.25 本地更新

2026-09-20：紧凑分组操作条已完成，本地交付 `PagePure-0.6.25.zip`，尚未提交 Edge 商店。下方 0.6.24 包和截图属于已提审材料，不代表当前 0.6.25 源码；后续商店更新需使用新版包并更新界面截图。

## 发布材料（0.6.24 已提审）

| 材料 | 文件/内容 | 状态 |
| --- | --- | --- |
| 发布包 | `PagePure-0.6.24-store.zip`（根目录即 `manifest.json`，21 个文件，108KB，与提审时 `extension/` 一致，不含密钥） | ✅ |
| 商店 logo | `extension/icons/pagepure-256.png`（256×256，从 `assets/pagepure-icon-source.png` 缩放） | ✅ |
| 截图 1 | `assets/store/screenshot-select.png`（1280×800，点选广告：遮罩+净化盖章+快捷工具条） | ✅ |
| 截图 2 | `assets/store/screenshot-clean.png`（1280×800，保存后广告消失的干净页面） | ✅ |
| 隐私政策 URL | https://gist.github.com/mhgd3250905/3ff8cf844b63c9379e105d5d3e7026a4 （中英双语） | ✅ |

备注：
- 0.6.24 的历史包 `PagePure-0.6.24.zip`（1.86MB）含两张 906KB 图标源图，仅作历史产物保留；商店提交一律使用精简后的 `-store` 包。
- 截图取自 `demo.html` 演示页（模拟分类结果，不含真实用户数据，无脱敏问题）。
- 备选 UI 图：`output/playwright/ui-0.6.22.png`、`ui-expanded-0.6.22.png`（1000×720，操作台面板）。

## 商店文案（0.6.24 历史提审材料）

### 名称（≤45 字符）

```
PagePure 网页净化助手 - 点击隐藏网页干扰模块
```

英文版（提交语言为 English (United States) 时使用）：

```
PagePure - Click to Clean Any Web Page
```

### 简短描述（≤132 字符）

英文版：

```
Click any ad or distracting module to hide it and keep it hidden. Manual selection works with no account; AI similar-block search optional.
```

### 详细描述

英文版：

```
PagePure cleans distracting web pages: click a module, preview, save — the page stays clean on every visit.

Core features
• Click any block (ads, promotions, follow cards, footers) to hide it — no CSS or DOM knowledge needed
• Preview with a frosted-glass mask and "purified" stamp before saving
• Rules are saved per site, page type or exact URL, and re-applied automatically
• Page-level exceptions: hide everywhere except this page, or hide only on this page
• Fast restore: recognized regions reappear instantly on your next visit, without waiting for AI
• Undo the last save and temporarily view the original page at any time
• Manual selection works fully offline with no account and no API key

Smart similar-block classification (BYOK)
• Add your own TypeSafe (Jev) API key and the AI finds every similar module for you across 27 built-in categories (ads, promotions, feeds, footers and more)
• Correct a wrong guess once and the correction is remembered for that stable structure
• Your key stays in your browser's local extension storage — never synced, never displayed
• Calls go to the official TypeSafe API (api.typesafe.ai) with your own account and quota

Privacy
• When AI is enabled, only module text, image alt descriptions, structure hints and link paths (query strings removed) are sent to the TypeSafe official API
• Never sends full page HTML, cookies, browsing history, form input, or cross-origin iframe content
• No ads, no analytics, no tracking, no data selling

Get a TypeSafe API key at https://console.typesafe.ai/ (optional — manual selection works without one).
```

### 版本说明（首次发布）

```
First release: click-to-hide with preview, per-site / page-type / URL rules, page exceptions, snapshot fast restore, undo, and optional AI similar-block classification with your own Jev key.
```

### 类别与语言

- 类别：Productivity（生产力工具）
- 可见性：Public
- 语言：English (United States)（与 0919 提交口径一致）

## Edge Partner Center 提交步骤（0.6.24 历史操作记录）

1. 用 `sk18101652104@outlook.com` 打开 https://partner.microsoft.com/dashboard/microsoftedge/overview 。
2. 「Create new extension」→ 上传 `PagePure-0.6.24-store.zip`。
3. Store listing：粘贴上文英文文案；上传 `extension/icons/pagepure-256.png` 为商店 logo；上传两张截图；Website URL 可填隐私政策 gist；Support email 填账户邮箱。
4. Privacy policy URL：https://gist.github.com/mhgd3250905/3ff8cf844b63c9379e105d5d3e7026a4
5. 审核重点——权限与数据披露：
   - **权限说明 `storage`**：`Saves the user's purification rules, region snapshots, undo records, page preferences, and locally stored API key on this device only.`
   - **权限说明 host permissions（http/https）**：`Used to show the selection UI on pages the user visits, apply the user's saved purification rules, and restore hidden regions. Everything runs locally in the page context; the extension never uploads page content to any server.`
   - **数据披露**：勾选 Website content（读取模块可见文本用于可选的类别判断）；用途选 Provide the product's core functionality；声明不出售、不转移数据、不用于无关用途、不用于信用评估。不勾选 Personal communications、Financial information 等其他项。
   - **认证备注**：`Manual block selection and all rule features work without any account or API key. The optional AI classification is BYOK: the reviewer can test it by entering their own TypeSafe API key (https://console.typesafe.ai/) and enabling AI for the site; without a key the extension simply skips AI classification.`
6. 提交审核（微软口径约 7 个工作日内反馈；结果邮件发账户邮箱）。

**提交后待办**：把审核状态与商店链接回填本文档台账和 README.md。

## 后续版本更新

改 `extension/manifest.json` 的 `version` → `python` 重新打包（根目录即 `manifest.json`，参考本文档材料清单）→ 在 Partner Center 该扩展下「Update」上传新 zip 并更新版本说明。
