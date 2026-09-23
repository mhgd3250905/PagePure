# 网页净化助手 PagePure 隐私政策 / PagePure Privacy Policy

更新日期 / Last updated: 2026-09-23

网页净化助手 PagePure（下称"本扩展"）不在开发者侧收集、存储或处理任何用户数据。

PagePure (the "extension") does not collect, store, or process any user data on the developer's side.

## 1. 本地存储 / Local storage

净化规则、区域快照、撤销记录、页面偏好、拆分学习样例与你保存的 API 密钥保存在本机浏览器的扩展存储中，不进行云端同步。智能请求会按第 3 条发送必要的模块描述和学习样例。清除扩展数据或在设置中删除规则即从本机删除相应数据。

Purification rules, region snapshots, undo records, page preferences, split-learning examples, and your saved API key are stored in your browser's extension storage without cloud synchronization. AI requests send the necessary module descriptions and learning examples as described in section 3. Clearing extension data or deleting rules in settings removes the corresponding local data.

## 2. API 密钥 / API key

可选的智能识别功能使用你自己的 TypeSafe（Jev）API 密钥。密钥仅保存在本机扩展受信任存储中，不同步、不回显，可随时在设置中清除；发起 AI 请求时，密钥会作为 Bearer 请求凭据直接发送给 TypeSafe API，不会发送到 PagePure 开发者服务器；调用使用你自己的 TypeSafe 账户与额度。

The optional AI classification uses your own TypeSafe (Jev) API key. The key stays in the extension's trusted local storage on your device — never synced, never displayed — and can be cleared at any time in settings. When an AI request is made, the key is sent directly to the TypeSafe API as a Bearer credential; it is not sent to the PagePure developer's server. API calls use your own TypeSafe account and quota.

## 3. 发送的数据 / Data sent to the API

仅当你配置密钥、开启扩展且当前网站的智能判断已启用时，本扩展才向 TypeSafe 官方 API（api.typesafe.ai）发送请求。知乎主站与知乎专栏默认启用智能判断，其他网站默认关闭；你可以在设置中调整。普通分类请求发送模块的可读文本（包括被本扩展折叠的模块）、你保存的阅读/净化需求文本（包括自定义内容）、图片替代描述与图片路径、结构和嵌入媒体提示，以及链接路径；链接 URL 的查询参数和片段会移除。普通分类每批最多 5 个模块。智能拆分请求不发送阅读/净化需求文本；它包含一个父模块和最多 20 个候选子模块，并可附带最多 3 个此前保存的拆分学习样例。并发请求最多 3 个。

Requests are sent to the official TypeSafe API (api.typesafe.ai) only when you have configured a key, the extension is enabled, and AI is enabled for the current site. AI is enabled by default on the main Zhihu site and Zhihu's column site, and disabled by default elsewhere; you can change this in settings. Ordinary classification requests contain readable module text (including modules collapsed by this extension), your saved reading or purification requirement (including custom text), image descriptions and paths, structural and embedded-media hints, and link paths. Query strings and fragments are removed from link URLs. Ordinary classification sends at most 5 modules per request. Smart-splitting requests do not send the reading or purification requirement; they send one parent module and up to 20 candidate child modules, and may include up to 3 previously saved split-learning examples. At most 3 requests run in parallel.

本扩展不发送、不上传：完整网页 HTML、Cookie、浏览历史、表单输入或可编辑区域内容、跨域 iframe 内部内容。

The extension never sends or uploads: full page HTML, cookies, browsing history, form input or editable content, or content inside cross-origin iframes.

## 4. TypeSafe API 服务处理 / TypeSafe API processing

TypeSafe 是独立的 API 服务提供者，直接接收第 3 条列明的 AI 输入以及第 2 条所述请求凭据。PagePure 开发者不接收这些 API 请求。TypeSafe 的隐私政策说明，未经客户事先同意，不会用输入提示或其他输入训练或微调模型；其服务协议另说明为提供服务、生成遥测、预防欺诈/滥用及遵守法律而处理数据。TypeSafe 自身的数据保留、服务运营和其他处理受其现行政策及服务协议约束，可能变更；启用 AI 前请阅读：[TypeSafe Privacy Policy](https://typesafe.ai/legal/privacy-policy) 和 [TypeSafe Master Customer Agreement](https://typesafe.ai/legal/mca)。

TypeSafe is an independent API provider that receives the AI inputs listed in section 3 and the request credential described in section 2. The PagePure developer does not receive these API requests. TypeSafe's privacy policy says it will not train or fine-tune models on prompts or other inputs without prior consent; its service agreement also describes processing to provide services, generate telemetry, prevent fraud or abuse, and comply with law. TypeSafe's retention, service operations, and other processing are governed by its current policies and agreements, which may change. Read the [TypeSafe Privacy Policy](https://typesafe.ai/legal/privacy-policy) and [TypeSafe Master Customer Agreement](https://typesafe.ai/legal/mca) before enabling AI.

PagePure uses page content and related information only to provide the extension's user-facing purification and optional AI features. The developer does not sell this information, use it for advertising or unrelated purposes, or receive it for human review. AI requests are sent to TypeSafe only when the extension is enabled, a key is configured, and AI is enabled for the current site.

## 5. Chrome Web Store Limited Use

本扩展对用户数据的访问、使用和传输仅限于提供或改进上文披露的 PagePure 单一用途。向 TypeSafe 传输数据仅为提供用户启用的可选 AI 功能所必需。本扩展对数据的处理遵守 Chrome Web Store 用户数据政策，包括 Limited Use（有限使用）要求。

PagePure's access, use, and transfer of user data are limited to providing or improving the single purpose disclosed above. Data is transferred to TypeSafe only as necessary to provide the optional AI feature enabled by the user. PagePure's data handling complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## 6. 权限说明 / Permissions

- `storage`：用于保存上述本地配置、规则与快照。
- 主机权限（所有 http/https 网页）：用于在你访问的网页上显示选择界面、应用你保存的净化规则并恢复区域显示。全部在本地页面上下文执行；启用 Jev 时按第 3 条范围发送数据。本扩展不会用这些权限向其他服务器上传页面内容。

- `storage`: saves the local configuration, rules, and snapshots described above.
- Host permissions (all http/https sites): used to show the selection UI on pages you visit, apply your saved purification rules, and restore regions. All of this runs locally in the page context; data is sent to the API only as described in section 3. The extension never uploads page content to any other server.

## 7. 不包含的内容 / What is not included

本扩展不含统计、广告或追踪组件，不出售任何数据，也不将数据用于与核心功能无关的用途。

The extension contains no analytics, advertising, or tracking components. It does not sell data or use data for purposes unrelated to its core functionality.

## 8. 联系 / Contact

如有问题请通过 [PagePure GitHub Issues](https://github.com/mhgd3250905/PagePure/issues) 联系开发者。

For questions, contact the developer through [PagePure GitHub Issues](https://github.com/mhgd3250905/PagePure/issues).
