# 任务详情改版（两栏 + 4标签 + 逐任务审批闸门）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把任务详情弹窗改成 Linear 两栏（主栏 + 属性栏）+ 4 标签（评论/活动/流转/状态审批），并新增「逐任务、默认关」的审批闸门：开启后任务勾完成→待审批→审批人通过才真正完成。

**Architecture:** 后端先行（schema 枚举/列 + 迁移 → db.ts 完成/审批/活动单写层 → tasks 路由），再前端（状态文案补「待审批」→ 弹窗两栏重构 → 4 标签）。`completed` 只在审批通过后为 true；`requiresApproval` 默认 false → 零回归。

**Tech Stack:** drizzle(pg) + tRPC + vitest（server 单测）+ React/Tailwind；preview 走查前端。

**规格：** `docs/superpowers/specs/2026-06-25-task-detail-redesign-design.md`。**分支：** 当前分支（`feat-product-simplify`）或新建 `feat-task-detail`。

**前置事实（已核对，行号见 spec §3）：**
- `drizzle/schema.ts:455` `TASK_STATUSES`；`:460` `taskStatusEnum`；`project_tasks` 表 `:467+`。
- `server/db.ts`：`automaticTaskStatus`(1833)、`refreshProjectTaskStatuses`(1880)、`setTaskCompletion`(1964)、`createActivityLog`(~1748)、`getActivityLogs`(~1766)。
- `server/routers/tasks.ts`：`setCompleted`(写盲 task.complete/uncomplete)、`setMeta`、`setDeliverable`。
- 前端状态文案：`KanbanBoard.tsx:5`、`TaskListView.tsx:56`、`CalendarPage.tsx:130`、`ProjectDetailView.tsx:1110`。
- 任务弹窗：`ProjectDetailView.tsx` ~2407–2702，含 `TaskDetail`(1030)。
- **并行会话热点**：`drizzle/schema.ts`、`server/db.ts`、`server/routers/tasks.ts`、`ProjectDetailView.tsx`。每个 Task 提交**只 stage 自己改的文件**；冲突时用 `git apply --cached` 隔离。

---

## Task 1: schema 枚举 + 审批列 + 幂等迁移

**Files:** `drizzle/schema.ts`；`drizzle/`(生成迁移)

- [ ] **Step 1: 改 schema** —— `drizzle/schema.ts`
  - `TASK_STATUSES` 改为 `["todo","in_progress","blocked","done","skipped","pending_approval"] as const;`
  - 新增枚举：`export const TASK_APPROVAL_STATUSES = ["none","pending","approved","rejected"] as const; export type TaskApprovalStatus = (typeof TASK_APPROVAL_STATUSES)[number]; export const taskApprovalStatusEnum = pgEnum("task_approval_status", TASK_APPROVAL_STATUSES);`
  - `project_tasks` 表对象里加列：
    ```ts
    requiresApproval: boolean("requiresApproval").notNull().default(false),
    approverUserId: integer("approverUserId"),
    approvalStatus: taskApprovalStatusEnum("approvalStatus").notNull().default("none"),
    approvalNote: text("approvalNote"),
    approvalRequestedBy: integer("approvalRequestedBy"),
    approvalRequestedAt: timestamp("approvalRequestedAt"),
    approvalDecidedBy: integer("approvalDecidedBy"),
    approvalDecidedAt: timestamp("approvalDecidedAt"),
    ```
- [ ] **Step 2: 生成迁移草稿** —— `export $(grep -E '^DATABASE_URL=' .env | xargs) && npx drizzle-kit generate`，记下新生成的 `drizzle/XXXX_*.sql`。
- [ ] **Step 3: 手工改写迁移为幂等**（spec §5）—— 编辑生成的 sql，确保顺序与写法：
  ```sql
  ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'pending_approval';
  --> statement-breakpoint
  DO $$ BEGIN
    CREATE TYPE "task_approval_status" AS ENUM ('none','pending','approved','rejected');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  --> statement-breakpoint
  ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "requiresApproval" boolean DEFAULT false NOT NULL;
  ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approverUserId" integer;
  ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalStatus" "task_approval_status" DEFAULT 'none' NOT NULL;
  ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalNote" text;
  ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalRequestedBy" integer;
  ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalRequestedAt" timestamp;
  ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalDecidedBy" integer;
  ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalDecidedAt" timestamp;
  ```
  （`ALTER TYPE ... ADD VALUE` 不能与「使用该值」同事务；本迁移不使用，OK。若 migrator 整文件包事务导致 PG 报错，把 `ADD VALUE` 拆到单独一个先序迁移文件。）
- [ ] **Step 4: 应用 + 验证** —— `export $(grep -E '^DATABASE_URL=' .env | xargs) && npx drizzle-kit migrate && npx tsc --noEmit`。再连库 `\d project_tasks` 确认新列存在、`SELECT enum_range(NULL::task_status)` 含 `pending_approval`。Expected: 迁移成功，tsc 绿。
- [ ] **Step 5: Commit** —— `git add drizzle/schema.ts drizzle/<新迁移>.sql drizzle/meta && git commit -m "feat(task-approval): schema 加 pending_approval 状态 + 审批列 + 幂等迁移"`

---

## Task 2: `automaticTaskStatus` 保留 pending_approval（TDD）

**Files:** `server/db.ts:1833`；Test: `server/task-approval.test.ts`(新建)

- [ ] **Step 1: 写失败测试** —— 新建 `server/task-approval.test.ts`：
  ```ts
  import { describe, it, expect } from "vitest";
  import { __test_automaticTaskStatus as autoStatus } from "./db";

  // 一个最小 ProjectTask（按需补全必填字段；以仓库现有 ProjectTask 类型为准）
  const base = (over: Partial<any>) => ({
    id: 1, projectId: "p1", phaseId: "ph1", taskId: "t1",
    status: "todo", completed: false, completedAt: null,
    startDate: null, dueDate: null, assigneeUserId: null,
    deliverables: {}, instructions: "", priority: "medium",
    requiresApproval: false, approvalStatus: "none",
    ...over,
  });

  describe("automaticTaskStatus 保留 pending_approval", () => {
    it("pending_approval 不被重算覆盖、completed 为 false", () => {
      const rows = [base({ status: "pending_approval" })];
      const out = autoStatus(rows, "npd", "2026-06-25");
      expect(out[0].status).toBe("pending_approval");
      expect(out[0].completed).toBe(false);
    });
  });
  ```
  （若 `automaticTaskStatus`/`applyAutomaticTaskStatuses` 未导出：在 db.ts 末尾加 `export const __test_automaticTaskStatus = applyAutomaticTaskStatuses;`。）
- [ ] **Step 2: 跑测试看失败** —— `export $(grep -E '^DATABASE_URL=' .env | xargs) && npx vitest run server/task-approval.test.ts`。Expected: FAIL（pending_approval 被重算成 todo/blocked）。
- [ ] **Step 3: 实现** —— `server/db.ts` `automaticTaskStatus`（1839 行附近），在 `if (task.status === "skipped") return "skipped";` 之后加：
  ```ts
  if (task.status === "pending_approval") return "pending_approval";
  ```
  并确保 db.ts 末尾导出 `export const __test_automaticTaskStatus = applyAutomaticTaskStatuses;`
- [ ] **Step 4: 跑测试看通过** —— 同 Step 2 命令。Expected: PASS。
- [ ] **Step 5: Commit** —— `git add server/db.ts server/task-approval.test.ts && git commit -m "feat(task-approval): automaticTaskStatus 显式保留 pending_approval"`

---

## Task 3: `setTaskCompletion` 返回 outcome + 单写日志 + 需审批分支（TDD）

**Files:** `server/db.ts:1964`；Test: `server/task-approval.test.ts`

设计：`setTaskCompletion` 返回 `{ outcome: "completed"|"uncompleted"|"submitted" }`，并在内部按 outcome 写**唯一**活动日志（`task.complete`/`task.uncomplete`/`task.submit_approval`，meta 含 `phaseId`）。

- [ ] **Step 1: 写失败测试**（接入真实 DB；参考 `server/products.test.ts` 的 DB 起测方式）—— 在 `server/task-approval.test.ts` 加：
  ```ts
  import { setTaskCompletion, upsertProjectTask, getDb } from "./db";
  // 用现有测试夹具创建一个 project + 一个 task 行（参考 products.test.ts 建数据方式）
  it("需审批任务勾完成 → pending_approval、completed=false、approvalStatus=pending、outcome=submitted", async () => {
    // 准备：upsertProjectTask 设 requiresApproval=true, approverUserId=2
    // 执行：const r = await setTaskCompletion(projectId, phaseId, taskId, true, 3);
    // 断言：r.outcome === "submitted"; 行 status==="pending_approval", completed===false, approvalStatus==="pending", approvalRequestedBy===3
    // 且 activity_logs 该任务只多一条 action==="task.submit_approval"（无 task.complete）
  });
  it("普通任务勾完成 → done、outcome=completed", async () => {
    // requiresApproval=false → r.outcome==="completed", status done, completed true
  });
  ```
  （建数据/查 activity_logs 的写法对齐 `server/products.test.ts`；taskId/phaseId 用唯一值避免串扰。）
- [ ] **Step 2: 跑测试看失败** —— `npx vitest run server/task-approval.test.ts`。Expected: FAIL。
- [ ] **Step 3: 实现** —— 改 `server/db.ts` `setTaskCompletion`（1964）：
  ```ts
  export type CompletionOutcome = "completed" | "uncompleted" | "submitted";
  export async function setTaskCompletion(
    projectId: string, phaseId: string, taskId: string,
    completed: boolean, updatedBy?: number | null
  ): Promise<{ outcome: CompletionOutcome }> {
    const db = await getDb();
    const current = db ? (await db.select().from(projectTasks)
      .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.phaseId, phaseId), eq(projectTasks.taskId, taskId))).limit(1))[0] : null;
    const requiresApproval = !!current?.requiresApproval;

    if (completed && requiresApproval) {
      await upsertProjectTask(projectId, phaseId, taskId, {
        completed: false, status: "pending_approval",
        approvalStatus: "pending", approvalRequestedBy: updatedBy ?? null,
        approvalRequestedAt: new Date(), updatedBy: updatedBy ?? null,
      });
      await refreshProjectTaskStatuses(projectId);
      await createActivityLog({ projectId, userId: updatedBy ?? null, action: "task.submit_approval",
        entityType: "task", entityId: taskId, meta: { phaseId, approver: current?.approverUserId ?? null } });
      return { outcome: "submitted" };
    }

    if (completed) {
      await upsertProjectTask(projectId, phaseId, taskId, { completed: true, status: "done", completedAt: new Date(), updatedBy: updatedBy ?? null });
      await refreshProjectTaskStatuses(projectId);
      await createActivityLog({ projectId, userId: updatedBy ?? null, action: "task.complete", entityType: "task", entityId: taskId, meta: { phaseId } });
      return { outcome: "completed" };
    }

    // 取消勾选（含撤回 pending_approval）：清审批待审，status 交 refresh 归位
    await upsertProjectTask(projectId, phaseId, taskId, {
      completed: false, status: "todo", completedAt: null,
      approvalStatus: "none", approvalRequestedBy: null, approvalRequestedAt: null,
      updatedBy: updatedBy ?? null,
    });
    await refreshProjectTaskStatuses(projectId);
    await createActivityLog({ projectId, userId: updatedBy ?? null, action: "task.uncomplete", entityType: "task", entityId: taskId, meta: { phaseId } });
    return { outcome: "uncompleted" };
  }
  ```
  （`createActivityLog` 入参形状以 db.ts 现有定义为准；`and/eq` 已在 db.ts 引入。）
- [ ] **Step 4: 跑测试看通过** —— `npx vitest run server/task-approval.test.ts`。Expected: PASS。
- [ ] **Step 5: Commit** —— `git add server/db.ts server/task-approval.test.ts && git commit -m "feat(task-approval): setTaskCompletion 返回 outcome + 单写日志 + 需审批→待审分支"`

---

## Task 4: tasks 路由删盲写 + setApprovalConfig（TDD on router）

**Files:** `server/routers/tasks.ts`；Test: `server/task-approval.test.ts`

- [ ] **Step 1: 删盲写** —— `server/routers/tasks.ts` `setCompleted`：删除调用 `setTaskCompletion` 之后那段无条件 `createActivityLog(task.complete/uncomplete)`，改为用返回的 `outcome` 决定 toast 文案/通知（不再在 router 写完成日志，日志已下沉 helper）。
- [ ] **Step 2: 写失败测试（config）** —— 在 `server/task-approval.test.ts` 加：
  ```ts
  // 直接调 helper（router 调它）：setTaskApprovalConfig(projectId, phaseId, taskId, { requiresApproval:true, approverUserId:2 }, actorId)
  it("setApprovalConfig 写入 requiresApproval/approverUserId", async () => {
    // 执行后查行：requiresApproval===true, approverUserId===2
  });
  it("待审时关开关 → approvalStatus=none、completed=false、status 归位(非 done)", async () => {
    // 先 setTaskCompletion(...,true) 进 pending；再 setTaskApprovalConfig requiresApproval:false
    // 断言：approvalStatus==="none", completed===false, status !== "done" && !== "pending_approval"
  });
  ```
- [ ] **Step 3: 跑看失败** —— `npx vitest run server/task-approval.test.ts`。Expected: FAIL（函数未定义）。
- [ ] **Step 4: 实现** —— `server/db.ts` 加：
  ```ts
  export async function setTaskApprovalConfig(
    projectId: string, phaseId: string, taskId: string,
    cfg: { requiresApproval: boolean; approverUserId: number | null }, actorBy?: number | null
  ): Promise<void> {
    const db = await getDb();
    const current = db ? (await db.select().from(projectTasks)
      .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.phaseId, phaseId), eq(projectTasks.taskId, taskId))).limit(1))[0] : null;
    const patch: any = { requiresApproval: cfg.requiresApproval, approverUserId: cfg.approverUserId, updatedBy: actorBy ?? null };
    // 关开关且当前待审：取消在途审批，status 交 refresh 归位
    if (!cfg.requiresApproval && current?.status === "pending_approval") {
      patch.status = "todo"; patch.completed = false; patch.completedAt = null;
      patch.approvalStatus = "none"; patch.approvalRequestedBy = null; patch.approvalRequestedAt = null;
    }
    await upsertProjectTask(projectId, phaseId, taskId, patch);
    await refreshProjectTaskStatuses(projectId);
    await createActivityLog({ projectId, userId: actorBy ?? null, action: "task.update_meta", entityType: "task", entityId: taskId, meta: { phaseId, requiresApproval: cfg.requiresApproval, approverUserId: cfg.approverUserId } });
  }
  ```
  `server/routers/tasks.ts` 加 mutation（权限 `canEditProjectInfo`，见 spec §4.6）：
  ```ts
  setApprovalConfig: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), taskId: z.string(),
      requiresApproval: z.boolean(), approverUserId: z.number().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanEditProjectInfo(ctx, input.projectId); // 用现有权限断言（对齐本文件其它 mutation 的权限写法）
      await setTaskApprovalConfig(input.projectId, input.phaseId, input.taskId,
        { requiresApproval: input.requiresApproval, approverUserId: input.approverUserId }, ctx.user.id);
      return { ok: true };
    }),
  ```
- [ ] **Step 5: 跑看通过 + tsc** —— `npx vitest run server/task-approval.test.ts && npx tsc --noEmit`。Expected: PASS / 绿。
- [ ] **Step 6: Commit** —— `git add server/db.ts server/routers/tasks.ts server/task-approval.test.ts && git commit -m "feat(task-approval): 删完成盲写 + setApprovalConfig（含关开关归位）"`

---

## Task 5: decideTaskApproval（通过/驳回）（TDD）

**Files:** `server/db.ts`、`server/routers/tasks.ts`；Test: `server/task-approval.test.ts`

- [ ] **Step 1: 写失败测试** ——
  ```ts
  it("通过 → done/completed=true/approved，日志 task.approve", async () => {/* 先进 pending，再 decide approve；断言 done+completed+approvalStatus=approved，活动多一条 task.approve */});
  it("驳回 → completed=false/approvalStatus=rejected，status∈{todo,in_progress,blocked}", async () => {/* decide reject；断言不 done、approvalStatus=rejected、status 不为 pending_approval/done */});
  it("admin 代审记录 proxyBy", async () => {/* actor!==approver 且 isAdmin → 日志 meta.proxyBy 存在 */});
  ```
- [ ] **Step 2: 跑看失败** —— `npx vitest run server/task-approval.test.ts`。Expected: FAIL。
- [ ] **Step 3: 实现** —— `server/db.ts`：
  ```ts
  export async function decideTaskApproval(
    projectId: string, phaseId: string, taskId: string,
    decision: "approved" | "rejected", actor: number, note: string | null, isProxy: boolean
  ): Promise<void> {
    const db = await getDb();
    const current = db ? (await db.select().from(projectTasks)
      .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.phaseId, phaseId), eq(projectTasks.taskId, taskId))).limit(1))[0] : null;
    const requester = current?.approvalRequestedBy ?? null;
    if (decision === "approved") {
      await upsertProjectTask(projectId, phaseId, taskId, {
        status: "done", completed: true, completedAt: new Date(),
        approvalStatus: "approved", approvalDecidedBy: actor, approvalDecidedAt: new Date(), approvalNote: note, updatedBy: actor,
      });
    } else {
      await upsertProjectTask(projectId, phaseId, taskId, {
        status: "todo", completed: false, completedAt: null,
        approvalStatus: "rejected", approvalDecidedBy: actor, approvalDecidedAt: new Date(), approvalNote: note, updatedBy: actor,
      });
    }
    await refreshProjectTaskStatuses(projectId);
    await createActivityLog({ projectId, userId: actor, action: decision === "approved" ? "task.approve" : "task.reject",
      entityType: "task", entityId: taskId, meta: { phaseId, note, approver: current?.approverUserId ?? null, requester, proxyBy: isProxy ? actor : undefined } });
    // 通知 requester（复用现有通知基建，best-effort）
  }
  ```
  `server/routers/tasks.ts` 加 mutation（权限 `actor===approverUserId || isAdmin`）：
  ```ts
  decideApproval: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), taskId: z.string(),
      decision: z.enum(["approved","rejected"]), note: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const task = await getProjectTask(input.projectId, input.phaseId, input.taskId); // 取 approverUserId
      const isAdmin = ctx.user.role === "admin";
      if (!(task?.approverUserId === ctx.user.id || isAdmin)) throw new TRPCError({ code: "FORBIDDEN", message: "仅审批人或管理员可裁决" });
      const isProxy = task?.approverUserId !== ctx.user.id;
      await decideTaskApproval(input.projectId, input.phaseId, input.taskId, input.decision, ctx.user.id, input.note, isProxy);
      return { ok: true };
    }),
  ```
- [ ] **Step 4: 跑看通过 + tsc** —— `npx vitest run server/task-approval.test.ts && npx tsc --noEmit`。Expected: PASS / 绿。
- [ ] **Step 5: Commit** —— `git add server/db.ts server/routers/tasks.ts server/task-approval.test.ts && git commit -m "feat(task-approval): decideTaskApproval 通过/驳回 + 代审记录 + 路由权限"`

---

## Task 6: tasks.activity 查询（带 phaseId）（TDD）

**Files:** `server/db.ts`、`server/routers/tasks.ts`；Test: `server/task-approval.test.ts`

- [ ] **Step 1: 写失败测试** ——
  ```ts
  it("getTaskActivityLogs 带 phaseId，不串到其他阶段同名 taskId", async () => {
    // 同 projectId、同 taskId、不同 phaseId 各写一条活动；查 (projectId, phaseId=ph1, taskId) 只得 ph1 的
  });
  ```
- [ ] **Step 2: 跑看失败** —— `npx vitest run server/task-approval.test.ts`。Expected: FAIL。
- [ ] **Step 3: 实现** —— `server/db.ts`：
  ```ts
  export async function getTaskActivityLogs(projectId: string, phaseId: string, taskId: string, limit = 100) {
    const db = await getDb(); if (!db) return [];
    return db.select().from(activityLogs)
      .where(and(eq(activityLogs.projectId, projectId), eq(activityLogs.entityType, "task"),
        eq(activityLogs.entityId, taskId), sql`${activityLogs.meta}->>'phaseId' = ${phaseId}`))
      .orderBy(desc(activityLogs.createdAt)).limit(limit);
  }
  ```
  （`sql`/`desc` 从 drizzle-orm 引入；activityLogs 已 import。）
  `server/routers/tasks.ts` 加 query `activity`，返回 join 用户名（参考 comments 路由的用户名解析）。
- [ ] **Step 4: 核对所有 task 活动写入都带 meta.phaseId** —— grep `entityType: "task"` / `entityType:'task'`，给缺 `phaseId` 的 `createActivityLog`（setMeta/setDeliverable/instructions/visible_roles）补 `meta.phaseId`。
- [ ] **Step 5: 跑看通过 + 全量 server 测试** —— `npx vitest run server/task-approval.test.ts && npx tsc --noEmit`。Expected: PASS / 绿。
- [ ] **Step 6: Commit** —— `git add server/db.ts server/routers/tasks.ts server/task-approval.test.ts && git commit -m "feat(task-approval): getTaskActivityLogs 带 phaseId + 任务活动 meta 补 phaseId"`

---

## Task 7: 前端状态文案补「待审批」+ TaskDetails 类型

**Files:** `client/src/lib/data.ts`、`KanbanBoard.tsx:5`、`TaskListView.tsx:56`、`CalendarPage.tsx:130`、`ProjectDetailView.tsx:1110`

- [ ] **Step 1: TaskDetails 类型** —— `client/src/lib/data.ts` `TaskDetails` 加可选：`requiresApproval?: boolean; approverUserId?: number | null; approvalStatus?: string; approvalNote?: string | null; approvalRequestedBy?: number | null; approvalRequestedAt?: string | null; approvalDecidedBy?: number | null; approvalDecidedAt?: string | null;`，并在 task 数据映射处带出（对齐 taskStatus/taskPriority 的映射点）。
- [ ] **Step 2: KanbanBoard 加列** —— `KanbanBoard.tsx:5` `COLUMNS` 在 `done` 之前插 `{ status: 'pending_approval', label: '待审批', tone: 'var(--warning)' }`。
- [ ] **Step 3: TaskListView** —— `STATUS_CONFIG`（56）加 `pending_approval: { label: '待审批', tone: { color: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 14%, transparent)', border: 'color-mix(in srgb, var(--warning) 32%, transparent)' } },`
- [ ] **Step 4: CalendarPage** —— statusLabel（130）加 `if (status === "pending_approval") return "待审批";`
- [ ] **Step 5: ProjectDetailView** —— `TASK_STATUS_CONFIG`（1110）加 `pending_approval: { label: '待审批', className: 'bg-[color:var(--acc-soft)] text-[color:var(--warning)] border-[color:var(--acc-border)]' },`
- [ ] **Step 6: 验证** —— `pnpm check` 绿；`grep -nE 'amber-|stone-|font-serif|font-mono|\bce-'` 改动文件=0。
- [ ] **Step 7: Commit** —— 只 stage 这些文件，`git commit -m "feat(task-approval): 看板/列表/日历/详情 状态文案补「待审批」+ TaskDetails 类型"`

---

## Task 8: 弹窗两栏重构 + 属性栏（需审批开关/审批人）+ 勾选框待审态

**Files:** `client/src/components/views/ProjectDetailView.tsx`（弹窗 ~2407–2702、`TaskDetail` 1030、任务卡勾选框处）

- [ ] **Step 1: 两栏骨架** —— 弹窗面板 `max-w-2xl→max-w-4xl`；scroll body 改 `grid lg:grid-cols-[1fr_300px] gap-6`。左列放：操作指南→交付物→（网关专属区块仅网关任务）→执行说明→标签区占位；右列放属性栏（`bg-secondary` 圆角）。把 `TaskDetail` 的 meta 网格 + 附件 + 可见岗位移到右列，执行说明留左列（可拆 `TaskDetail` 为 `TaskPropsSidebar` + 左列内联执行说明，或加 `layout` prop 控制）。
- [ ] **Step 2: 属性栏加「需审批」** —— 右列加：`需审批` 开关（Switch/checkbox）+ `审批人` select（项目成员），仅 `perms.canEditProjectInfo` 可改；onChange → `trpc.tasks.setApprovalConfig.mutate({projectId, phaseId, taskId, requiresApproval, approverUserId})` + invalidate `tasks.list`/`projects.get`。未选审批人时禁止开启（开关旁提示「请先选审批人」）。
- [ ] **Step 3: 状态显示待审** —— 右列「状态」徽标用 `TASK_STATUS_CONFIG`（已含 pending_approval）。
- [ ] **Step 4: 勾选框待审态** —— 任务卡/详情的完成勾选框：当 `taskStatus==='pending_approval'` 渲染**沙漏/时钟 warning 图标**（非空非勾），title「待审批中，点击撤回」，点击 → setCompleted(false)（撤回）。其余状态不变。
- [ ] **Step 5: 验证（preview）** —— 起本地栈（docker pg + migrate + create-test-users + seed）；登录 test_pm；打开一任务：两栏版式正常、属性栏可改负责人/截止/优先级；开「需审批」选审批人 → 勾完成 → 状态变「待审批」、勾选框是沙漏。`pnpm check` 绿、console 无错。截图。
- [ ] **Step 6: Commit** —— 只 stage `ProjectDetailView.tsx`，`git commit -m "feat(task-detail): 弹窗两栏 + 属性栏(需审批/审批人) + 待审勾选框"`

---

## Task 9: 4 标签（评论/活动/流转/状态审批）

**Files:** `client/src/components/views/ProjectDetailView.tsx`（左列标签区）；可选新建 `client/src/components/views/task/TaskActivityTab.tsx`、`TaskFlowTab.tsx`、`TaskApprovalTab.tsx`

- [ ] **Step 1: 标签条** —— 左列底部加 `activeTab` 状态 + 标签条「评论/活动/流转/状态审批」(Linear 下划线风，参考 mockup)。
- [ ] **Step 2: 评论** —— `activeTab==='comments'` 渲染现有 `CommentThread`（entityType=task, entityId=`${project.id}:${taskId}`）。
- [ ] **Step 3: 活动** —— `TaskActivityTab`：`trpc.tasks.activity.useQuery({projectId, phaseId, taskId})` → 只读时间线（操作人 + 中文化动作 + 相对时间）。动作中文化映射：`task.complete→标记完成`、`task.uncomplete→取消完成/撤回`、`task.submit_approval→提交审批`、`task.approve→审批通过`、`task.reject→审批驳回`、`task.update_meta→更新属性`、`task.update_deliverable→交付物变更`、`task.update_instructions→编辑执行说明`、`task.update_visible_roles→调整可见岗位`。
- [ ] **Step 4: 流转** —— `TaskFlowTab`：同 query，过滤 `action∈{task.complete,task.uncomplete,task.submit_approval,task.approve,task.reject}`，竖向步进时间线渲染 `fromStatus→toStatus`（meta 有则用 meta，否则按动作推断）+ 人 + 时间 + note。
- [ ] **Step 5: 状态审批** —— `TaskApprovalTab`：展示当前 `approvalStatus`（无/待审/通过/驳回）+ 审批人 + 意见 + 历史（取 activity 中 submit/approve/reject）。操作：若 `approvalStatus==='pending'` 且当前用户是 `approverUserId` 或 admin → 显示「通过」/「驳回(+意见)」按钮 → `trpc.tasks.decideApproval.mutate(...)` + invalidate。非审批人只读。
- [ ] **Step 6: 验证（preview）** —— 同一任务：评论可发；活动有「提交审批」等条目；流转显示状态时间线；状态审批：以审批人身份「通过」→ 任务变完成、进度+1；再建一个「驳回」→ 任务退回非完成。`pnpm check` 绿、console 无错。截图。
- [ ] **Step 7: Commit** —— stage `ProjectDetailView.tsx` + 新 tab 文件，`git commit -m "feat(task-detail): 评论/活动/流转/状态审批 四标签"`

---

## Task 10: 收尾验证 + 不回归（硬验收）

- [ ] **Step 1: 全量检查** —— `export $(grep -E '^DATABASE_URL=' .env | xargs) && pnpm check && pnpm test`。已知 `portfolio-health` flake 单独复核；其余必须绿。新加 `server/task-approval.test.ts` 全过。
- [ ] **Step 2: 零回归（硬验收）** —— preview：一个 `requiresApproval=false` 的普通任务，勾完成→直接完成、进度/看板/Gate 就绪与改前一致；活动只产生 `task.complete`（无重复/无 submit）。`refreshProjectTaskStatuses` 不把别的 pending_approval 任务刷掉（用一个开了审批的任务验证刷新后仍 pending_approval）。
- [ ] **Step 3: 展示口径** —— preview：pending_approval 任务在 看板（待审批列）、我的任务（待审批徽标）、日历、逾期（若过期则同时显示待审批+逾期）均有明确展示。
- [ ] **Step 4: grep 收尾** —— `grep -rnE 'amber-|stone-|font-serif|font-mono|\bce-' client/src/components/views/ProjectDetailView.tsx client/src/components/views/task/ | grep -vE 'xlsx-host|docx-host'` = 0。
- [ ] **Step 5: Commit（如有收尾）** —— `git commit -m "chore(task-detail): 收尾验证 + 不回归"`

---

## Self-Review 备注（plan ↔ spec 覆盖）

- §4.1 两栏 → Task 8；§4.2 四标签 → Task 9；§4.3 状态机（通过/驳回/撤回/关开关/改审批人/代审/已完成开开关）→ Task 3/4/5 + 边界断言（Task 4 关开关、Task 5 代审）。
- §4.4 数据模型 → Task 1；§4.5 单写日志/automaticTaskStatus/decide → Task 2/3/5；§4.6 权限 → Task 4/5；§4.7 展示口径 → Task 7（文案）+ Task 8（勾选框）+ Task 10（口径验收）。
- §5 迁移幂等 → Task 1 Step3；§7 验收（含追加 2 条 + 单写）→ Task 10 + 各 TDD。
- 一致性：`setTaskCompletion` 返回 `{outcome}`（Task 3）被 Task 4 router 使用；`pending_approval` 命名贯穿 schema/db/前端；`approvalStatus` 枚举 none/pending/approved/rejected 贯穿。
- 非目标（§9）：未做「待我审批」队列、未把附件/关联问题纳入活动、单审批人 —— plan 不含，符合。
