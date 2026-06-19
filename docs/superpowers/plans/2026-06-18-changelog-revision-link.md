# 变更记录↔版本关联 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布时把项目期间 implemented+approved 的变更记录盖章到产出版本并冻一份不可变快照，让"两个版本之间为什么改"可追溯。

**Architecture:** 纯函数 `buildRevisionChangelogSnapshot` 决定"哪些变更进版本+排序+映射"（口径单源、可单测）；`releaseProject` 事务内用 `UPDATE…RETURNING` 盖章并由返回行生成快照写进 `mpReleases.snapshotChangelog`（盖章集合≡快照集合）；版本时间线读快照展示。`revisionId` 为应用层关联字段（加索引、不引 DB FK，沿用全库零 `.references()` 惯例）。

**Tech Stack:** TypeScript / Drizzle ORM (PostgreSQL) / tRPC / React + vitest。迁移走 `drizzle-kit generate` + 程序化 migrator（见 `scripts/test.mjs`），不手写裸 SQL。

设计依据：`docs/superpowers/specs/2026-06-18-changelog-revision-link-design.md`。

---

## File Structure

- **Create** `shared/changelog-snapshot.ts` — 纯函数：状态常量 `REVISION_CHANGE_STATUSES`、类型 `RevisionChangeEntry`、`buildRevisionChangelogSnapshot`。无 IO。
- **Create** `shared/changelog-snapshot.test.ts` — 纯函数单测（无 DB）。
- **Modify** `drizzle/schema.ts` — `projectChangelog` 加 `revisionId` + 索引；`mpReleases` 加 `snapshotChangelog`。
- **Create** `drizzle/<generated>.sql` — `drizzle-kit generate` 自动产出，勿手写。
- **Modify** `server/db.ts` — `releaseProject` 盖章+快照；`listProductRevisions` 关联 `snapshotChangelog`。
- **Modify** `server/routers/changelog.ts` — delete 加"已盖章不可删"守卫。
- **Create** `server/changelog-delete-guard.test.ts` — delete 守卫 router 测试（DB）。
- **Modify** `server/release.test.ts` — 新增"变更盖章"集成测试（自带含 `project_changelog` 的 cleanup3）。
- **Modify** `client/src/components/views/ProductLibraryView.tsx` — 时间线节点加可展开「本版本变更」。

---

## Task 1: 纯函数 buildRevisionChangelogSnapshot

**Files:**
- Create: `shared/changelog-snapshot.ts`
- Test: `shared/changelog-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

`shared/changelog-snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRevisionChangelogSnapshot, REVISION_CHANGE_STATUSES } from "@shared/changelog-snapshot";

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, status: "implemented", number: "ECN-001", type: "ecn", title: "改电芯",
    reason: "续航", decisionMaker: "张三", createdDate: "2026-06-02",
    costImpact: "+2元", scheduleImpact: "+3天", implementedDate: "2026-06-10",
    ...over,
  } as any;
}

describe("buildRevisionChangelogSnapshot", () => {
  it("只保留 implemented + approved，排除 proposed/rejected/cancelled", () => {
    const out = buildRevisionChangelogSnapshot([
      row({ id: 1, status: "implemented", number: "A" }),
      row({ id: 2, status: "approved", number: "B" }),
      row({ id: 3, status: "proposed", number: "C" }),
      row({ id: 4, status: "rejected", number: "D" }),
      row({ id: 5, status: "cancelled", number: "E" }),
    ]);
    expect(out.map((e) => e.number)).toEqual(["A", "B"]);
  });

  it("排序：createdDate asc(null 末尾) → number asc → id asc", () => {
    const out = buildRevisionChangelogSnapshot([
      row({ id: 10, status: "approved", number: "Z", createdDate: null }),
      row({ id: 11, status: "approved", number: "B", createdDate: "2026-06-05" }),
      row({ id: 12, status: "approved", number: "A", createdDate: "2026-06-05" }),
      row({ id: 13, status: "approved", number: "A", createdDate: "2026-06-01" }),
    ]);
    expect(out.map((e) => e.number)).toEqual(["A", "A", "B", "Z"]);
    // createdDate 2026-06-01(A) < 06-05(A,id12) < 06-05(B) < null(Z 末尾)
  });

  it("字段映射正确", () => {
    const [e] = buildRevisionChangelogSnapshot([row()]);
    expect(e).toEqual({
      number: "ECN-001", type: "ecn", title: "改电芯", reason: "续航",
      decisionMaker: "张三", costImpact: "+2元", scheduleImpact: "+3天", implementedDate: "2026-06-10",
    });
  });

  it("空输入 → 空数组", () => {
    expect(buildRevisionChangelogSnapshot([])).toEqual([]);
  });

  it("REVISION_CHANGE_STATUSES = implemented + approved", () => {
    expect([...REVISION_CHANGE_STATUSES].sort()).toEqual(["approved", "implemented"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/changelog-snapshot.test.ts`
Expected: FAIL（`Cannot find module '@shared/changelog-snapshot'`）

- [ ] **Step 3: Write the implementation**

`shared/changelog-snapshot.ts`:

```ts
export const REVISION_CHANGE_STATUSES = ["implemented", "approved"] as const;

export type RevisionChangeEntry = {
  number: string;
  type: string;
  title: string;
  reason: string | null;
  decisionMaker: string | null;
  costImpact: string | null;
  scheduleImpact: string | null;
  implementedDate: string | null;
};

export type ChangelogRowForSnapshot = {
  id: number;
  status: string;
  number: string;
  type: string;
  title: string;
  reason: string | null;
  decisionMaker: string | null;
  createdDate: string | null;
  costImpact: string | null;
  scheduleImpact: string | null;
  implementedDate: string | null;
};

const REVISION_STATUS_SET = new Set<string>(REVISION_CHANGE_STATUSES);

/**
 * 过滤进入版本的变更(implemented+approved) → 排序 → 映射成快照条目。
 * 排序：createdDate asc(null 末尾) → number asc → id asc。
 * 过滤对已过滤输入幂等(发布路径喂入 UPDATE…RETURNING 的行)。
 */
export function buildRevisionChangelogSnapshot(records: ChangelogRowForSnapshot[]): RevisionChangeEntry[] {
  return records
    .filter((r) => REVISION_STATUS_SET.has(r.status))
    .sort((a, b) => {
      const ad = a.createdDate ?? "￿";
      const bd = b.createdDate ?? "￿";
      if (ad !== bd) return ad < bd ? -1 : 1;
      if (a.number !== b.number) return a.number < b.number ? -1 : 1;
      return a.id - b.id;
    })
    .map((r) => ({
      number: r.number,
      type: r.type,
      title: r.title,
      reason: r.reason,
      decisionMaker: r.decisionMaker,
      costImpact: r.costImpact,
      scheduleImpact: r.scheduleImpact,
      implementedDate: r.implementedDate,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/changelog-snapshot.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: Commit**

```bash
git add shared/changelog-snapshot.ts shared/changelog-snapshot.test.ts
git commit -m "feat(变更↔版本): buildRevisionChangelogSnapshot 纯函数(过滤+排序+映射)"
```

---

## Task 2: Schema 列 + 索引 + 迁移

**Files:**
- Modify: `drizzle/schema.ts`（`projectChangelog` 表、`mpReleases` 表）
- Create: `drizzle/<generated>.sql`（由 drizzle-kit 生成）

- [ ] **Step 1: 给 projectChangelog 加 revisionId 列**

在 `drizzle/schema.ts` 的 `projectChangelog` 表，`productId` 列之后加一列（与现有列风格一致）：

```ts
    /** 溯源：变更挂在产品上（永久），projectId 为来源项目（可空） */
    productId: varchar("productId", { length: 32 }),
    /** 发布时盖章：本变更并入的产出版本(应用层关联，不加 DB FK；见 idxRevision) */
    revisionId: integer("revisionId"),
```

- [ ] **Step 2: 给 projectChangelog 加 revisionId 索引**

同表的索引回调里（`idxProjectTypeStatus` 之后）加：

```ts
    /** 反查：某版本并入了哪些变更 */
    idxRevision: index("idx_changelog_revision").on(table.revisionId),
```

- [ ] **Step 3: 给 mpReleases 加 snapshotChangelog 列**

在 `mpReleases` 表，`snapshotDocs` 列旁加一列（与 `snapshotBom` 的 `$type<unknown[]>` 惯例一致，避免 drizzle/→shared/ 跨导入；类型在读写边界处标注）：

```ts
    /** 发布快照：本版本并入的变更说明(不可变)；条目形状见 shared RevisionChangeEntry */
    snapshotChangelog: jsonb("snapshotChangelog").$type<unknown[]>().default([]),
```

- [ ] **Step 4: 生成迁移 SQL**

Run: `npx drizzle-kit generate`
Expected: `drizzle/` 下新增一个 `NNNN_*.sql`（含 `ALTER TABLE "project_changelog" ADD COLUMN "revisionId"`、`CREATE INDEX "idx_changelog_revision"`、`ALTER TABLE "mp_releases" ADD COLUMN "snapshotChangelog"`）+ `drizzle/meta/` 快照更新。**勿手改生成的 SQL。**

- [ ] **Step 5: 验证类型编译**

Run: `npx tsc --noEmit`
Expected: 无错误（`integer`/`jsonb`/`index` 均已在 schema.ts 顶部 import）。

- [ ] **Step 6: Commit**

```bash
git add drizzle/schema.ts drizzle/*.sql drizzle/meta
git commit -m "feat(变更↔版本): schema 加 changelog.revisionId(索引) + mpReleases.snapshotChangelog"
```

---

## Task 3: 发布盖章 + 快照（releaseProject）

**Files:**
- Modify: `server/db.ts`（`releaseProject` 事务内，约 db.ts:2597 建 rev 之后、db.ts:2606 写 mpReleases 之处）
- Test: `server/release.test.ts`（新增 describe + cleanup3）

- [ ] **Step 1: Write the failing integration test**

在 `server/release.test.ts` 末尾追加（复用文件内已有的 `addGate` / `completeDeliverables` 助手）：

```ts
const PID3 = "rel_test_product3";
const PRJ3 = "rel_test_project3";

async function cleanup3() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID3}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID3}`);
  await db.execute(sql`DELETE FROM project_changelog WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_deliverable_reviews WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_files WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_gate_reviews WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ3}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID3}`);
}

describe("MP Release 变更盖章", () => {
  beforeAll(async () => {
    await cleanup3();
    await createProduct({ id: PID3, name: "测试泵3", type: "finished", category: "充气泵", createdBy: 1 });
    await createProjectWithSeed(
      { id: PRJ3, name: "测试NPD3", projectNumber: "T3", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 2 } as any,
      "npd", 1,
    );
    await setProjectProduct(PRJ3, PID3);
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    // 4 条变更：2 应盖章(implemented/approved)、2 不盖章(proposed/rejected)
    await db!.execute(sql`INSERT INTO project_changelog ("projectId",number,type,title,status,"createdDate") VALUES
      (${PRJ3},'ECN-002','ecn','改结构','implemented','2026-06-05'),
      (${PRJ3},'ECN-001','ecn','改电芯','approved','2026-06-01'),
      (${PRJ3},'ECR-009','spec','待议','proposed','2026-06-03'),
      (${PRJ3},'ECR-010','cost','驳回','rejected','2026-06-04')`);
    await addGate("approved", 1, undefined, PRJ3);
    await completeDeliverables(PRJ3);
  });
  afterAll(cleanup3);

  it("发布后 implemented+approved 被盖章，proposed/rejected 仍为 null", async () => {
    await releaseProject({ projectId: PRJ3, actor: ACTOR });
    const revId = (await listProductRevisions(PID3))[0].id;
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    const r = await db!.execute(sql`SELECT number, "revisionId" FROM project_changelog WHERE "projectId"=${PRJ3} ORDER BY number`);
    const byNum = Object.fromEntries((r.rows as any[]).map((x) => [x.number, x.revisionId]));
    expect(byNum["ECN-001"]).toBe(revId);
    expect(byNum["ECN-002"]).toBe(revId);
    expect(byNum["ECR-009"]).toBeNull();
    expect(byNum["ECR-010"]).toBeNull();
  });

  it("mpReleases.snapshotChangelog = 盖章条目，按 createdDate→number→id 排序", async () => {
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    const r = await db!.execute(sql`SELECT "snapshotChangelog" FROM mp_releases WHERE "projectId"=${PRJ3}`);
    const snap = (r.rows[0] as any).snapshotChangelog as any[];
    expect(snap.map((e) => e.number)).toEqual(["ECN-001", "ECN-002"]); // 06-01 先于 06-05
    expect(snap[0].title).toBe("改电芯");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- release`
Expected: FAIL（snapshotChangelog 为空 `[]`、changelog.revisionId 仍 null —— 因 releaseProject 尚未盖章）。

- [ ] **Step 3: 在 releaseProject 里实现盖章 + 快照**

`server/db.ts` 顶部 import 区加：

```ts
import { buildRevisionChangelogSnapshot, REVISION_CHANGE_STATUSES, type RevisionChangeEntry } from "../shared/changelog-snapshot";
```

在 `releaseProject` 事务内，`const frozenBom = await freezeBomToRevision(...)`（db.ts:2604）之后、`await tx.insert(mpReleases).values({...})`（db.ts:2606）之前，插入：

```ts
    // 盖章：把本项目 implemented+approved 的变更并入新版本，并由返回行生成快照(集合天然一致)
    const stampedChanges = await tx.update(projectChangelog)
      .set({ revisionId: rev.id })
      .where(and(
        eq(projectChangelog.projectId, input.projectId),
        inArray(projectChangelog.status, [...REVISION_CHANGE_STATUSES]),
      ))
      .returning();
    const snapshotChangelog = buildRevisionChangelogSnapshot(stampedChanges as any);
```

然后在紧接着的 `tx.insert(mpReleases).values({ ... })` 对象里加一行字段：

```ts
      snapshotBom: frozenBom as unknown[],
      snapshotChangelog: snapshotChangelog as unknown[],
      openIssues: open as unknown[], notes: input.notes ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- release`
Expected: PASS（含新 describe；原有 release 用例不回归）。

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/release.test.ts
git commit -m "feat(变更↔版本): releaseProject 盖章 implemented+approved + 冻 snapshotChangelog"
```

---

## Task 4: 读路径 — listProductRevisions 带出 snapshotChangelog

**Files:**
- Modify: `server/db.ts`（`listProductRevisions`，db.ts:2269）
- Test: `server/release.test.ts`（在 Task 3 的 describe 里加一条断言）

- [ ] **Step 1: 加失败断言**

在 Task 3 的 `describe("MP Release 变更盖章")` 内追加：

```ts
  it("listProductRevisions 带出该版本的 snapshotChangelog", async () => {
    const rev = (await listProductRevisions(PID3))[0] as any;
    expect(rev.snapshotChangelog.map((e: any) => e.number)).toEqual(["ECN-001", "ECN-002"]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- release`
Expected: FAIL（`rev.snapshotChangelog` 为 undefined —— listProductRevisions 尚未关联）。

- [ ] **Step 3: 改 listProductRevisions LEFT JOIN mpReleases**

`server/db.ts:2269` 替换整个函数：

```ts
export async function listProductRevisions(productId: string): Promise<Array<ProductRevision & { snapshotChangelog: RevisionChangeEntry[] }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    rev: productRevisions,
    snapshotChangelog: mpReleases.snapshotChangelog,
  })
    .from(productRevisions)
    .leftJoin(mpReleases, eq(mpReleases.revisionId, productRevisions.id))
    .where(eq(productRevisions.productId, productId))
    .orderBy(productRevisions.id);
  return rows.map((r) => ({
    ...r.rev,
    snapshotChangelog: ((r.snapshotChangelog as RevisionChangeEntry[] | null) ?? []),
  }));
}
```

（`mpReleases`、`productRevisions`、`ProductRevision`、`eq` 均已在 db.ts import；`RevisionChangeEntry` 由 Task 3 的 import 引入。）

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- release`
Expected: PASS。

- [ ] **Step 5: 验证 tRPC 返回类型联动**

`server/routers/products.ts` 的 `revisions` 直接调 `listProductRevisions`，返回类型自动带上 `snapshotChangelog`，无需改路由。

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add server/db.ts server/release.test.ts
git commit -m "feat(变更↔版本): listProductRevisions 带出 snapshotChangelog(LEFT JOIN mpReleases)"
```

---

## Task 5: changelog delete 守卫（已盖章不可删）

**Files:**
- Modify: `server/routers/changelog.ts`（delete handler，changelog.ts:104-133）
- Test: `server/changelog-delete-guard.test.ts`

- [ ] **Step 1: Write the failing test**

`server/changelog-delete-guard.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { projects, projectChangelog } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { changelogRouter } from "./routers/changelog";

const PRJ = `cl-guard-${Date.now()}`;
const OWNER = 970001;

const makeCtx = (id: number, role = "user") => ({
  user: {
    id, role, name: "x", email: "x", canCreateProject: true, mobile: null,
    dingtalkUserId: null, dingtalkCorpUserId: null, passwordHash: null, username: null,
  },
});
const caller = (id: number) => changelogRouter.createCaller(makeCtx(id) as any);

let stampedId = 0;
let freeId = 0;

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({
    id: PRJ, name: "变更守卫", projectNumber: "CLG", category: "npd", risk: "low",
    currentPhase: "design", createdBy: OWNER, pmUserId: OWNER,
  } as any);
  const [stamped] = await db!.insert(projectChangelog).values({
    projectId: PRJ, number: "ECN-1", type: "ecn", title: "已盖章", status: "implemented",
    revisionId: 12345, creatorId: OWNER,
  } as any).returning({ id: projectChangelog.id });
  const [free] = await db!.insert(projectChangelog).values({
    projectId: PRJ, number: "ECR-1", type: "spec", title: "未盖章", status: "proposed",
    creatorId: OWNER,
  } as any).returning({ id: projectChangelog.id });
  stampedId = stamped.id; freeId = free.id;
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectChangelog).where(eq(projectChangelog.projectId, PRJ));
  await db!.delete(projects).where(eq(projects.id, PRJ));
});

describe("changelog delete 守卫", () => {
  it("已盖章(revisionId 非空)记录禁止删除", async () => {
    await expect(caller(OWNER).delete({ id: stampedId, projectId: PRJ })).rejects.toThrow(/不可删除/);
  });
  it("未盖章记录可正常删除", async () => {
    const res = await caller(OWNER).delete({ id: freeId, projectId: PRJ });
    expect(res.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- changelog-delete-guard`
Expected: FAIL（"已盖章记录禁止删除"用例：当前 delete 不拦截 → 不抛错）。

- [ ] **Step 3: 在 delete handler 加守卫**

`server/routers/changelog.ts` 的 delete handler，在取到 `record` 之后、`deleteProjectChangeRecord` 之前（即权限校验那段之后）插入：

```ts
      if (record.revisionId != null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "已并入发布版本的变更记录不可删除" });
      }

      await deleteProjectChangeRecord(input.id);
```

（`record` 来自 `getProjectChangelog`，Task 2 后其行已含 `revisionId`；`TRPCError` 已在文件顶部 import。）

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- changelog-delete-guard`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add server/routers/changelog.ts server/changelog-delete-guard.test.ts
git commit -m "feat(变更↔版本): changelog delete 守卫——已盖章记录不可删除"
```

---

## Task 6: UI — 版本时间线展开「本版本变更」

**Files:**
- Modify: `client/src/components/views/ProductLibraryView.tsx`（时间线 map，约 233-252）

- [ ] **Step 1: 扩展 revisions 行类型，加 snapshotChangelog**

把时间线 `.map` 的内联类型断言（ProductLibraryView.tsx:233）改为带上快照字段：

```tsx
              {(revisions as { id: number; revisionLabel: string; status: string; releasedAt: string | null; createdByProjectId: string | null; snapshotChangelog?: { number: string; type: string; title: string; reason: string | null }[] }[]).map((r, i) => (
```

- [ ] **Step 2: 在版本节点下渲染可展开变更段**

在该节点 `releasedAt` 那个 `<div className="text-[11px] font-mono text-stone-400 mt-0.5">…</div>` 之后、闭合 `</div>`（`flex-1 min-w-0` 那个）之前，插入：

```tsx
                    {r.status === 'released' && (
                      <details className="mt-1.5">
                        <summary className="text-[11px] text-stone-500 cursor-pointer select-none hover:text-stone-700">
                          本版本变更（{r.snapshotChangelog?.length ?? 0}）
                        </summary>
                        {(r.snapshotChangelog?.length ?? 0) === 0 ? (
                          <p className="text-[11px] text-stone-400 mt-1 pl-2">无登记变更</p>
                        ) : (
                          <ul className="mt-1 pl-2 space-y-1">
                            {r.snapshotChangelog!.map((c, ci) => (
                              <li key={ci} className="text-[11px] text-stone-600 flex gap-1.5">
                                <span className="font-mono px-1 bg-stone-100 text-stone-500 shrink-0">{c.type}</span>
                                <span className="min-w-0">
                                  <span className="text-stone-800">{c.title}</span>
                                  {c.reason ? <span className="text-stone-400"> — {c.reason}</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    )}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 浏览器验证（preview）**

启动 preview，进入产品库 → 打开某有量产发布的产品「版本时间线」→ 展开「本版本变更」，确认列出 type/title/reason；无变更的版本显示「无登记变更」。截图留证。

- [ ] **Step 5: Commit**

```bash
git add client/src/components/views/ProductLibraryView.tsx
git commit -m "feat(变更↔版本): 版本时间线展开展示本版本变更说明"
```

---

## 收尾

- [ ] **全量回归**：`npm test`（全绿）+ `npx tsc --noEmit`（零错）。
- [ ] **更新 memory**：`automation-feature-roadmap` 把「P2 变更↔版本关联」标为已完成（含本计划 commit）。
- [ ] **推送**：按并行会话约定只 stage 本特性文件；干净后 `git push origin main`。

## 明确不做（与 spec 一致）

手动改挂/移除版本归属；存量已发布版本回填；BOM diff + changelog 并排对比视图；跨版本聚合报表；"这条变更进了哪版"反查 UI。
