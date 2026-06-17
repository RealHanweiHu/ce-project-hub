# 交付物审核工作流（2b）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给交付物加审核态（提交→通过/驳回），Gate 就绪口径从"已上传"升级为"已审核通过"（存量豁免），通过后改文件自动回退待审，提交即钉钉提醒审核人。

**Architecture:** 新表 `project_deliverable_reviews`（节点+交付物一条审核记录）为单一事实源。纯函数 `isDeliverableSatisfied` 判定单个交付物是否满足；服务层 `deliverable-review-service.ts` 提供 submit/review/satisfiedSet/resetOnReupload（钉钉发送以可注入 dep 形式，便于测试，复用 `notifyUsersViaDingtalk`）。`getGateReadiness` 的就绪集合改读"已审核通过(含存量豁免)"。文件上传 `createProjectFile` 挂重审钩子。前端在交付物区加审核态徽标 + 提交/审核动作 + myPending 队列。

**Tech Stack:** Drizzle/Postgres、tRPC+zod、React+TanStack Query、Vitest（`node scripts/test.mjs`）、TS（`npm run check`）。pnpm。worktree：`feat/deliverable-review-2b`（已装依赖）。

参考规格：`docs/superpowers/specs/2026-06-16-deliverable-review-2b-design.md`

---

## File Structure
**新建**：`shared/deliverable-review.ts`（纯判定 + 类型）、`server/deliverable-review-service.ts`（服务层）、`server/routers/deliverableReviews.ts`（路由）、`server/deliverable-review.test.ts`（纯函数）、`server/deliverable-review-service.test.ts`（服务 DB 测试）、`server/deliverable-review-router.test.ts`（权限）、`server/deliverable-review-gate.test.ts`（就绪集成）。
**修改**：`drizzle/schema.ts`（表+enum+迁移）、`server/db.ts`（`getGateReadiness` 就绪集合 + `createProjectFile` 重审钩子）、`server/routers.ts`（注册）、`client/src/components/views/ProjectDetailView.tsx`（审核态 UI）、`client/src/components/NotificationBell.tsx`（myPending 角标，若结构允许）。

---

## Task 1: 纯判定函数 isDeliverableSatisfied

**Files:** Create `shared/deliverable-review.ts`; Test `server/deliverable-review.test.ts`

- [ ] **Step 1: 失败测试** `server/deliverable-review.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isDeliverableSatisfied, type DeliverableReviewStatus } from "@shared/deliverable-review";

describe("isDeliverableSatisfied", () => {
  it("无文件 → 不满足", () => {
    expect(isDeliverableSatisfied(false, null)).toBe(false);
    expect(isDeliverableSatisfied(false, "approved")).toBe(false);
  });
  it("有文件 + 无审核记录(存量豁免) → 满足", () => {
    expect(isDeliverableSatisfied(true, null)).toBe(true);
  });
  it("有文件 + 已通过 → 满足", () => {
    expect(isDeliverableSatisfied(true, "approved")).toBe(true);
  });
  it("有文件 + 待审/驳回 → 不满足", () => {
    expect(isDeliverableSatisfied(true, "pending" as DeliverableReviewStatus)).toBe(false);
    expect(isDeliverableSatisfied(true, "rejected")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑失败** `node scripts/test.mjs server/deliverable-review.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 实现** `shared/deliverable-review.ts`:
```ts
export const DELIVERABLE_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type DeliverableReviewStatus = (typeof DELIVERABLE_REVIEW_STATUSES)[number];

/**
 * 单个交付物是否满足 Gate 就绪：必须有文件，且（无审核记录=存量豁免视为通过，或已审核 approved）。
 */
export function isDeliverableSatisfied(
  hasFile: boolean,
  reviewStatus: DeliverableReviewStatus | null
): boolean {
  if (!hasFile) return false;
  return reviewStatus === null || reviewStatus === "approved";
}
```

- [ ] **Step 4: 跑通过** `node scripts/test.mjs server/deliverable-review.test.ts` → PASS

- [ ] **Step 5: 提交**
```bash
git add shared/deliverable-review.ts server/deliverable-review.test.ts
git commit -m "feat: isDeliverableSatisfied 纯判定(存量豁免)"
```

---

## Task 2: 数据模型 project_deliverable_reviews + 迁移

**Files:** Modify `drizzle/schema.ts`; Generate migration

- [ ] **Step 1: 加 enum + 表**（参照 `projectTailoring`/`projectDeliverableOverrides` 写法，放其附近）:
```ts
export const deliverableReviewStatusEnum = pgEnum("deliverable_review_status", ["pending", "approved", "rejected"]);

export const projectDeliverableReviews = pgTable(
  "project_deliverable_reviews",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    deliverableName: varchar("deliverableName", { length: 256 }).notNull(),
    status: deliverableReviewStatusEnum("status").notNull().default("pending"),
    reviewerUserId: integer("reviewerUserId").notNull(),
    submittedBy: integer("submittedBy").notNull(),
    submittedAt: timestamp("submittedAt").defaultNow().notNull(),
    reviewedBy: integer("reviewedBy"),
    reviewedAt: timestamp("reviewedAt"),
    reviewNote: text("reviewNote"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniq: uniqueIndex("uniq_deliverable_review").on(table.projectId, table.phaseId, table.deliverableName),
    idxReviewer: index("idx_deliverable_review_reviewer").on(table.reviewerUserId, table.status),
  })
);
export type ProjectDeliverableReview = typeof projectDeliverableReviews.$inferSelect;
export type InsertProjectDeliverableReview = typeof projectDeliverableReviews.$inferInsert;
```

- [ ] **Step 2: 生成迁移** `DATABASE_URL="postgres://postgres:cehub@127.0.0.1:55432/cehub" pnpm exec drizzle-kit generate` → 新建 `drizzle/00NN_*.sql`（CREATE TYPE deliverable_review_status + CREATE TABLE + 索引）。检查 SQL 只新增本表。

- [ ] **Step 3: tsc + 应用** `npm run check`（无 error）；`node scripts/test.mjs server/deliverable-review.test.ts`（运行器会迁移测试库）→ PASS。

- [ ] **Step 4: 提交**
```bash
git add drizzle/schema.ts drizzle/00*_*.sql drizzle/meta
git commit -m "feat(db): project_deliverable_reviews 表 + 迁移"
```

---

## Task 3: 服务层 deliverable-review-service

**Files:** Create `server/deliverable-review-service.ts`; Test `server/deliverable-review-service.test.ts`

依赖：`getDb`、`projectDeliverableReviews`/`projectFiles`/`projects` 表、drizzle `eq`/`and`/`inArray`、`isDeliverableSatisfied`（shared）、`notifyUsersViaDingtalk`（`server/_core/dingtalkMessage`，可注入）。钉钉以 `deps.notifyDingtalk` 注入（默认 `notifyUsersViaDingtalk`），测试传 mock。

- [ ] **Step 1: 失败测试** `server/deliverable-review-service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectFile } from "./db";
import { projects, projectFiles, projectDeliverableReviews } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  submitDeliverableReview, reviewDeliverable, getReviewSatisfiedSet,
  resetReviewOnReupload, getMyPendingReviews, listDeliverableReviews,
} from "./deliverable-review-service";

const PROJ = `dr-test-${Date.now()}`;
const PM = 920001, REVIEWER = 920002, SUBMITTER = 920003;
const notifs: { userIds: number[]; title: string }[] = [];
const deps = { notifyDingtalk: async (userIds: number[], title: string) => { notifs.push({ userIds, title }); } };

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({ id: PROJ, name: "审核测试", projectNumber: "DR-1", category: "npd", risk: "low", currentPhase: "design", createdBy: PM, pmUserId: PM });
});
afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
  await db!.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

async function addFile(name: string) {
  await createProjectFile({ projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: name, name: `${name}.pdf`, mimeType: "application/pdf", size: 1, storageKey: `k/${name}`, uploadedBy: SUBMITTER });
}

describe("deliverable review service", () => {
  it("submit → pending + 通知审核人", async () => {
    await addFile("ID外观图");
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: REVIEWER, submittedBy: SUBMITTER }, deps);
    const rows = await listDeliverableReviews(PROJ);
    expect(rows.find((r) => r.deliverableName === "ID外观图")?.status).toBe("pending");
    expect(notifs.some((n) => n.userIds.includes(REVIEWER))).toBe(true);
  });

  it("approved → 进入 satisfied 集", async () => {
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", reviewedBy: REVIEWER, note: null }, deps);
    const set = await getReviewSatisfiedSet(PROJ, "design", ["ID外观图"]);
    expect(set.has("ID外观图")).toBe(true);
  });

  it("存量豁免：有文件无审核记录 → satisfied", async () => {
    await addFile("MD结构图");
    const set = await getReviewSatisfiedSet(PROJ, "design", ["MD结构图"]);
    expect(set.has("MD结构图")).toBe(true);
  });

  it("pending/rejected → 不在 satisfied", async () => {
    await addFile("BOM");
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: "BOM", reviewerUserId: REVIEWER, submittedBy: SUBMITTER }, deps);
    let set = await getReviewSatisfiedSet(PROJ, "design", ["BOM"]);
    expect(set.has("BOM")).toBe(false);
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: "BOM", decision: "rejected", reviewedBy: REVIEWER, note: "缺料号" }, deps);
    set = await getReviewSatisfiedSet(PROJ, "design", ["BOM"]);
    expect(set.has("BOM")).toBe(false);
  });

  it("重审：approved 后 resetReviewOnReupload → 回 pending + 重新通知", async () => {
    notifs.length = 0;
    await resetReviewOnReupload(PROJ, "design", "ID外观图", deps);
    const rows = await listDeliverableReviews(PROJ);
    expect(rows.find((r) => r.deliverableName === "ID外观图")?.status).toBe("pending");
    expect(notifs.some((n) => n.userIds.includes(REVIEWER))).toBe(true);
  });

  it("myPending 只返回本人 pending", async () => {
    const mine = await getMyPendingReviews(REVIEWER);
    expect(mine.every((r) => r.reviewerUserId === REVIEWER && r.status === "pending")).toBe(true);
    expect(mine.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑失败** `node scripts/test.mjs server/deliverable-review-service.test.ts` → FAIL

- [ ] **Step 3: 实现** `server/deliverable-review-service.ts`:
```ts
import { getDb } from "./db";
import { projectDeliverableReviews, projectFiles, projects } from "../drizzle/schema";
import type { ProjectDeliverableReview } from "../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { isDeliverableSatisfied } from "../shared/deliverable-review";
import { notifyUsersViaDingtalk } from "./_core/dingtalkMessage";

export type ReviewDeps = { notifyDingtalk?: (userIds: number[], title: string, markdown: string) => Promise<void> };
const notify = (deps?: ReviewDeps) => deps?.notifyDingtalk ?? notifyUsersViaDingtalk;

export async function listDeliverableReviews(projectId: string): Promise<ProjectDeliverableReview[]> {
  const db = await getDb(); if (!db) return [];
  return db.select().from(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, projectId));
}

export async function getMyPendingReviews(reviewerUserId: number): Promise<ProjectDeliverableReview[]> {
  const db = await getDb(); if (!db) return [];
  return db.select().from(projectDeliverableReviews)
    .where(and(eq(projectDeliverableReviews.reviewerUserId, reviewerUserId), eq(projectDeliverableReviews.status, "pending")));
}

async function findReview(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, projectId: string, phaseId: string, deliverableName: string) {
  const rows = await db.select().from(projectDeliverableReviews)
    .where(and(eq(projectDeliverableReviews.projectId, projectId), eq(projectDeliverableReviews.phaseId, phaseId), eq(projectDeliverableReviews.deliverableName, deliverableName)));
  return rows[0] ?? null;
}

export async function submitDeliverableReview(
  input: { projectId: string; phaseId: string; deliverableName: string; reviewerUserId: number; submittedBy: number },
  deps?: ReviewDeps
): Promise<void> {
  const db = await getDb(); if (!db) throw new Error("no db");
  const existing = await findReview(db, input.projectId, input.phaseId, input.deliverableName);
  if (existing) {
    await db.update(projectDeliverableReviews).set({
      status: "pending", reviewerUserId: input.reviewerUserId, submittedBy: input.submittedBy,
      submittedAt: new Date(), reviewedBy: null, reviewedAt: null, reviewNote: null,
    }).where(eq(projectDeliverableReviews.id, existing.id));
  } else {
    await db.insert(projectDeliverableReviews).values({
      projectId: input.projectId, phaseId: input.phaseId, deliverableName: input.deliverableName,
      status: "pending", reviewerUserId: input.reviewerUserId, submittedBy: input.submittedBy,
    });
  }
  try { await notify(deps)([input.reviewerUserId], "交付物待审核", `项目交付物「${input.deliverableName}」待你审核`); } catch { /* best-effort */ }
}

export async function reviewDeliverable(
  input: { projectId: string; phaseId: string; deliverableName: string; decision: "approved" | "rejected"; reviewedBy: number; note: string | null },
  deps?: ReviewDeps
): Promise<void> {
  const db = await getDb(); if (!db) throw new Error("no db");
  const existing = await findReview(db, input.projectId, input.phaseId, input.deliverableName);
  if (!existing || existing.status !== "pending") throw new Error("仅待审交付物可审核");
  await db.update(projectDeliverableReviews).set({
    status: input.decision, reviewedBy: input.reviewedBy, reviewedAt: new Date(), reviewNote: input.note,
  }).where(eq(projectDeliverableReviews.id, existing.id));
  if (input.decision === "rejected") {
    try { await notify(deps)([existing.submittedBy], "交付物被驳回", `「${input.deliverableName}」被驳回${input.note ? "：" + input.note : ""}`); } catch { /* best-effort */ }
  }
}

/** 上传新版本后：若已 approved/rejected → 回退 pending + 重新提醒审核人。无记录则不动。 */
export async function resetReviewOnReupload(projectId: string, phaseId: string, deliverableName: string, deps?: ReviewDeps): Promise<void> {
  const db = await getDb(); if (!db) return;
  const existing = await findReview(db, projectId, phaseId, deliverableName);
  if (!existing || existing.status === "pending") return;
  await db.update(projectDeliverableReviews).set({ status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null, submittedAt: new Date() })
    .where(eq(projectDeliverableReviews.id, existing.id));
  try { await notify(deps)([existing.reviewerUserId], "交付物已更新待重审", `「${deliverableName}」已上传新版本，待你重新审核`); } catch { /* best-effort */ }
}

/** 某节点已"满足"的交付物名集合（有文件 且 (无审核记录 或 approved)），与 requiredNames 求交。 */
export async function getReviewSatisfiedSet(projectId: string, phaseId: string, requiredNames: string[]): Promise<Set<string>> {
  const db = await getDb(); if (!db || requiredNames.length === 0) return new Set();
  const files = await db.select({ deliverableName: projectFiles.deliverableName }).from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.phaseId, phaseId)));
  const haveFile = new Set(files.map((f) => f.deliverableName).filter((n): n is string => !!n));
  const reviews = await db.select().from(projectDeliverableReviews)
    .where(and(eq(projectDeliverableReviews.projectId, projectId), eq(projectDeliverableReviews.phaseId, phaseId)));
  const statusByName = new Map(reviews.map((r) => [r.deliverableName, r.status]));
  const out = new Set<string>();
  for (const name of requiredNames) {
    if (isDeliverableSatisfied(haveFile.has(name), statusByName.get(name) ?? null)) out.add(name);
  }
  return out;
}
```
> 确认 `createProjectFile` 入参含 `uploadedBy`（读 `server/db.ts` 的签名，按实际字段名调整测试里的 addFile）。`projectFiles.phaseId` 用于按节点取文件。

- [ ] **Step 4: 跑通过** `node scripts/test.mjs server/deliverable-review-service.test.ts` → PASS（6 passed）

- [ ] **Step 5: 提交**
```bash
git add server/deliverable-review-service.ts server/deliverable-review-service.test.ts
git commit -m "feat: 交付物审核服务层(submit/review/satisfiedSet/reupload, 钉钉可注入)"
```

---

## Task 4: tRPC 路由 deliverableReviews + 注册

**Files:** Create `server/routers/deliverableReviews.ts`; Modify `server/routers.ts`; Test `server/deliverable-review-router.test.ts`

权限：submit 需项目可编辑（PM/owner/admin/有 canEditTasks 成员）——复用 `routers/tailoring.ts` 的 `assertCanProposeOrOverride` 同款判定（读它照搬）。review 仅 `reviewerUserId` 或 admin。

- [ ] **Step 1: 失败测试** `server/deliverable-review-router.test.ts`（权限，仿 `tailoring-router-perms.test.ts` 的 createCaller/ctx）：
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectFile } from "./db";
import { projects, projectFiles, projectDeliverableReviews, projectMembers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { deliverableReviewsRouter } from "./routers/deliverableReviews";

const PROJ = `drr-${Date.now()}`;
const PM = 930001, REVIEWER = 930002, OUTSIDER = 930003;
const makeCtx = (id: number, role: string) => ({ user: { id, role, name: "x", email: "x", canCreateProject: true, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null, passwordHash: null, username: null } });
const caller = (id: number, role: string) => deliverableReviewsRouter.createCaller(makeCtx(id, role) as any);

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({ id: PROJ, name: "审核路由", projectNumber: "DRR-1", category: "npd", risk: "low", currentPhase: "design", createdBy: PM, pmUserId: PM });
  await db!.insert(projectMembers).values({ projectId: PROJ, userId: PM, role: "pm" });
  await createProjectFile({ projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: "ID外观图", name: "id.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/id", uploadedBy: PM });
});
afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
  await db!.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db!.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

describe("deliverableReviews 权限", () => {
  it("非成员 submit → FORBIDDEN", async () => {
    await expect(caller(OUTSIDER, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: REVIEWER })).rejects.toThrow();
  });
  it("PM submit → ok", async () => {
    await expect(caller(PM, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: REVIEWER })).resolves.toBeTruthy();
  });
  it("非审核人 review → FORBIDDEN", async () => {
    await expect(caller(OUTSIDER, "user").review({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", note: null })).rejects.toThrow();
  });
  it("审核人 review → ok", async () => {
    await expect(caller(REVIEWER, "user").review({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", note: null })).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑失败** `node scripts/test.mjs server/deliverable-review-router.test.ts` → FAIL

- [ ] **Step 3: 实现路由** `server/routers/deliverableReviews.ts`:
```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { projects, projectMembers, projectDeliverableReviews } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { listDeliverableReviews, getMyPendingReviews, submitDeliverableReview, reviewDeliverable } from "../deliverable-review-service";

async function assertCanEdit(projectId: string, user: { id: number; role: string }) {
  if (user.role === "admin") return;
  const db = await getDb();
  const [proj] = await db!.select({ pmUserId: projects.pmUserId, createdBy: projects.createdBy }).from(projects).where(eq(projects.id, projectId));
  if (!proj) throw new TRPCError({ code: "NOT_FOUND" });
  if (proj.pmUserId === user.id || proj.createdBy === user.id) return;
  const m = await db!.select({ role: projectMembers.role }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)));
  if (m[0] && (m[0].role === "pm" || m[0].role === "owner" || m[0].role === "manager" || m[0].role === "member")) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "无编辑权限" });
}

export const deliverableReviewsRouter = router({
  list: protectedProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => listDeliverableReviews(input.projectId)),
  myPending: protectedProcedure.query(({ ctx }) => getMyPendingReviews(ctx.user.id)),
  submit: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), deliverableName: z.string().min(1), reviewerUserId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanEdit(input.projectId, ctx.user);
      const db = await getDb();
      const [proj] = await db!.select({ pmUserId: projects.pmUserId }).from(projects).where(eq(projects.id, input.projectId));
      const reviewerUserId = input.reviewerUserId ?? proj?.pmUserId;
      if (!reviewerUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "未指定审核人且项目无 PM" });
      await submitDeliverableReview({ projectId: input.projectId, phaseId: input.phaseId, deliverableName: input.deliverableName, reviewerUserId, submittedBy: ctx.user.id });
      return { success: true } as const;
    }),
  review: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), deliverableName: z.string().min(1), decision: z.enum(["approved", "rejected"]), note: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [r] = await db!.select({ reviewerUserId: projectDeliverableReviews.reviewerUserId })
        .from(projectDeliverableReviews)
        .where(and(eq(projectDeliverableReviews.projectId, input.projectId), eq(projectDeliverableReviews.phaseId, input.phaseId), eq(projectDeliverableReviews.deliverableName, input.deliverableName)));
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "无该审核记录" });
      if (ctx.user.role !== "admin" && r.reviewerUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "仅指定审核人可审" });
      await reviewDeliverable({ projectId: input.projectId, phaseId: input.phaseId, deliverableName: input.deliverableName, decision: input.decision, reviewedBy: ctx.user.id, note: input.note ?? null });
      return { success: true } as const;
    }),
});
```
> 确认 `protectedProcedure`/`router` 路径与 `ctx.user` 形状（照 `routers/tailoring.ts`）。`projectMembers.role` 取值集合以 schema 实际为准。

- [ ] **Step 4: 注册** 在 `server/routers.ts` 加 `deliverableReviews: deliverableReviewsRouter,`（紧邻 `gateReviews:`）+ 顶部 import。

- [ ] **Step 5: 跑通过 + tsc** `node scripts/test.mjs server/deliverable-review-router.test.ts` → PASS；`npm run check` → 0 error。

- [ ] **Step 6: 提交**
```bash
git add server/routers/deliverableReviews.ts server/routers.ts server/deliverable-review-router.test.ts
git commit -m "feat: deliverableReviews 路由(submit/review/list/myPending) + 权限"
```

---

## Task 5: getGateReadiness 就绪口径升级

**Files:** Modify `server/db.ts`（`getGateReadiness`）; Test `server/deliverable-review-gate.test.ts`

把 `getGateReadiness` 里的 `uploaded` 集合改为 `getReviewSatisfiedSet(projectId, phaseId, required)` 的结果（required 仍是裁剪有效集）。

- [ ] **Step 1: 失败测试** `server/deliverable-review-gate.test.ts`：
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, getGateReadiness, createProjectFile } from "./db";
import { projects, projectFiles, projectDeliverableReviews } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { submitDeliverableReview, reviewDeliverable } from "./deliverable-review-service";
import { getPhasesForCategory } from "../shared/sop-templates";

const PROJ = `drg-${Date.now()}`;
const U = 940001;
const deps = { notifyDingtalk: async () => {} };
// 取 design 阶段第一个 required 交付物名
const design = getPhasesForCategory("npd").find((p) => p.id === "design")!;
const DELIV = design.gateStandard.requiredDeliverables[0];

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({ id: PROJ, name: "就绪审核", projectNumber: "DRG-1", category: "npd", risk: "low", currentPhase: "design", createdBy: U, pmUserId: U });
  await createProjectFile({ projectId: PROJ, phaseId: "design", taskId: design.gateTaskId, deliverableName: DELIV, name: "f.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/f", uploadedBy: U });
});
afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
  await db!.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

describe("getGateReadiness 审核口径", () => {
  it("有文件但待审 → 该交付物不计入已满足", async () => {
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: DELIV, reviewerUserId: U, submittedBy: U }, deps);
    const r = await getGateReadiness(PROJ, "design");
    const deliv = r!.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(deliv.blockers.some((b) => b.includes(DELIV))).toBe(true); // 仍缺
  });
  it("审核通过 → 计入已满足", async () => {
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: DELIV, decision: "approved", reviewedBy: U, note: null }, deps);
    const r = await getGateReadiness(PROJ, "design");
    const deliv = r!.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(deliv.blockers.some((b) => b.includes(DELIV))).toBe(false);
  });
});
```
> `GateReadiness.dimensions` 的 deliverables 维度 `blockers` 列缺失项——以 `shared/gate-readiness.ts` 实际结构为准，断言字段按实际调整。

- [ ] **Step 2: 跑失败** `node scripts/test.mjs server/deliverable-review-gate.test.ts` → FAIL（待审仍被算满足）

- [ ] **Step 3: 改 getGateReadiness**（`server/db.ts` ~1921-1923）。现有：
```ts
  const gateFiles = await getProjectFiles(projectId, phaseId, phase.gateTaskId);
  const uploaded = Array.from(new Set(
    gateFiles.map((f) => f.deliverableName).filter((n): n is string => !!n && required.includes(n))
  ));
```
改为（用审核满足集；保留 gateFiles 取数不变即可，但 uploaded 改读 satisfiedSet）：
```ts
  const { getReviewSatisfiedSet } = await import("./deliverable-review-service");
  const uploaded = Array.from(await getReviewSatisfiedSet(projectId, phaseId, required));
```
（`required` 即上文裁剪后的有效集；`getReviewSatisfiedSet` 内部已校验"有文件且(无记录或approved)"。动态 import 避免循环依赖。）

- [ ] **Step 4: 跑通过 + 回归** `node scripts/test.mjs server/deliverable-review-gate.test.ts server/gate-readiness-db.test.ts server/release-gate.test.ts` → PASS。
> 注：`gate-readiness-db.test.ts`/`release-gate.test.ts` 若断言"有文件即就绪"，现在改为"有文件且(无记录豁免)"——存量豁免下无审核记录仍满足，应仍通过。若某用例显式建了 pending 记录则需同步调整（按实际）。

- [ ] **Step 5: 提交**
```bash
git add server/db.ts server/deliverable-review-gate.test.ts
git commit -m "feat: Gate 就绪交付物口径升级为已审核通过(存量豁免)"
```

---

## Task 6: 文件上传重审钩子

**Files:** Modify `server/db.ts`（`createProjectFile`）; Test 扩展 `server/deliverable-review-service.test.ts`（已覆盖 resetReviewOnReupload，本任务验证 createProjectFile 自动触发）

- [ ] **Step 1: 失败测试**（在 service 测试里加一例：approved 后再 createProjectFile 同名 → 自动回 pending）：
```ts
  it("createProjectFile 自动触发重审：approved 后传新版本 → pending", async () => {
    // 复用上文 "ID外观图" 已 approved → 再传一版
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", reviewedBy: REVIEWER, note: null }, deps).catch(() => {});
    await addFile("ID外观图");
    const rows = await listDeliverableReviews(PROJ);
    expect(rows.find((r) => r.deliverableName === "ID外观图")?.status).toBe("pending");
  });
```
> 该用例依赖 createProjectFile 内部调用 resetReviewOnReupload。

- [ ] **Step 2: 跑失败** → FAIL（createProjectFile 未触发回退）

- [ ] **Step 3: 改 createProjectFile**（`server/db.ts`）。在成功写入文件、且 `deliverableName` 与 `phaseId` 均非空后，调用回退：
```ts
  // 写入文件后（拿到 id 之后），若关联交付物则触发重审钩子
  if (input.deliverableName && input.phaseId) {
    const { resetReviewOnReupload } = await import("./deliverable-review-service");
    await resetReviewOnReupload(input.projectId, input.phaseId, input.deliverableName);
  }
```
> 读 `createProjectFile` 现有签名/字段名（`input.deliverableName`/`input.phaseId`/`input.projectId`，按实际）。动态 import 避免循环依赖。钩子内部 best-effort，不影响上传返回。

- [ ] **Step 4: 跑通过** `node scripts/test.mjs server/deliverable-review-service.test.ts` → PASS。

- [ ] **Step 5: 提交**
```bash
git add server/db.ts server/deliverable-review-service.test.ts
git commit -m "feat: createProjectFile 上传新版本自动触发交付物重审"
```

---

## Task 7: 前端 — 审核态徽标 + 提交/审核 + myPending 角标

**Files:** Modify `client/src/components/views/ProjectDetailView.tsx`、`client/src/components/NotificationBell.tsx`

CLIENT，验证门 `npm run check`。先读 ProjectDetailView 的交付物区（Task 上次做的 `DeliverablesChecklist` + `GateDeliverableOverridePanel` 附近，~line 1390-1420 + 660）与 `NotificationBell` 结构。

- [ ] **Step 1: 交付物审核态 UI**
在 Gate 交付物区，用 `trpc.deliverableReviews.list.useQuery({ projectId })` 取审核记录，按 `(phaseId, deliverableName)` 映射到当前 gate 阶段。为每个交付物显示徽标：
  - 无记录 + 有文件 → "已上传"（存量豁免，无需审）；无文件 → "缺文件"。
  - pending → "待审 · <审核人名>"；approved → "通过 · <审核人名>"；rejected → "驳回 · <意见>"。
提交人（`perms.canEditTasks`）在"已上传/驳回"态显示「提交审核」→ 弹一个选审核人的轻量下拉（项目成员，默认 PM），调 `trpc.deliverableReviews.submit.useMutation`。审核人（`record.reviewerUserId === user.id` 或 admin）在 pending 态显示「通过 / 驳回(填意见)」→ `review` mutation。每次 mutation 后 invalidate `deliverableReviews.list` 与 `gateReviews.readiness`（若有）/`tailoring.effectiveProcess`。
样式沿用线框：徽标 `text-[11px] px-2 py-0.5 rounded-full`，成功/警告/危险用 `--color-*-success/warning/danger`。组件可抽成 `DeliverableReviewControls`（同文件内局部组件）保持 ProjectDetailView 可读。

- [ ] **Step 2: myPending 角标**
在 `NotificationBell` 用 `trpc.deliverableReviews.myPending.useQuery()`，若 `data.length>0` 在铃铛角标里并入计数；点开通知面板列出"待你审核的交付物"（项目名/阶段/交付物名），点击跳到对应项目。若 NotificationBell 结构不便，最小实现：仅在角标计数并入 myPending 数，列表项放项目内。以 tsc 通过为准。

- [ ] **Step 3: tsc** `npm run check` → 0 error（按 `server/routers/deliverableReviews.ts` 实际 query/mutation 形状修类型）。

- [ ] **Step 4: 提交**
```bash
git add client/src/components/views/ProjectDetailView.tsx client/src/components/NotificationBell.tsx
git commit -m "feat: 交付物审核态徽标 + 提交/通过/驳回 + 待审角标"
```

---

## Task 8: 全量校验

- [ ] **Step 1:** `npm run check` → 0 error；`node scripts/test.mjs` → 全绿（新增 4 个测试文件 + 既有无回归）。
- [ ] **Step 2:** `npm run build` → 成功（esbuild 缺则 `pnpm rebuild esbuild` 再试）。
- [ ] **Step 3:** `git add -A && git commit -m "chore: 2b 全量校验" || echo "无额外变更"`。

---

## Self-Review 记录
- **Spec 覆盖**：表(Task2) ✓；纯判定+存量豁免(Task1) ✓；服务 submit/review/satisfied/reupload/myPending + 钉钉可注入(Task3) ✓；路由+权限(Task4) ✓；就绪口径升级(Task5) ✓；上传重审钩子(Task6) ✓；前端徽标+提交/审核+myPending(Task7) ✓。
- **类型一致**：`DeliverableReviewStatus`(shared)↔ enum(schema)；`isDeliverableSatisfied` Task1 定义、Task3 用；`getReviewSatisfiedSet` Task3 定义、Task5 用；`resetReviewOnReupload` Task3 定义、Task6 用；router 形状 Task4 定义、Task7 消费。
- **占位符**：无 TBD；id（design/d8/requiredDeliverables[0]）标注"按 sop-templates 实际核对"。
- **风险点**：`createProjectFile`/`getGateReadiness`/`GateReadiness.dimensions`/`ProjectDetailView`/`NotificationBell` 的确切字段以现有代码为准（各任务已标"读现有实现按实调整"）。钉钉发送 best-effort 不阻塞。
