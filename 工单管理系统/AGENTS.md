# 工单管理系统 — AGENTS.md

本目录为纯前端工单管理系统（PC + 移动H5），无构建步骤、无后端、无网络依赖。

## 技术约束
- 纯原生 HTML/CSS/JS，禁止引入构建工具、框架或 CDN。
- 单入口 `index.html`，用 hash 路由：`#/` = PC 端，`#/m` = 移动 H5。
- 数据持久化于 `localStorage`，键名 `woms_data_v1`。
- 所有图表用手写 SVG，不依赖第三方图表库。

## 目录结构
- `index.html` — 单入口，含 PC 与移动两套容器。
- `styles.css` — 全部样式（PC + 移动）。
- `data.js` — 数据层：枚举、存储、种子数据、CRUD、状态流转。
- `app.js` — PC 端逻辑：路由、看板、列表、详情、表单、看板概览、状态流转。
- `mobile.js` — 移动 H5 逻辑：按 类型/状态/处理人 只读查询。
- `AGENTS.md` — 本文件。
- `README.md` — 使用说明。

## 命名约定
- 工单编号格式：`WOyyyymmdd-NNN`，NNN 为当日序号，3 位补零。
- DOM id 使用 kebab-case；JS 变量/函数使用 camelCase。
- 全局命名空间统一挂在 `window.WOMS`。

## 数据约定
- 枚举字段（类型/状态/优先级/网格/处理人）定义于 `data.js` 的 `WOMS.ENUMS`，禁止自由输入。
- 状态枚举：待分配 / 处理中 / 已完成 / 已驳回 / 已关闭。
- 合法状态流转定义于 `WOMS.TRANSITIONS`，任何流转必须校验合法性。
- 操作日志（history）随工单存储，按时间倒序，记录操作人/时间/动作/前后值/备注。
- 删除为软删除：工单从 `data.tickets` 移入 `data.recycle`，记录 `deletedAt`/`deletedBy`；可 `restoreTicket` 恢复或 `purgeTicket` 彻底删除。
- CSV 导入导出由 `WOMS.csv` 提供：`export(tickets)` 生成 UTF-8 BOM CSV，`parse(text)` 解析并校验枚举后返回 `{ok, imported, failed}`。

## 重置约定
- 清空数据：浏览器控制台执行 `WOMS.data.reset()`，或删除 localStorage 的 `woms_data_v1` 后刷新。
- 种子数据由 `buildSeed()` 生成，共 12 条，覆盖全部类型/状态/处理人。

## 改动纪律
- 改完用无头浏览器打开 `file://` 路径做冒烟测试，确认 PC 与移动端均能渲染。
- 不要为让代码跑起来而注释掉报错或加绕过；找根本原因。
- 不要引入新的外部依赖。