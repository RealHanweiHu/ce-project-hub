# PLM 简化 + 项目总揽 设计文档

- 日期：2026-06-14
- 状态：已通过头脑风暴，待实现计划
- 借鉴来源：飞书项目 SKG 案例——按产品成熟度三分、每类走对应长度的流程，弱化复杂的复用/模块/派生机制。

## 1. 背景与目标

现有项目模型在「3 类 category（npd/eco/idr）」之上又叠加了「PLM 派生模式 mode + 复用集 + 模块变更等级」一层，语义重叠、建项目和详情页过重。

本次目标：**回到 SKG 式的简单心智——选一个项目类型 → 走对应流程**。把复用/模块/派生这层收掉，让 3 类 category 成为唯一的项目类型轴；同时给详情页加一个「项目总揽」落地页。

### 关键决策（来自头脑风暴）
- 复用集 / 模块库 / 模块变更等级 / `mode` / `objectType`：**彻底移除**（UI + 路由 + 表/列）。
- 产品库（products/revisions）、量产发布（MP Release，含 `baseRevisionId/resultRevisionId`）、BOM：**全部保留**。
- 3 类 category 保留现名（新产品开发 / 迭代升级 / 外观翻新），不改成 SKG 措辞——现名更贴本场景。
- 新增「项目总揽」tab，作为详情页**默认落地页**。

### 依赖确认（已查证）
- 复用集 / 模块 **未被** 产品库 / 量产发布 / BOM 引用 → 可安全移除。
- `baseRevisionId / resultRevisionId` 被 MP Release 使用 → **保留**；`mode / objectType` 仅 PLM 派生用 → 移除安全。

## 2. 移除清单

### 前端（删除/编辑文件）
- 删 `client/src/components/views/ReuseSetPanel.tsx`（复用集面板）。
- 删 `client/src/components/views/ModuleLibraryView.tsx`（模块库页）。
- `ProjectDetailView.tsx`：去掉 `reuseset` tab 的按钮与渲染、`mainTab` 联合类型去掉 `'reuseset'`、删 `ReuseSetPanel` import。
- `Home.tsx`：删 `ModuleLibraryView` lazy import（:52）、`View` 联合里的 `'modules'`（:26）、顶部导航 `{ id:'modules', label:'模块库' }`（:610）、`viewLabels.modules`（:623）、渲染分支 `view === 'modules'`（:942-943）。
- 注：经查证，建项目 UI **没有** `mode/objectType` 选择控件、`projectToApiInput` 也**未**透传它们 → 前端无此项可删。

### 后端（删除/编辑文件）
- 删 `server/routers/modules.ts` + `routers.ts:218` 的 `modules: modulesRouter` 挂载与 import。
- 删 `server/module-seed.ts`。
- 删 `server/modules.test.ts`（测的就是被删的 helper）。
- `server/db.ts`：删 schema imports `moduleLibrary/moduleTasks/projectModules` 及类型（:18-20）、`MODULE_SEED` import（:29），删 helper `seedModuleLibrary/listModuleLibrary/getModuleTasks/setProjectModule/listProjectModules`（约 :1136-1189）。
- `drizzle/schema.ts`：删 `MODULE_CHANGE_LEVELS`、`ModuleChangeLevel`、`moduleLibrary`、`moduleTasks`、`projectModules` 及其 `*Row/Insert*` 类型导出（:772-822），删 `projects` 的 `mode`、`objectType` 两列（:85-87）。
- 注：`createProjectWithSeed` 并未显式写 `mode/objectType`——这两列的值来自 schema 列定义的 `.default()`。删掉列定义即去除默认；`InsertProject` 入参（projectToApiInput 构造）本就不含这两个字段，确认无依赖即可。
- `projectInputSchema`（projects 路由）经查证**不含** `mode/objectType` → 无需改动。

### 数据库（迁移）
- DROP TABLE IF EXISTS：`project_modules`、`module_library`、`module_tasks`。
- ALTER projects DROP COLUMN IF EXISTS：`mode`、`objectType`。
- **保留** projects 的 `productId / baseRevisionId / resultRevisionId / customFields`。
- 模块无启动期 seed（仅 modules.test.ts + 路由 `seed` mutation 调用），删表不影响启动。
- 迁移前**先查生产**：是否有项目用到 reuse/module 数据或非默认 `mode/objectType`；有则导出留底再 drop。

## 3. 建项目流程（SKG 式）

现状（`ProjectListView.tsx` 建项目弹窗 Step 1，:435）**已**用 `PROJECT_CATEGORIES` 以纵向按钮列表展示图标/名称/描述/阶段数/典型周期。本次不是新增，而是把这个**纵向列表打磨成真正的 3 卡片栅格布局**（SKG 式横排卡片），选定即决定 SOP 流程。其余字段不变（名称、编号、PM、风险、起止日期）。

**关联产品不进建项目范围**（P1 决策）：当前建项目链路（`projectToApiInput` :74、`projectInputSchema` :27、`createProjectWithSeed`）都不收 `productId`，且产品关联现实上发生在量产发布/后置关联。为保持简化、不引入新字段，本次**不**在建项目里加关联产品；`productId` 列保留，后续如需“建项目即挂产品”再单独追加（前端字段 + create/update schema + 入参写入）。

## 4. 项目总揽 tab

新增 `OverviewPanel`（只读），作为详情页**默认 tab**。数据全部来自已加载的 `project` 对象与现成计数，无需新表/新接口。

内容：
- **基础信息**：类型（category 徽章卡）、项目编号、PM、风险等级、起止日期、当前阶段、整体进度、关联产品（若有）。
- **关键指标**：阶段进度条、任务完成率、开放问题数、待决变更数、成员数。

实现：
- 类型/进度/阶段/起止/PM/风险/关联产品/问题数/变更数 全部来自 `useProjectData` 已加载的 `project` 对象 + 现成帮助函数（`computeOverallProgress / getPhaseStatus`）+ `CATEGORY_MAP`，无新请求。
- **成员数例外**（P2c）：`useProjectData` 不含 members（成员列表在 `MembersPanel` 内单独 `members.list` 查询）。总揽页要显示成员数，就**自己发一个 `members.list` 查询**（该接口已存在，开销很小）取 `.length`；这是总揽页唯一的新增请求。

## 5. 详情页 tab 最终形态

`总揽(默认) / 任务清单 / 看板 / 需求池 / 甘特图 / 问题 / 变更记录 / 成员 / BOM / 字段`

- 去掉：复用集。
- 量产发布按钮：保留。
- 默认 `mainTab` 由 `'tasks'` 改为 `'overview'`。

## 6. 测试与验证

- 类型检查 + 现有测试全绿。删 `server/modules.test.ts`（测被删 helper）。经查证 `relational-tables.test.ts` 及其他测试**不引用** module 表或 mode/objectType 列 → 无需改动。
- 移除 modules 路由后，确认 `release.test.ts`（MP Release）仍通过（验证依赖切割正确）。
- 浏览器验证：建项目 3 卡选择可用；详情页默认进总揽且信息正确；复用集/模块库入口消失；量产发布/BOM/产品库仍正常。

## 7. 数据迁移与部署

沿用既有「每刀」纪律：
- 分支 → 改代码 + 删表/删列的 drizzle 迁移 → 本地 docker 验证 → 生产数据排查/留底 → RDS 幂等 SQL（DROP IF EXISTS）+ 手工补 `__drizzle_migrations` 记录 → 部署 → 合并 → push。
- 删列/删表是破坏性操作：迁移脚本用 `DROP ... IF EXISTS`，执行前确认生产已留底。

## 8. 不在本次范围

- 自动化规则引擎（另有 spec，已停在原处，本简化完成后回到那条线）。
- category 的 SOP 阶段内容调整（本次只动“类型轴 + 复用/模块层”，不改各 category 的阶段定义）。
