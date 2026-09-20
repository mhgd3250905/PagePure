# 网页净化助手 PagePure 隐私政策 / PagePure Privacy Policy

更新日期 / Last updated: 2026-09-20

网页净化助手 PagePure（下称"本扩展"）不在开发者侧收集、存储或处理任何用户数据。

PagePure (the "extension") does not collect, store, or process any user data on the developer's side.

## 1. 本地存储 / Local storage

净化规则、区域快照、撤销记录、页面偏好与你保存的 API 密钥仅保存在本机浏览器的扩展本地存储中，不会同步到任何服务器。清除扩展数据或在设置中删除规则即从本机删除。

Purification rules, region snapshots, undo records, page preferences, and your saved API key are stored only in your browser's local extension storage. They are never synced to any server. Removing the extension's data or deleting rules in its settings deletes them locally.

## 2. API 密钥 / API key

可选的智能识别功能使用你自己的 TypeSafe（Jev）API 密钥。密钥仅保存在本机扩展受信任存储中，不同步、不回显，可随时在设置中清除；调用使用你自己的 TypeSafe 账户与额度。

The optional AI classification uses your own TypeSafe (Jev) API key. The key stays in the extension's trusted local storage on your device — never synced, never displayed — and can be cleared at any time in settings. API calls use your own TypeSafe account and quota.

## 3. 发送的数据 / Data sent to the API

仅当你配置密钥并为当前网站启用智能判断时，本扩展才将以下内容发送到 TypeSafe 官方 API（api.typesafe.ai）用于模块类别判断：模块的可见文本、图片替代描述、结构提示，以及去除查询参数后的链接路径。每批最多 5 个模块，并发请求最多 3 个。

Only when you have configured a key and enabled AI for the current site does the extension send the following to the official TypeSafe API (api.typesafe.ai) for module classification: the module's visible text, image alt descriptions, structure hints, and link paths with query strings removed. At most 5 modules per request and 3 requests in parallel.

本扩展不发送、不上传：完整网页 HTML、Cookie、浏览历史、表单输入或可编辑区域内容、跨域 iframe 内部内容。

The extension never sends or uploads: full page HTML, cookies, browsing history, form input or editable content, or content inside cross-origin iframes.

## 4. 权限说明 / Permissions

- `storage`：用于保存上述本地配置、规则与快照。
- 主机权限（所有 http/https 网页）：用于在你访问的网页上显示选择界面、应用你保存的净化规则并恢复区域显示。全部在本地页面上下文执行；启用 Jev 时按第 3 条范围发送数据。本扩展不会用这些权限向其他服务器上传页面内容。

- `storage`: saves the local configuration, rules, and snapshots described above.
- Host permissions (all http/https sites): used to show the selection UI on pages you visit, apply your saved purification rules, and restore regions. All of this runs locally in the page context; data is sent to the API only as described in section 3. The extension never uploads page content to any other server.

## 5. 不包含的内容 / What is not included

本扩展不含统计、广告或追踪组件，不出售任何数据，也不将数据用于与核心功能无关的用途。

The extension contains no analytics, advertising, or tracking components. It does not sell data or use data for purposes unrelated to its core functionality.

## 联系 / Contact

如有问题请通过 Edge 加载项商店页面的支持渠道联系开发者。

For questions, contact the developer through the support channel on the Edge Add-ons store listing.
