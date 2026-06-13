# PLM 第二刀 · MP Release 量产发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现两轴交接点「量产发布」：项目关联产品 → 发布动作（前置校验 P0/P1 + 产品已关联 → 事务内生成新 Revision + 写发布记录 + 产品转量产态 + 项目归档）→ 产品版本时间线可见。BOM/文档冻结留待第四刀（发布快照中相应字段先留空）。

**Architecture:** 新增 `mp_releases` 表。`server/db.ts` 加发布事务函数（`nextRevisionLabel` + `releaseProject` + 开放 P0/P1 检查）。tRPC 加 `projects.setProduct` / `projects.release` / `projects.releasePrecheck`。客户端在 ProjectDetailView 头部加「关联产品 + 量产发布」，ProductLibraryView 加版本时间线。TDD，直连本地 docker PG 测试。

**Tech Stack:** drizzle-orm/pg-core、drizzle-kit、@trpc/server、vitest、React + wouter。

**前置：** 本地 docker `cehub-pg`(:55432) 运行中；`.env` 指向它；当前在 `main`，第一刀已合并。设计依据：`docs/design/2026-06-13-two-axis-plm-architecture.md` §6。

---

### Task 0: 建分支

- [ ] **Step 1: 新分支**

```bash
cd /Users/huhanwei/Desktop/ce-project-hub && git checkout main && git checkout -b plm-cut2-mp-release
```

---

### Task 1: Schema — mp_releases 表

**Files:**
- Modify: `drizzle/schema.ts`（在 product_revisions 后追加）

- [ ] **Step 1: 追加 mp_releases 表**

在 `productRevisions` 的类型导出之后追加：

```ts
/** 量产发布记录 = 冻结快照（两轴交接点） */
export const mpReleases = pgTable("mp_releases", {
  id: serial("id").primaryKey(),
  productId: varchar("productId", { length: 32 }).notNull(),
  revisionId: integer("revisionId").notNull(),
  projectId: varchar("projectId", { length: 32 }).notNull(),
  /** 冻结的 BOM 快照（第四刀填充） */
  snapshotBom: jsonb("snapshotBom").$type<unknown[]>().default([]),
  /** 冻结的受控文档快照（第四刀填充） */
  snapshotDocs: jsonb("snapshotDocs").$type<unknown[]>().default([]),
  /** 发布时未关闭问题清单 */
  openIssues: jsonb("openIssues").$type<unknown[]>().default([]),
  /** 关键规格 */
  specs: jsonb("specs").$type<Record<string, unknown>>().default({}),
  notes: text("notes"),
  releasedBy: integer("releasedBy").notNull(),
  releasedAt: timestamp("releasedAt").defaultNow().notNull(),
});
export type MpRelease = typeof mpReleases.$inferSelect;
export type InsertMpRelease = typeof mpReleases.$inferInsert;
```

- [ ] **Step 2: 类型检查**

Run: `pnpm check`
Expected: exit 0。

- [ ] **Step 3: Commit**

```bash
git add drizzle/schema.ts
git commit -m "feat(schema): add mp_releases table"
```

---

### Task 2: 迁移（本地）

- [ ] **Step 1: 生成 + 应用**

Run: `set -a && source .env && set +a && pnpm db:push`
Expected: 生成 `0003_*.sql`（CREATE TABLE mp_releases），applied successfully。

- [ ] **Step 2: 验证**

Run: `docker exec cehub-pg psql -U postgres -d cehub -c "\dt" | grep mp_releases`
Expected: 表存在。

- [ ] **Step 3: Commit**

```bash
git add drizzle
git commit -m "feat: mp_releases migration"
```

---

### Task 3: db.ts 发布逻辑 + 测试

**Files:**
- Modify: `server/db.ts`（import mpReleases；追加函数）
- Create: `server/release.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/release.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProject,
  setProjectProduct, getOpenP0P1Count, releaseProject,
  getProductById, getProjectById, listProductRevisions,
} from "./db";

const PID = "rel_test_product";
const PRJ = "rel_test_project";

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM project_issues WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

describe("MP Release", () => {
  it("links a project to a product and sets baseRevision", async () => {
    await createProduct({ id: PID, name: "测试泵", type: "finished", category: "充气泵", createdBy: 1 });
    await createProject({ id: PRJ, name: "测试NPD", projectNumber: "T1", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1 } as any);
    await setProjectProduct(PRJ, PID);
    const prj = await getProjectById(PRJ);
    expect(prj?.productId).toBe(PID);
  });

  it("counts open P0/P1 issues", async () => {
    const db = await getDb();
    const { sql } = await import("drizzle-orm");
    await db!.execute(sql`INSERT INTO project_issues ("projectId","phaseId",title,severity,status,category) VALUES (${PRJ},'concept','blocker','P0','open','other')`);
    const n = await getOpenP0P1Count(PRJ);
    expect(n).toBe(1);
  });

  it("blocks release when open P0/P1 exist", async () => {
    await expect(releaseProject({ projectId: PRJ, releasedBy: 1 })).rejects.toThrow();
  });

  it("releases after P0/P1 closed: makes Rev A, archives project, product → mass_production", async () => {
    const db = await getDb();
    const { sql } = await import("drizzle-orm");
    await db!.execute(sql`UPDATE project_issues SET status='closed' WHERE "projectId"=${PRJ}`);
    const res = await releaseProject({ projectId: PRJ, releasedBy: 1, notes: "首发" });
    expect(res.revisionLabel).toBe("Rev A");
    const revs = await listProductRevisions(PID);
    expect(revs.length).toBe(1);
    const product = await getProductById(PID);
    expect(product?.lifecycleState).toBe("mass_production");
    expect(product?.currentRevisionId).toBe(res.revisionId);
    const prj = await getProjectById(PRJ);
    expect(prj?.archived).toBe(true);
    expect(prj?.resultRevisionId).toBe(res.revisionId);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `set -a && source .env && set +a && pnpm vitest run server/release.test.ts`
Expected: FAIL（函数未导出）。

- [ ] **Step 3: 实现**

`server/db.ts`：import 行加入 `mpReleases, InsertMpRelease`（来自 `../drizzle/schema`）。末尾追加：

```ts
// ── MP Release 量产发布 ───────────────────────────────────────────────────────

/** 关联项目到产品；同时把项目派生起点设为产品当前版本 */
export async function setProjectProduct(projectId: string, productId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const product = await getProductById(productId);
  await db.update(projects)
    .set({ productId, baseRevisionId: product?.currentRevisionId ?? null })
    .where(eq(projects.id, projectId));
}

/** 开放的 P0/P1 问题数（未 resolved/closed/wont_fix） */
export async function getOpenP0P1Count(projectId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: projectIssues.id })
    .from(projectIssues)
    .where(and(
      eq(projectIssues.projectId, projectId),
      inArray(projectIssues.severity, ["P0", "P1"]),
      drizzleSql`${projectIssues.status} NOT IN ('resolved','closed','wont_fix')`
    ));
  return rows.length;
}

/** 下一个版本号字母 Rev A/B/C… */
export async function nextRevisionLabel(productId: string): Promise<string> {
  const revs = await listProductRevisions(productId);
  return `Rev ${String.fromCharCode(65 + revs.length)}`;
}

/**
 * 量产发布：前置校验 → 事务内 生成 Revision + 发布记录 + 产品转量产态 + 项目归档。
 * 抛错表示校验未过（绕不过去的硬闸）。
 */
export async function releaseProject(input: {
  projectId: string; releasedBy: number; notes?: string;
}): Promise<{ revisionId: number; revisionLabel: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("项目不存在");
  if (!project.productId) throw new Error("项目未关联产品，无法发布");
  const openCount = await getOpenP0P1Count(input.projectId);
  if (openCount > 0) throw new Error(`存在 ${openCount} 个未关闭的 P0/P1 问题，不能发布`);

  const productId = project.productId;
  const label = await nextRevisionLabel(productId);

  return db.transaction(async (tx) => {
    // 当前未关闭问题快照
    const open = await tx.select().from(projectIssues)
      .where(and(eq(projectIssues.projectId, input.projectId),
        drizzleSql`${projectIssues.status} NOT IN ('resolved','closed','wont_fix')`));

    const [rev] = await tx.insert(productRevisions).values({
      productId, revisionLabel: label,
      parentRevisionId: project.baseRevisionId ?? null,
      createdByProjectId: input.projectId,
      status: "released", releasedAt: new Date(), releasedBy: input.releasedBy,
    }).returning({ id: productRevisions.id });

    await tx.insert(mpReleases).values({
      productId, revisionId: rev.id, projectId: input.projectId,
      openIssues: open as unknown[], notes: input.notes ?? null,
      releasedBy: input.releasedBy,
    } as InsertMpRelease);

    await tx.update(products)
      .set({ currentRevisionId: rev.id, lifecycleState: "mass_production" })
      .where(eq(products.id, productId));

    await tx.update(projects)
      .set({ resultRevisionId: rev.id, archived: true })
      .where(eq(projects.id, input.projectId));

    return { revisionId: rev.id, revisionLabel: label };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `set -a && source .env && set +a && pnpm vitest run server/release.test.ts`
Expected: PASS（4 个）。

- [ ] **Step 5: 全量无回归**

Run: `set -a && source .env && set +a && pnpm test`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add server/db.ts server/release.test.ts
git commit -m "feat(db): MP release transaction + precheck + tests"
```

---

### Task 4: tRPC 路由

**Files:**
- Modify: `server/routers/products.ts`（加 setProduct/release/releasePrecheck）或新建 `releases` 路由。本计划加进 `productsRouter`。

- [ ] **Step 1: 加过程**

`server/routers/products.ts` import 加 `setProjectProduct, getOpenP0P1Count, releaseProject, getProjectById`。在 `productsRouter` 中加：

```ts
  setProject: protectedProcedure
    .input(z.object({ projectId: z.string(), productId: z.string() }))
    .mutation(async ({ input }) => {
      await setProjectProduct(input.projectId, input.productId);
      return { ok: true };
    }),

  releasePrecheck: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const project = await getProjectById(input.projectId);
      const openP0P1 = await getOpenP0P1Count(input.projectId);
      return {
        hasProduct: !!project?.productId,
        productId: project?.productId ?? null,
        openP0P1,
        canRelease: !!project?.productId && openP0P1 === 0,
      };
    }),

  release: protectedProcedure
    .input(z.object({ projectId: z.string(), notes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await releaseProject({ projectId: input.projectId, releasedBy: ctx.user.id, notes: input.notes });
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
    }),
```

文件顶部加 `import { TRPCError } from "@trpc/server";`。

- [ ] **Step 2: 类型检查 + Commit**

Run: `pnpm check`（exit 0）
```bash
git add server/routers/products.ts
git commit -m "feat(trpc): setProject/release/releasePrecheck"
```

---

### Task 5: 客户端 — 关联产品 + 量产发布 + 版本时间线

**Files:**
- Read first: `client/src/components/views/ProjectDetailView.tsx` 头部（480-680 行）
- Create: `client/src/components/views/ReleaseDialog.tsx`
- Modify: `ProjectDetailView.tsx`（头部加「量产发布」按钮 + 产品关联）
- Modify: `client/src/components/views/ProductLibraryView.tsx`（产品卡展示版本数 + 点开看版本时间线）

- [ ] **Step 1: 读 ProjectDetailView 头部** 确认按钮区与 perms（`perms.canGateReview` 或 owner/manager 控制发布可见性）。

- [ ] **Step 2: ReleaseDialog 组件**

新建 `ReleaseDialog.tsx`：props `{ projectId, open, onOpenChange, onReleased }`。用 `trpc.products.releasePrecheck.useQuery({projectId})` 显示校验（产品是否关联、开放 P0/P1 数、canRelease），一个 notes 文本框，「确认发布」按钮调用 `trpc.products.release.useMutation`，成功 toast + `onReleased()`。校验不过则禁用按钮并提示原因。复用 Dialog/Button/Input/Label。

- [ ] **Step 3: ProjectDetailView 接入**

头部按钮区加「量产发布」按钮（仅 owner/manager 可见，即 `perms.canGateReview`），点击打开 ReleaseDialog；`onReleased` 回调 `onBack()` 返回列表并提示。若项目未关联产品，ReleaseDialog 内提示「先关联产品」（关联 UI 最小化：一个产品下拉，用 `trpc.products.list` + `trpc.products.setProject`）。

- [ ] **Step 4: ProductLibraryView 版本时间线**

产品卡加版本数徽标（`trpc.products.revisions` 或在 list 返回）。点击产品卡打开一个简单弹窗，用 `trpc.products.revisions.useQuery({productId})` 列出版本（Rev 标签、状态、发布时间、来源项目）。生命周期 badge 用已有 LIFECYCLE_LABELS。

- [ ] **Step 5: 起服务端到端验证**

preview 起 cehub-dev（端口冲突用 3010）。登录后：建产品 → 建项目 → 项目里关联该产品 → （无 P0/P1）量产发布 → 确认产品库里该产品变「量产」、出现 Rev A、项目归档。再造一个 P0 问题的项目验证发布被拦。

- [ ] **Step 6: 类型检查 + Commit**

Run: `pnpm check`
```bash
git add client/src/components/views/ReleaseDialog.tsx client/src/components/views/ProjectDetailView.tsx client/src/components/views/ProductLibraryView.tsx
git commit -m "feat(client): MP release dialog + product revision timeline"
```

---

### Task 6: 上 RDS + 部署

- [ ] **Step 1: RDS 应用 mp_releases**（本地连公网端点 …5ujvo）

用 node pg 幂等执行 `CREATE TABLE IF NOT EXISTS mp_releases (...)`（DDL 同 Task 1，列名加引号），并补 `__drizzle_migrations` 0003 记录（sha256(0003 sql) + journal when）。

- [ ] **Step 2: 验证 RDS** `mp_releases` 表存在。

- [ ] **Step 3: 部署** `bash scripts/deploy-ecs.sh`，烟雾测试 hub.beepump.net 正常。

---

## Self-Review

- 覆盖架构 §6：前置校验（P0/P1 + 产品关联，硬闸）✓、生成 Rev ✓、发布记录 mp_releases ✓、产品转量产态 ✓、项目归档 ✓、未关闭问题快照 ✓。BOM/文档冻结快照字段留空（第四刀填充）——已在 Goal 注明。Gate 通过校验：本刀软处理（Cut 3 重做 Gate 模型），仅硬卡 P0/P1。
- 类型一致：`setProjectProduct/getOpenP0P1Count/nextRevisionLabel/releaseProject` Task 3 定义、Task 4 引用，一致。
- 无占位：每步含代码/命令；Task 5 首步读现状（WIP 改过 UI）为必要前置。
