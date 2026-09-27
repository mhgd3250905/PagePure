# Chrome Web Store 首次提审材料（PagePure 0.7.6）

状态（2026-09-24 更新）：**v0.7.6 仍在审核中，未上架**。商品 ID `hfadgbminekfilodfjdpbllimaemlhdb`；09-23 提审时曾选择“审核通过后自动发布”。09-23 曾凭后台观察误记为当天过审上架；09-24 后台尝试发布时弹窗“无法修改或发布审核中的内容”，确认仍在审核，且公开侧核验一致（直链 `detail/empty-title/<id>` 占位、站内搜索无结果、Google 未索引）。发布方联系邮箱已通过验证；非交易者声明由账号持有人按个人业余项目选择。分发设置为免费、公开、所有地区。全站 HTTP/HTTPS 主机权限可能触发深入审核并延迟发布。截至本次更新，GitHub 公开下载版本仍为 0.7.5。

## 候选包与核对

- 包：`output/PagePure-0.7.6-chrome-candidate.zip`（39 个扩展文件，190,414 字节；SHA-256 `47efcbfb489ebeb50cf443541b50a34510c51ec7191c6823dfc273f331e0c3d5`）
- 包内根目录必须直接包含 `manifest.json`；只包含 `extension/` 运行文件，不包含测试、源码仓库、API Key 或本地配置。
- 图标：`extension/icons/pagepure-128.png`（128×128）
- 截图：`assets/store/screenshot-select.png`、`assets/store/screenshot-clean.png`（各 1280×800；当前为中文演示页截图）
- 小型宣传图：`assets/store/cws-small-tile.png`（440×280）
- 设计说明：`assets/store/cws-promo-philosophy.md`
- YouTube 演示视频 `assets/store/PagePure-cws-demo-zh-CN.mp4`（1280×720、16.77 秒、H.264）来自 `demo.html` 手动选择/预览/保存/撤销流程的截图剪辑，画面标注“不调用真实模型”，不是连续屏幕录制；已上传为不公开列出视频：<https://youtu.be/SnaORhEHRTQ>。后台一览使用标准播放地址 `https://www.youtube.com/watch?v=SnaORhEHRTQ`（短链曾触发表单无效，换成标准格式后保存成功）。

## 商店一览（简体中文）

**名称**：网页净化助手 · PagePure

**简短描述**（可直接粘贴）：

> 点选不想看的网页区域，预览后保存；手动规则在本机运行并自动恢复。可选智能识别使用你自己的 TypeSafe Jev API Key。

**详细描述**（可直接粘贴）：

> 按自己的阅读需要整理网页。点选不想看的区域，预览后保存；PagePure 会在匹配的网站或页面上自动应用规则。
>
> **功能**
> - 点选页面区域，调整范围、预览、保存或撤销
> - 按网站、页面类型或指定页面保存规则
> - 设置页面例外，之后可随时恢复隐藏内容
> - 手动净化无需账号或 API Key；规则保存在本机浏览器
> - 可选智能判断与智能拆分使用你自己的 TypeSafe Jev API Key
>
> **AI 与数据**
> 知乎主站和知乎专栏默认启用智能判断，其他网站默认关闭；可在每个网站的设置中调整。配置 API Key 并开启扩展后，普通分类请求会把必要的网页模块描述和你保存的阅读/净化需求文本（包括自定义要求）发送给 TypeSafe 官方 API：模块可读文本（包括被 PagePure 折叠的模块）、图片说明及路径、结构和嵌入媒体提示、去除查询参数和片段的链接路径。智能拆分请求不发送阅读/净化需求文本；它发送一个父模块、最多 20 个候选模块及最多 3 条本机保存的拆分参考。你的 API Key 只保存在本机，并作为请求凭据发给 TypeSafe；PagePure 开发者不会收到该 Key 或 AI 请求内容。
>
> PagePure 不向开发者服务器发送整页 HTML、Cookie、浏览历史、表单输入、可编辑区域内容或跨域 iframe 内容；扩展不含广告、分析或追踪代码。
>
> **权限**
> `storage` 用于在本机保存设置、规则、快照、撤销记录及 API Key。HTTP/HTTPS 网站访问用于在网页上显示选择界面、读取当前区域并应用你保存的规则。可选 AI 仅在扩展开启、已配置 Key 且当前网站的 AI 判断启用时请求 TypeSafe。

## English listing (optional; package UI supports English)

**Name**: PagePure - Web Purifier

**Short description**:

> Select page regions to hide, preview, and save local rules. Optional AI classification uses your own TypeSafe Jev API key.

**Detailed description**:

> Clean up web pages your way. Select a region, preview the change, and save a rule that PagePure reapplies on matching sites or pages.
>
> **Features**
> - Select a page region, adjust its size, preview, save, or undo
> - Save rules for a site, page type, or specific page
> - Set page exceptions and restore hidden content at any time
> - Manual cleanup works without an account or API key; rules stay in your browser
> - Optional AI classification and smart splitting use your own TypeSafe Jev API key
>
> **AI and data**
> AI classification is enabled by default on Zhihu and Zhihu Columns; it is off by default on other sites and can be changed per site. When the extension is enabled, a key is configured, and AI is enabled for the site, ordinary classification requests send the necessary page-module descriptions and your saved reading or purification requirement (including custom text) to the official TypeSafe API: readable text (including modules collapsed by PagePure), image descriptions and paths, structure and embedded-media hints, and link paths with query strings and fragments removed. Smart-splitting requests do not send the reading or purification requirement; they send one parent module, up to 20 candidate modules, and up to three locally saved split examples. Your API key stays in local extension storage and is sent to TypeSafe as the request credential; the PagePure developer does not receive the key or AI request content.
>
> PagePure does not send full-page HTML, cookies, browsing history, form input, editable content, or cross-origin iframe content to the developer's servers. The extension contains no advertising, analytics, or tracking code.
>
> **Permissions**
> `storage` saves settings, rules, snapshots, undo records, and your API key locally. HTTP/HTTPS site access displays the selection interface, reads the current region, and reapplies your saved rules. Optional AI requests go to TypeSafe only when the extension is on, a key is configured, and AI is enabled for the current site.

## 隐私与后台声明草案

- **单一用途**：帮助用户选择、隐藏、恢复网页区域，并在本地保存和重新应用网页净化规则；可选 AI 仅辅助该用途中的区域识别和拆分。
- **Limited Use**：隐私政策已加入明确声明，PagePure 对用户数据的访问、使用和传输仅限于提供或改进披露的单一用途，TypeSafe 传输仅为用户启用的可选 AI 功能所必需，并遵守 CWS User Data Policy 的 Limited Use 要求。
- **数据类型**：按后台实际选项申报“网站内容”和“身份验证信息”：扩展读取当前页面及网址以执行用户请求的规则；启用普通 AI 分类后，模块描述和用户保存的阅读/净化需求文本可发送至 TypeSafe；智能拆分不发送该需求文本，会发送父模块、候选模块及本机保存的拆分参考。API Key 作为 Bearer 凭据发送至同一 API。所有页面网址的查询参数和片段不会随模块链接发送；完整页面 URL 仅在本机用于规则范围和站点设置。未申报网络记录/用户活动，因为扩展不收集浏览历史或追踪点击/滚动/按键数据；用户在选择工具中的交互仅用于当下控制净化功能。
- **数据用途/共享**：仅提供用户可见的净化、识别和拆分功能；PagePure 开发者没有接收这些数据的服务器，不用于广告、营销或无关用途。AI 数据和 Key 直接发往用户选择使用的 TypeSafe API。TypeSafe 的现行隐私政策说明未经事先同意不会用输入训练/微调模型，其服务协议同时说明服务运营、遥测及反滥用处理；详情必须由一览隐私政策链接引导用户阅读。不要选择“未收集/未处理用户数据”。
- **权限**：`storage` 用于本机设置、规则、快照、撤销记录、API Key 和拆分参考；HTTP/HTTPS 主机权限是跨任意网页提供选择与自动应用规则的现有核心功能。应明确说明全站权限用途，不能仅以“将来可能需要”解释。
- **远程代码**：选择“未执行远程代码”。扩展仅把 JSON 请求发给 TypeSafe API 并解析结构化结果；没有动态下载或执行的 JavaScript。
- **隐私政策 URL**：公开 Gist `https://gist.github.com/mhgd3250905/3ff8cf844b63c9379e105d5d3e7026a4` 已于 2026-09-23 10:55:33Z 更新；GitHub API 显示 7,961 字节，拉取 raw URL 后与 `assets/store/privacy-policy.md` 逐字一致，可用于本候选提审。
- **主页/支持**：`https://github.com/mhgd3250905/PagePure`；`https://github.com/mhgd3250905/PagePure/issues`。
- **分发**：免费、Public、默认全部可用地区；一览语言先用简体中文（英文另行本地化时使用随包 `en` locale）。
- **类别建议**：Productivity。发布者显示名称和支持邮箱沿用 Google 开发者账号资料，不从 Edge 账号记录复制或推断。
- **测试说明**：手动规则无需账号或密钥。AI 测试要求审核者自备 TypeSafe API Key；不要提交或共享开发者的 Key。

## 后台提审进度与待办

1. ✅ 更新并核对公开隐私政策 Gist；内容与本页数据披露、当前实现和 [TypeSafe Privacy Policy](https://typesafe.ai/legal/privacy-policy) / [Master Customer Agreement](https://typesafe.ai/legal/mca) 的现行 API 处理说明一致。
2. ✅ 账号持有人已选择“非交易者”（按个人业余项目）。
3. ✅ 已在后台上传 0.7.6 候选包（39 文件，190,414 字节，SHA-256 `47efcbfb489ebeb50cf443541b50a34510c51ec7191c6823dfc273f331e0c3d5`）；商品详情与隐私声明保存成功。可选小型宣传图块未加入后台草稿；本地原始素材保留。
4. ✅ 发布方联系邮箱由账号持有人添加并验证；该联系地址会随产品公开显示。非交易者声明已确认。
5. ✅ 已于 2026-09-23 提交公开审核，提交弹窗中“审核通过后自动发布”保持选中。后台显示“待审核”，并提示审核可能需要数个工作日；全站主机权限可能触发深入审核、延长等待。
6. ⏳ 本候选尚未在真实 Chrome 安装并做端到端验收；既有本地验证使用 `demo.html` 模拟 runtime，未安装 CWS 候选，也未执行真实 AI 请求。待审核期间可在独立测试配置安装验证，但不能更改/撤销当前提审版本；如需修改代码需等待当前审核完成后上传新版本。

Google 官方说明：首次提交需上传 ZIP、填写 Store Listing/Privacy/Distribution；公开可见性意味着所有用户可发现和安装。最终点击“Submit for Review”会触发审核，并可选择审核通过后自动发布或延迟发布。参考：[首次发布](https://developer.chrome.com/docs/webstore/publish)、[一览图片要求](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)、[隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[用户数据披露](https://developer.chrome.com/docs/webstore/user_data)。

## 独立只读复审与验收状态（2026-09-23）

| 维度 | 结论 | 证据/限制 |
| --- | --- | --- |
| 需求完整性 | 通过（提交审核阶段） | 本地材料齐全；包、商品详情、隐私声明均已提交，后台显示待审核，审核通过后将自动发布。 |
| 逻辑准确性 | 通过 | 独立复核 `classifier.mjs`：普通分类 payload 含 `user_context`；拆分只含 parent、candidates 和可选 saved examples，不含该字段。提审文案按此区分。 |
| 边界与政策风险 | 通过（本地材料及当前申报） | 本地隐私页有双语 Limited Use 声明及 GitHub Issues 联系方式；2026-09-23 10:55:33Z 的 Gist API 返回 7,961 字节，公开 raw 内容与本地政策逐字一致。账号持有人已选择“非交易者”；后台已保存“网站内容”“身份验证信息”与三项 Limited Use 声明。 |
| 材料质量 | 通过 | MP4 多帧字幕可读，顶部注明手动演示且不调用真实模型；明确它来自 `demo.html` 截图剪辑，非连续录屏。 |
| 测试覆盖 | 通过（本地） | 主线程与独立审核者均运行 `npm test`：219/219；候选 ZIP 39 个文件逐项 SHA-256 与 `extension/` 一致；视频完整解码成功，H.264、1280×720、30fps、16.77 秒。 |
| 实际发布准备 | 🕐 审核中（09-24 复核） | ZIP 已上传，商店详情、隐私声明已保存；免费／公开／所有地区；联系邮箱已验证。09-23 提审；09-24 后台弹窗确认“无法修改或发布审核中的内容”，公开侧核验一致，尚未过审。真实 Chrome 安装验收仍未做。 |

复审意见（审查时的历史记录）：此前需选择交易者身份、上传视频、同步公开隐私 Gist 的事项均已完成。演示视频仍由当前 Google 账号的既有频道托管；虽然设为不公开列出，获得链接的观众可能看到频道身份，这是可选的品牌呈现风险。当前状态以本节顶部进度为准：邮箱已验证，v0.7.6 已提交并待审核；真实 Chrome 安装验收尚未完成，审核通过后按当前选择自动发布。
