# 工单管理系统

纯前端、无需构建、双击即开的企业级工单管理系统，含 PC 端与移动 H5 查询端。

## 打开方式
直接双击 `index.html`，或在浏览器地址栏打开本文件路径（`file://`）。
- PC 端：默认页面（`#/`）。
- 移动 H5：访问 `index.html#/m`（建议在手机或浏览器移动模拟器中查看）。

## 功能清单
### PC 端
- 拖拽看板：5 个状态列（待分配/处理中/已完成/已驳回/已关闭），拖拽卡片即流转状态，非法流转自动拦截。
- 工单列表：多条件筛选（类型/状态/处理人/网格/优先级）+ 关键字模糊搜索 + 分页。
- 新建/编辑/删除：枚举字段下拉、必填项校验、删除二次确认。
- 工单详情：全字段展示 + 状态流转历史时间线。
- 状态流转：严格路径控制，完成/驳回必填备注，权限按角色区分。
- 数据看板：概览卡片 + 状态分布环形图 + 类型分布柱状图，支持按网格/处理人筛选。
- 角色切换：管理员 / 处理员，不同角色对应不同操作权限。
- 回收站：删除工单为软删除，可在回收站恢复或彻底删除，支持清空回收站。
- CSV 导入导出：列表页一键导出当前筛选结果为 CSV（Excel 可直接打开）；支持批量导入 CSV 创建工单，枚举字段自动校验，非法行跳过并计数。
- 操作日志：聚合全部工单（含回收站）的操作历史，按时间倒序，支持按动作/操作人/关键字/日期范围筛选与分页。

### 移动 H5（只读查询）
- 按工单类型 / 完成状态 / 归属处理人 三个维度筛选。
- 只读工单卡片列表 + 只读详情，无任何编辑/流转入口。

## 重置数据
浏览器控制台执行：
```js
WOMS.data.reset()
```
然后刷新页面即可回到种子数据（12 条示例工单）。

## CSV 导入导出
- 导出：在「工单列表」页点「导出CSV」，导出当前筛选结果，文件名 `工单_yyyymmdd.csv`，UTF-8 BOM 编码（Excel 打开中文不乱码）。
- 导入：点「导入CSV」选择文件，按表头 `类型,状态,优先级,客户账号,归属处理人,所属网格,服务地址,工单日期,问题详情,客户联系方式,创建人` 解析；类型/状态/优先级/网格必须命中枚举，否则该行跳过；工单编号自动生成。
- 可先用「导出CSV」生成模板，编辑后再导入。

## 云端同步（Supabase，可选）
默认是纯 localStorage 离线模式。如果要多人共享数据，可以把数据存到 Supabase。

### 配置
1. 在本目录复制环境变量模板：
   ```powershell
   Copy-Item .env.example .env
   ```
2. 只在 `.env` 中填写 Supabase 配置：
   ```dotenv
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   ```
3. 生成浏览器可读取的本地配置：
   ```powershell
   node tools/sync-env.js
   ```
   脚本会生成 `config.local.js`；`.env` 和 `config.local.js` 均已忽略，禁止提交。以后修改 `.env` 后重新运行此命令。
4. 在 Supabase SQL 编辑器建表（最小 schema）：
   ```sql
   create table public.tickets (
     id text primary key,
     code text, type text, status text, priority text,
     "customerAccount" text, assignee text, grid text,
     address text, "ticketDate" text, description text,
     contact text, creator text,
     "createdAt" timestamptz, "updatedAt" timestamptz,
     history jsonb,
     deleted boolean default false, "deletedAt" text, "deletedBy" text
   );
   ```
5. 打开页面，右上角出现「云端已连接」绿点和「↻ 立即同步」按钮即配置成功。

Vercel 部署时，在项目环境变量中配置同名的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`，并把构建命令设为 `node tools/sync-env.js`。如果 Vercel 项目根目录是仓库根目录，则使用 `node 工单管理系统/tools/sync-env.js`。纯静态 HTML 不会自动读取 Vercel 环境变量，必须执行生成脚本。

### 行为
- **加载**：页面打开时先从 Supabase 拉取，失败则退回 localStorage。
- **写入**：所有 `WOMS.data.*` 写操作都会异步同步到 Supabase（fire-and-forget），失败只控制台报错，不影响本地流程。
- **手动同步**：点「↻ 立即同步」按钮，把本地所有工单推送到 Supabase（覆盖式 upsert）。
- **离线降级**：未生成 `config.local.js` 或网络不通时，自动退回纯 localStorage 模式（隐藏同步指示器/按钮）。

### 控制台 API
```js
WOMS.sync.enabled         // 是否启用
WOMS.sync.loadRemote()    // 从 Supabase 拉取，返回 {tickets, recycle} 或 false
WOMS.sync.pushAll(data)   // 推送 data.tickets + data.recycle 到 Supabase
WOMS.sync.pushNow()       // 推送当前 localStorage 全部数据
```
所有同步操作都打 `[SYNC]` 前缀的日志（OK / FAIL），打开 DevTools Console 即可追踪。

### 注意
- Supabase anon key 会随前端请求对浏览器可见，`.env` 只能避免误提交，不能把前端 key 变成秘密；数据安全必须依赖 Supabase RLS 策略。
- `history` 是 JSONB 列，写入的是数组（不是字符串化的 JSON），否则会 400。
- `on_conflict=id` 要求 `id` 是主键或唯一约束。
- 多人同时编辑同一工单时，最后一次 upsert 胜出，没有版本合并。

## 技术说明
- 纯 HTML/CSS/JS，无构建工具、无框架、无 CDN，可完全离线运行。
- 数据存储于浏览器 localStorage，键名 `woms_data_v1`。
- 图表为手写 SVG。
