# 网页净化助手 PagePure 商店发布指南（Edge Add-ons）

## GitHub 下载（当前公开分发）

仓库：<https://github.com/mhgd3250905/PagePure>。台账最后记录的 GitHub Release 是 [v0.7.5](https://github.com/mhgd3250905/PagePure/releases/tag/v0.7.5)，已发布安装包 SHA-256 为 `062729f66ba68e18b384f2fb109e73d957385b8e6a0311062f8d273059acdbA0`。2026-09-23 的审查修复已打包为 0.7.6 并提交 Chrome/Edge 商店（Chrome 当天过审上架、Edge 审核中，见下方台账），但 **GitHub Release 尚未发布**，v0.7.5 仍是 GitHub 当前公开安装包。GitHub 分发与商店审核相互独立。

## 发布状态台账

| 市场 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| Edge Add-ons | ✅ 已发布（Live，最后观察） | 2026-09-23 | **v0.7.5** 已过审上架（Partner Center 扩展概述当日显示“版本 0.7.5 — Live”）；商店链接 https://microsoftedge.microsoft.com/addons/detail/ijiaoneehjiebocilhnbmkoohlleaeen |
| Edge Add-ons | 🕐 正在审阅（In review，最后观察） | 2026-09-23 | **v0.7.6** 当天提审（包 `PagePure-0.7.6.zip`，39 文件，190,414 字节，SHA-256 `47efcbfb…e0c3d5`；与 Chrome 候选包同一份，逐字节一致）；权限与 0.7.5 相同；一览沿用英语/中文(台湾)/中文(中国) 3 套，包内新识别的其余 9 语言一览已移除；认证说明沿用历史口径并追加 0.7.6 变化；后台显示“正在审阅”，微软口径约 7 个工作日 |
| Chrome Web Store | ✅ 已上架（Live，用户确认） | 2026-09-23 | **v0.7.6** 审核通过并公开发布（用户当日确认）；详情页需登录会话才可稳定访问，公开搜索暂未返回结果；商品 ID `hfadgbminekfilodfjdpbllimaemlhdb`；公开商品 URL 待回填 |

**Edge 更新流程经验（2026-09-21 实测）**：扩展处于“正在审阅”时无法发布更新（会提示“你的扩展正在审核中”）。若旧提交尚未发布过，可走「扩展概述 → 取消提交」（取消需 5–10 分钟生效），随后草稿上会出现「发布」按钮，补填认证说明后即可送审。

**发布账号（Edge）**：复用 Jev 邮件助手已注册的 Microsoft 个人账户 `sk18101652104@outlook.com`；开发者发布者名 `Bboyugk`（中国区 / Individual）。Partner Center：https://partner.microsoft.com/dashboard/microsoftedge/overview 。同一账号可发布多个扩展，无需重新注册。

本地隐私政策 `assets/store/privacy-policy.md` 于 2026-09-23 更新，补充用户自定义阅读需求、Bearer API Key、TypeSafe 服务处理/遥测边界及 CWS Limited Use 明确声明；公开 Gist 已于 2026-09-23 10:55:33Z 更新，7,961 字节并经原始 URL 与本地文件逐字核对一致。文案已将普通分类与智能拆分发送字段区分。中文视频由真实 `demo.html` 手动交互状态截图制作，标注为非 AI 演示，已上传 YouTube 并设为“不公开列出”：<https://youtu.be/SnaORhEHRTQ>。2026-09-23 CWS 后台草稿已上传 v0.7.6 包并保存详情及隐私声明；免费／公开／所有地区已选中；账号已选“非交易者”。该草稿已提交审核，提交时已选择审核通过后自动发布；当前后台显示待审核，全站主机权限可能触发深入审核并延迟发布时间。版本化商店文案下列内容仍是提交材料快照，不应当作当前商店页面的已核验文本。

**首次提审信息快照（Edge v0.6.24，2026-09-20，已于 09-21 取消送审；账号/ID 类信息仍有效）**：
- 类别：高效工作（Productivity）；可见性：公用（Public）；语言：English (United States)
- 商店名称（锁定自 manifest）：网页净化助手 · PagePure；商店描述：英文版（功能/隐私/安装三节，存于 Partner Center 提交记录与本文档第二节）
- 商店 logo：`extension/icons/pagepure-256.png`（256×256）
- 截图：`assets/store/screenshot-select.png`、`screenshot-clean.png`（1280×800，取自 demo.html 演示页，无隐私内容）
- 隐私政策：https://gist.github.com/mhgd3250905/3ff8cf844b63c9379e105d5d3e7026a4 （中英双语）
- 数据披露：勾选 Website content（网站内容）；三项证明全部勾选；权限理由与远程代码声明见第三节
- 认证说明：已说明手动功能免密钥可用、BYOK 模式及逐按钮测试步骤（存于提交记录）
- Microsoft Store ID：`0RDCKDS5H0H3`；CRX ID：`ijiaoneehjiebocilhnbmkoohlleaeen`；产品 ID：`647794d8-17b4-4ca3-954f-ecd211d3b985`
- 历史待办已完成：商店链接后来于 2026-09-21 回填到本台账与 README；0.6.24 提交随后取消，账号与产品 ID 记录仅保留为历史参考。

**发布经验来源**：`E:\AII-Jev\0919\STORE_PUBLISH.md`（Jev 邮件助手已于 2026-09-20 用同一账号成功提审）。

## 0.7.6 商店更新（2026-09-23 Edge 提审）

0.7.5 过审 Live 后，当天直接走扩展概述「更新」流程提审 0.7.6（无需取消旧审，本次也未复发 0.7.5 的一览卡校验问题）。提交内容：

- 程序包：`PagePure-0.7.6.zip`（与 `PagePure-0.7.6-chrome-candidate.zip` 为同一份 zip 的副本，39 文件、根目录即 manifest、190,414 字节，SHA-256 `47efcbfb489ebeb50cf443541b50a34510c51ec7191c6823dfc273f331e0c3d5`；权限与 0.7.5 完全相同）
- 商店一览：上传新包后系统按包内 12 种语言重新生成一览行，英语/中文(台湾)/中文(中国) 3 套沿用 0.7.5 已完成文案，其余 9 种未完成语言一览已逐个移除（继续“待母语者抽查翻译后再加”口径）
- 认证说明（每次提交必填）：沿用 0.6.32 文案并追加 0.7.6 变化说明（仅内部安全加固：内容脚本隔离与消息处理收紧、撤销/取消传播修复、删除两条无用 CSS；新增从弹窗打开的独立设置页；无新增权限）
- 可用性/属性/隐私步骤全部沿用（公用、241 市场、高效工作、隐私政策 Gist、Website content 披露、三项证明）
- 提审结果邮件发 sk18101652104@outlook.com；过审后 0.7.5 → 0.7.6 自动替换上架

## 0.7.5 商店更新（2026-09-21 提审）

0.6.32 当天过审后直接走扩展概述「更新」流程提审 0.7.5，无需取消旧审。提交内容：

- 程序包：`PagePure-0.7.5.zip`（38 文件、根目录即 manifest、184832 字节，SHA-256 `062729f6…dba0`；权限与 0.6.32 相同）
- 商店一览：包内 12 种 `_locales` 被自动识别后**只保留 3 套一览**（英语 / 中文(台湾) / 中文(中国)），其余 9 种语言已移除（待母语者抽查翻译后再加）；描述在 0.6.32 英文文案基础上补充悬浮印章入口、跟随浏览器语言（12 种）、自定义 AI 需求三条；徽标用「为所有语言复制此徽标」同步；两张截图按 0.7.5 界面重新生成（1280×800，demo.html 实拍：选区遮罩+净化印章+工具条 / 保存后广告消失）
- 认证说明：沿用 0.6.32 文案并追加 0.7.5 变化说明（本地化、悬浮印章、规则优先 AI 辅助、无新增权限）
- **重要经验**：批量改一览（删 9 语言 + 传图）后 Partner Center 可能长时间卡在「Store 一览 未完成 / instancevalid=false / 发布置灰」，即使所有一览均已完成且无校验错误；此时对任一语言一览做一次任意修改并「保存草稿」（本次是加了一个搜索词）即可触发服务端重新校验，几分钟内翻成 ready；期间出现的「会话已过期」弹窗可能是误报，提交实际生效，以扩展概述状态为准
- 提审结果邮件发 sk18101652104@outlook.com；过审后 0.6.32 → 0.7.5 自动替换上架

## 0.7.1 本地更新（未提交商店）

修复 0.7.0 中选择新语言后网页内工具条仍为中文的问题：工具条改为向扩展后台请求语言表（内容脚本无法读取因存放密钥而锁定的扩展存储），后台实时广播语言变更。交付 `PagePure-0.7.1.zip`，详见 MILESTONE.md。

## 0.7.0 本地更新（已并入 0.7.1）

国际化：12 种界面语言（zh_CN 默认、zh_TW、en、ja、ko、es、pt_BR、ru、de、fr、it、tr），跟随浏览器语言，规则管理页设置视图可手动覆盖；中文文案逐字不变；详见 MILESTONE.md。交付物已并入 `PagePure-0.7.1.zip`。**当时状态快照（2026-09-21，已被后续提交取代）**：当时记录 Edge 0.6.32 审核中、0.7.1 待过审后提交；后续流程以本页顶部台账为准。

## 0.6.32 商店提交（2026-09-21）

按用户要求移除类别净化系列，仅保留区域规则操作及显式智能拆分；旧类别规则停用。交付 `PagePure-0.6.32.zip`（2026-09-21 用户确认实测通过），同日直接以该包（25 个文件、根目录即 manifest、无冗余大文件）提交 Edge 商店审核，提交包名 `PagePure-0.6.32.zip`。提交内容：

- 程序包：`PagePure-0.6.32.zip`（版本 0.6.32，权限与 0.6.24 相同：storage + http/https host permissions）
- 商店描述：全新英文文案，移除“27 categories”“similar-block classification”等类别宣传，改为区域选择/扩大缩小/隐藏恢复/页面例外/规则管理页/撤销/BYOK 智能拆分口径；隐私一节说明启用 AI 时仅向 TypeSafe 官方 API 发送模块文本、图片 alt、结构提示与去参链接路径（存于 Partner Center 提交记录）
- 截图：`assets/store/screenshot-select.png`、`screenshot-clean.png` 已用 0.6.32 界面重新生成（1280×800，取自更新后的 demo.html“区域净化”演示页：选区高亮+净化盖章+快捷工具条 / 保存后广告消失）
- 商店 logo、隐私政策 URL、支持邮箱、类别（高效工作）、市场（241）、可用性（公用）沿用原提交
- 认证说明（每次提交必填）：Manual region selection and all rule features work fully offline, with no account and no API key required. The optional AI splitting is BYOK (bring your own key): a reviewer can test it by entering their own TypeSafe API key (https://console.typesafe.ai/), enabling AI for the site in the popup settings, and choosing the split action on a selected region. Without a key the extension simply skips AI splitting. All rules, snapshots and settings are stored locally in the browser's extension storage on this device only.
- 历史待办已完成：2026-09-21 的发布状态及商店链接已回填本台账顶部与 README；此处保留原提交步骤作为历史快照。

### 0.6.24 历史提审快照（已被 0.6.32 取代）

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

**历史待办已完成**：后续记录已把审核状态与商店链接回填本文档顶部和 README；此处是 0.6.24 提交流程快照，不再是当前待办。

## 后续版本更新

改 `extension/manifest.json` 的 `version` → `python` 重新打包（根目录即 `manifest.json`，参考本文档材料清单）→ 在 Partner Center 该扩展下「Update」上传新 zip 并更新版本说明。
