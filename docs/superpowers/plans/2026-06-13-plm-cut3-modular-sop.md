# PLM 第三刀 · 模块化 SOP + 溯源 Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans。

**Goal:** 把「模块化 SOP」做成数据：模块库（module_library + module_tasks，种子含共享 6 模块 + 核心 3 模块的任务块）+ 项目复用集声明（project_modules，每模块 5 级变更等级）；并把溯源做实（project_issues / project_changelog 加 productId 双向键）。门禁模型重做、认证矩阵 UI 留 Cut 3b。

**Architecture:** 新增 4 张表（module_library/module_tasks/project_modules + issues/changelog 加列）。种子函数填模块库。db + tRPC + 客户端「模块库」只读视图 + 项目「复用集」声明面板。TDD，直连本地 docker PG。全加法，不动现有 Gate/项目流程。

**前置：** 本地 docker `cehub-pg` 运行；`.env` 指向它；在 `main`，Cut 1/2 已合并。设计依据：`docs/design/2026-06-13-project-axis-modular-sop.md` §4-6 + `…two-axis…` §11。

---

### Task 0: 分支

```bash
git checkout main && git checkout -b plm-cut3-modular-sop
```

### Task 1: Schema

**Files:** Modify `drizzle/schema.ts`

- [ ] **Step 1: 追加表 + 改列**（文件末尾追加新表；给 projectIssues / projectChangelog 加 `productId`）

新表（追加到末尾）：
```ts
// ── 模块化 SOP ────────────────────────────────────────────────────────────────
export const MODULE_CHANGE_LEVELS = ["carryover","reuse_verify","minor","redesign","new"] as const;
export type ModuleChangeLevel = (typeof MODULE_CHANGE_LEVELS)[number];

/** 模块库：共享模块 + 品类核心模块 */
export const moduleLibrary = pgTable("module_library", {
  id: serial("id").primaryKey(),
  moduleKey: varchar("moduleKey", { length: 48 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  /** shared | core */
  scope: varchar("scope", { length: 16 }).notNull().default("shared"),
  /** 核心模块所属品类（shared 留空） */
  category: varchar("category", { length: 64 }).notNull().default(""),
  ownerRoles: jsonb("ownerRoles").$type<string[]>().default([]),
  sortOrder: integer("sortOrder").notNull().default(0),
});
export type ModuleLibraryRow = typeof moduleLibrary.$inferSelect;
export type InsertModuleLibrary = typeof moduleLibrary.$inferInsert;

/** 模块任务块：任务 × 阶段 × 执行方 × 责任职能 × 门禁 × 检查项 */
export const moduleTasks = pgTable("module_tasks", {
  id: serial("id").primaryKey(),
  moduleKey: varchar("moduleKey", { length: 48 }).notNull(),
  phase: varchar("phase", { length: 32 }).notNull(),
  task: varchar("task", { length: 256 }).notNull(),
  /** internal | supplier | lab */
  executor: varchar("executor", { length: 16 }).notNull().default("internal"),
  ownerRoles: jsonb("ownerRoles").$type<string[]>().default([]),
  gateName: varchar("gateName", { length: 64 }),
  checklist: jsonb("checklist").$type<string[]>().default([]),
  sortOrder: integer("sortOrder").notNull().default(0),
});
export type ModuleTaskRow = typeof moduleTasks.$inferSelect;
export type InsertModuleTask = typeof moduleTasks.$inferInsert;

/** 项目复用集：每模块的变更等级 */
export const projectModules = pgTable("project_modules", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 32 }).notNull(),
  moduleKey: varchar("moduleKey", { length: 48 }).notNull(),
  /** carryover | reuse_verify | minor | redesign | new */
  changeLevel: varchar("changeLevel", { length: 16 }).notNull().default("redesign"),
  reusedRevisionId: integer("reusedRevisionId"),
}, (t) => ({
  uniq: uniqueIndex("uniq_project_module").on(t.projectId, t.moduleKey),
}));
export type ProjectModuleRow = typeof projectModules.$inferSelect;
export type InsertProjectModule = typeof projectModules.$inferInsert;
```

`projectIssues`：在 `creatorId` 列后加 `productId: varchar("productId", { length: 32 })`。
`projectChangelog`：在 `creatorId` 列后加 `productId: varchar("productId", { length: 32 })`。

- [ ] **Step 2:** `pnpm check`（exit 0）
- [ ] **Step 3:** commit `feat(schema): module library/tasks/project_modules + issue/changelog productId`

### Task 2: 迁移

- [ ] `set -a && source .env && set +a && pnpm db:push` → 生成 0004，apply。验证 4 表/列存在。commit。

### Task 3: db helpers + 种子 + 测试

**Files:** Create `server/module-seed.ts`、`server/modules.test.ts`；Modify `server/db.ts`

- [ ] **Step 1: 种子数据** `server/module-seed.ts` 导出 `MODULE_SEED`（数组：每个模块 { moduleKey, name, scope, category, ownerRoles, tasks: [{phase,task,executor,ownerRoles,gateName,checklist}] }）。含共享 6（housing/pcba/battery/process/cert/packaging）+ 核心 3（pump_core/fan_motor/manual_pump）。housing/battery/pump_core 填完整任务块（取自设计文档样板），其余填 name+ownerRoles、tasks 可少量或空。

- [ ] **Step 2: 失败测试** `server/modules.test.ts`：seedModuleLibrary 后 listModuleLibrary 含 9 模块、getModuleTasks('housing') 含 ID 评审任务；setProjectModule + listProjectModules 往返；含 changeLevel。

- [ ] **Step 3: 实现** `server/db.ts` 加：`seedModuleLibrary()`（幂等 upsert by moduleKey）、`listModuleLibrary()`、`getModuleTasks(moduleKey)`、`setProjectModule(projectId,moduleKey,changeLevel,reusedRevisionId?)`（onConflict update）、`listProjectModules(projectId)`。

- [ ] **Step 4:** 测试通过；全量无回归；commit。

### Task 4: tRPC modules 路由

**Files:** Create `server/routers/modules.ts`；Modify `server/routers.ts`

- [ ] `modules.library`(query, 返回 library+tasks 合并)、`modules.projectModules`(query {projectId})、`modules.setProjectModule`(mutation)。挂到 appRouter。`pnpm check`。commit。

### Task 5: 客户端

**Files:** Create `client/src/components/views/ModuleLibraryView.tsx`；Modify `Home.tsx`（加「模块库」view）；`ProjectDetailView.tsx`（加「复用集」面板或 tab）

- [ ] **Step 1:** ModuleLibraryView：按 scope/category 分组列模块 + 展开看任务块（阶段/任务/责任职能/执行方/门禁）。挂进 Home 导航（图标 Boxes）。
- [ ] **Step 2:** 项目复用集：ProjectDetailView 加一个 tab「复用集」或面板，列模块 + 每模块下拉选 changeLevel（5 级），调 `modules.setProjectModule`。
- [ ] **Step 3:** preview 起服务，登录验证：模块库显示 9 模块、housing 含 ID 评审；某项目设几个模块的 changeLevel 并持久化。截图。
- [ ] **Step 4:** `pnpm check`；commit。

### Task 6: 上 RDS + 部署 + 种子

- [ ] RDS 幂等建 4 表/加列 + 补迁移记录（公网端点 …5ujvo）。
- [ ] 部署后调用一次 seedModuleLibrary（通过一个一次性脚本或在 setup 时触发；最简单：部署后本地连 RDS 跑 seed，或加一个 admin tRPC `modules.seed`）。本刀用：tRPC `modules.seed`(adminProcedure) 部署后调一次。
- [ ] 部署 `bash scripts/deploy-ecs.sh`，烟雾测试。

---

## Self-Review
- 覆盖：模块库 + 任务块 ✓、项目复用集（5 级变更等级）✓、溯源 productId ✓。门禁重做 / 认证矩阵 UI → Cut 3b（已注明）。
- 类型一致：seedModuleLibrary/listModuleLibrary/getModuleTasks/setProjectModule/listProjectModules T3 定义 T4/T5 引用。
- 无占位：种子内容取自设计文档样板。
