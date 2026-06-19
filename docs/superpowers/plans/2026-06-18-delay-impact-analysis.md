# 延期影响分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任务改期时，复用排期依赖引擎算出下游顺延/Gate 滑期/目标日突破，改期前给 PM 预览、落库后冲击则推送。

**Architecture:** 纯函数 `computeDelayImpact` 复用 `rescheduleFrom`（diff 新旧排期）→ db `computeProjectDelayImpact` 装配（按 effectiveIds 过滤裁剪 skipped）→ dry-run query `tasks.delayImpact` 给预览 + `rescheduleProjectFromTask` 落库后返回 impact 并按门槛 emit `task.rescheduled` 事件 → 规则 `delay_impact_notify` 推 PM → 前端把 dueDate 编辑改成「确认改期」显式流。

**Tech Stack:** TypeScript / Drizzle ORM (PostgreSQL) / tRPC / React + vitest。

设计依据：`docs/superpowers/specs/2026-06-18-delay-impact-analysis-design.md`。

约定：① PARALLEL-SESSION STAGING——每个任务只 `git add` 本任务文件，绝不 `git add -A`。② commit 末尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。③ 在 main 上，不开分支。④ 纯函数测试 `npx vitest run <file>`；DB/集成测试 `npm test -- <pattern>`；`npx tsc --noEmit` 须干净。

---

## File Structure

- **Create** `shared/delay-impact.ts` — 纯函数 `computeDelayImpact` + 类型。复用 `rescheduleFrom`(scheduling) / `daysBetween`(health)。
- **Create** `shared/delay-impact.test.ts` — 纯函数单测。
- **Modify** `server/db.ts` — 新增 `computeProjectDelayImpact`；`rescheduleProjectFromTask` 返回 `{count,impact}` 并条件 emit。
- **Modify** `server/automation/rules.ts` — `AutomationEvent.action` 加 `"task.rescheduled"` + `impact?` 字段；新增规则 `delay_impact_notify` + config schema + `buildDelayImpactMessage`；挂进 `AUTOMATION_RULES`/`AUTOMATION_RULE_KEYS`。
- **Modify** `server/routers/tasks.ts` — 新增 `delayImpact` query；`reschedule` 返回体加 `impact`。
- **Create** `server/delay-impact-rule.test.ts` — 规则 matches 单测。
- **Modify** `client/src/components/views/ProjectDetailView.tsx` — dueDate 编辑改「确认改期」流 + 新增 `RescheduleConfirmDialog`。
- **Modify** `client/src/pages/Home.tsx` — 从批量 setMeta 移除 dueDate（改由 reschedule 负责）。

---

## Task 1: 纯函数 computeDelayImpact

**Files:**
- Create: `shared/delay-impact.ts`
- Test: `shared/delay-impact.test.ts`

- [ ] **Step 1: Write the failing test**

`shared/delay-impact.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDelayImpact } from "@shared/delay-impact";
import { generateSchedule, addWorkingDays, type SchedTask } from "@shared/scheduling";

// 线性链 a→b→c→g(gate)
const linear: SchedTask[] = [
  { id: "a", durationDays: 2, dependsOn: [] },
  { id: "b", durationDays: 2, dependsOn: ["a"] },
  { id: "c", durationDays: 2, dependsOn: ["b"] },
  { id: "g", durationDays: 1, dependsOn: ["c"] },
];
// 分支：短支 b、长支 c 决定结束；end e 依赖二者
const branch: SchedTask[] = [
  { id: "a", durationDays: 2, dependsOn: [] },
  { id: "b", durationDays: 1, dependsOn: ["a"] },
  { id: "c", durationDays: 8, dependsOn: ["a"] },
  { id: "e", durationDays: 1, dependsOn: ["b", "c"] },
];
const START = "2026-06-01";

describe("computeDelayImpact", () => {
  it("改链尾 gate → 无下游 shifted，无 gate 冲击", () => {
    const current = generateSchedule(linear, START);
    const r = computeDelayImpact({
      schedTasks: linear, current, changedTaskId: "g",
      newDates: { start: current.g.start, due: addWorkingDays(current.g.due, 5) },
      gateTaskIds: new Set(["g"]), gateNames: { g: "MP评审" }, targetDate: null,
    });
    expect(r.shifted).toEqual([]);
    expect(r.gateImpacts).toEqual([]);
    expect(r.hasImpact).toBe(false);
  });

  it("改链头 → 下游 b/c/g 顺延，gate g 命中且带名，hasImpact=true", () => {
    const current = generateSchedule(linear, START);
    const r = computeDelayImpact({
      schedTasks: linear, current, changedTaskId: "a",
      newDates: { start: current.a.start, due: addWorkingDays(current.a.due, 10) },
      gateTaskIds: new Set(["g"]), gateNames: { g: "MP评审" }, targetDate: null,
    });
    expect(r.shifted.map((s) => s.taskId).sort()).toEqual(["b", "c", "g"]);
    expect(r.shifted.every((s) => s.deltaDays > 0)).toBe(true);
    expect(r.gateImpacts).toHaveLength(1);
    expect(r.gateImpacts[0]).toMatchObject({ taskId: "g", gateName: "MP评审" });
    expect(r.hasImpact).toBe(true);
    expect(r.maxDeltaDays).toBeGreaterThan(0);
  });

  it("目标日新破：原本恰好按期、改后晚于目标 → targetBreach.newlyBreaches=true", () => {
    const current = generateSchedule(linear, START);
    const oldEnd = current.g.due; // 链尾 due = projectedEnd
    const r = computeDelayImpact({
      schedTasks: linear, current, changedTaskId: "a",
      newDates: { start: current.a.start, due: addWorkingDays(current.a.due, 10) },
      gateTaskIds: new Set(), targetDate: oldEnd, // 目标=原结束日，原本不破
    });
    expect(r.targetBreach).not.toBeNull();
    expect(r.targetBreach!.newlyBreaches).toBe(true);
    expect(r.targetBreach!.slipDays).toBeGreaterThan(0);
    expect(r.hasImpact).toBe(true);
  });

  it("目标日已破但未恶化：改非关键短支、结束日不变 → targetBreach=null、hasImpact=false", () => {
    const current = generateSchedule(branch, START);
    const oldEnd = current.e.due;
    // 目标日设在结束日之前 → 原本已破；改 b(短支)小幅，不应推动 e
    const r = computeDelayImpact({
      schedTasks: branch, current, changedTaskId: "b",
      newDates: { start: current.b.start, due: addWorkingDays(current.b.due, 1) },
      gateTaskIds: new Set(), targetDate: addWorkingDays(oldEnd, -3), // 已破
    });
    expect(r.shifted.map((s) => s.taskId)).not.toContain("e"); // e 未被推动
    expect(r.targetBreach).toBeNull(); // 未恶化不报
    expect(r.hasImpact).toBe(false);
  });

  it("targetDate=null → targetBreach=null", () => {
    const current = generateSchedule(linear, START);
    const r = computeDelayImpact({
      schedTasks: linear, current, changedTaskId: "a",
      newDates: { start: current.a.start, due: addWorkingDays(current.a.due, 10) },
      gateTaskIds: new Set(), targetDate: null,
    });
    expect(r.targetBreach).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/delay-impact.test.ts`
Expected: FAIL（`Cannot find module '@shared/delay-impact'`）。

- [ ] **Step 3: Write the implementation**

`shared/delay-impact.ts`:

```ts
import { rescheduleFrom, type SchedTask, type Schedule } from "./scheduling";
import { daysBetween } from "./health";

export type ShiftedTask = { taskId: string; oldDue: string; newDue: string; deltaDays: number };
export type GateImpact = ShiftedTask & { gateName: string | null };
export type TargetBreach = {
  oldProjectedEnd: string;
  newProjectedEnd: string;
  targetDate: string;
  slipDays: number;       // daysBetween(targetDate, newProjectedEnd)，正数=晚
  newlyBreaches: boolean; // 改期前 oldProjectedEnd <= targetDate
};
export type DelayImpact = {
  changedTaskId: string;
  shifted: ShiftedTask[];
  gateImpacts: GateImpact[];
  targetBreach: TargetBreach | null;
  maxDeltaDays: number;
  hasImpact: boolean;
};

function maxDue(sched: Schedule): string | null {
  let m: string | null = null;
  for (const id of Object.keys(sched)) {
    const d = sched[id]?.due;
    if (d && (m === null || d > m)) m = d;
  }
  return m;
}

export function computeDelayImpact(input: {
  schedTasks: SchedTask[];
  current: Schedule;
  changedTaskId: string;
  newDates: { start: string; due: string };
  gateTaskIds: Set<string>;
  gateNames?: Record<string, string>;
  targetDate: string | null;
}): DelayImpact {
  const { schedTasks, current, changedTaskId, newDates, gateTaskIds, gateNames, targetDate } = input;
  const next = rescheduleFrom(schedTasks, current, changedTaskId, newDates);

  const shifted: ShiftedTask[] = [];
  for (const taskId of Object.keys(next)) {
    if (taskId === changedTaskId) continue;
    const oldDue = current[taskId]?.due;
    const newDue = next[taskId]?.due;
    if (!oldDue || !newDue || oldDue === newDue) continue;
    const delta = daysBetween(oldDue, newDue);
    if (delta === null || delta <= 0) continue; // 仅顺延
    shifted.push({ taskId, oldDue, newDue, deltaDays: delta });
  }
  shifted.sort((a, b) =>
    a.newDue < b.newDue ? -1 : a.newDue > b.newDue ? 1 : a.taskId < b.taskId ? -1 : 1
  );

  const gateImpacts: GateImpact[] = shifted
    .filter((s) => gateTaskIds.has(s.taskId))
    .map((s) => ({ ...s, gateName: gateNames?.[s.taskId] ?? null }));

  const oldProjectedEnd = maxDue(current);
  const newProjectedEnd = maxDue(next);
  let targetBreach: TargetBreach | null = null;
  if (
    targetDate && oldProjectedEnd && newProjectedEnd &&
    newProjectedEnd > targetDate && newProjectedEnd > oldProjectedEnd
  ) {
    targetBreach = {
      oldProjectedEnd,
      newProjectedEnd,
      targetDate,
      slipDays: daysBetween(targetDate, newProjectedEnd) ?? 0,
      newlyBreaches: oldProjectedEnd <= targetDate,
    };
  }

  const maxDeltaDays = shifted.reduce((m, s) => Math.max(m, s.deltaDays), 0);
  const hasImpact = gateImpacts.length > 0 || targetBreach !== null;
  return { changedTaskId, shifted, gateImpacts, targetBreach, maxDeltaDays, hasImpact };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/delay-impact.test.ts`
Expected: PASS（5 passed）。若某结构断言因 rescheduleFrom 行为不符，**先核 rescheduleFrom 语义再调测试预期**，勿改实现去迁就。

- [ ] **Step 5: tsc + Commit**

Run: `npx tsc --noEmit`（clean）。
```bash
git add shared/delay-impact.ts shared/delay-impact.test.ts
git commit -m "feat(延期影响): computeDelayImpact 纯函数(复用 rescheduleFrom diff)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: db 装配 computeProjectDelayImpact（裁剪过滤）

**Files:**
- Modify: `server/db.ts`（新增函数，靠近 `rescheduleProjectFromTask`）
- Test: `server/delay-impact-db.test.ts`（新增，DB 集成）

- [ ] **Step 1: Write the failing test**

`server/delay-impact-db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectWithSeed, computeProjectDelayImpact } from "./db";
import { projects, projectTasks } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PRJ = `di-db-${Date.now()}`;

beforeAll(async () => {
  await createProjectWithSeed(
    { id: PRJ, name: "延期DB", projectNumber: "DI1", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 1 } as any,
    "npd", 1,
  );
  // 给前两个有依赖的任务排上日期，构造一个可顺延的链（用 applyProjectSchedule 更省事）
  const { applyProjectSchedule } = await import("./db");
  await applyProjectSchedule(PRJ);
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectTasks).where(eq(projectTasks.projectId, PRJ));
  await db!.delete(projects).where(eq(projects.id, PRJ));
});

describe("computeProjectDelayImpact", () => {
  it("不存在的项目 → null", async () => {
    expect(await computeProjectDelayImpact("nope", "c1", "2026-06-01", "2026-06-10")).toBeNull();
  });

  it("把某有下游的任务推后 → 返回 DelayImpact、有顺延下游", async () => {
    const db = await getDb();
    const rows = await db!.select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
      .from(projectTasks).where(eq(projectTasks.projectId, PRJ));
    // 找第一个有排期的任务作为改期目标
    const head = rows.find((r) => r.startDate && r.dueDate)!;
    const { addWorkingDays } = await import("@shared/scheduling");
    const impact = await computeProjectDelayImpact(PRJ, head.taskId, head.startDate!, addWorkingDays(head.dueDate!, 15));
    expect(impact).not.toBeNull();
    expect(impact!.changedTaskId).toBe(head.taskId);
    // 顺延的下游 deltaDays 必为正
    expect(impact!.shifted.every((s) => s.deltaDays > 0)).toBe(true);
  });

  it("被裁(skipped)的任务不计入 shifted", async () => {
    const db = await getDb();
    // 把某个下游任务置 skipped，确认它不再出现在 shifted
    const rows = await db!.select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
      .from(projectTasks).where(eq(projectTasks.projectId, PRJ));
    const scheduled = rows.filter((r) => r.startDate && r.dueDate);
    const head = scheduled[0];
    const victim = scheduled[scheduled.length - 1].taskId;
    await db!.update(projectTasks).set({ status: "skipped" }).where(eq(projectTasks.projectId, PRJ));
    // 仅 head 设回有效，确保 head 仍可作为改期锚点
    await db!.update(projectTasks).set({ status: "todo" }).where(eq(projectTasks.taskId, head.taskId));
    const { addWorkingDays } = await import("@shared/scheduling");
    const impact = await computeProjectDelayImpact(PRJ, head.taskId, head.startDate!, addWorkingDays(head.dueDate!, 15));
    expect(impact!.shifted.map((s) => s.taskId)).not.toContain(victim);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- delay-impact-db`
Expected: FAIL（`computeProjectDelayImpact` 未导出）。

- [ ] **Step 3: Implement computeProjectDelayImpact in server/db.ts**

在 `server/db.ts` 顶部 import 区加：
```ts
import { computeDelayImpact, type DelayImpact } from "../shared/delay-impact";
```
（`buildSchedTasks`、`getPhasesForCategory`、`Schedule` 已在 db.ts 使用/导入——确认无需重复 import。）

在 `rescheduleProjectFromTask` 附近新增：
```ts
export async function computeProjectDelayImpact(
  projectId: string, taskId: string, start: string, due: string
): Promise<DelayImpact | null> {
  const db = await getDb();
  if (!db) return null;
  const project = await getProjectById(projectId);
  if (!project) return null;

  const rows = await db
    .select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate, status: projectTasks.status })
    .from(projectTasks).where(eq(projectTasks.projectId, projectId));

  // 仅项目实际有效任务(裁剪会把任务置 skipped)
  const effectiveIds = new Set(rows.filter((r) => r.status !== "skipped").map((r) => r.taskId));
  if (!effectiveIds.has(taskId)) return null;

  const current: Schedule = {};
  for (const r of rows) {
    if (effectiveIds.has(r.taskId) && r.startDate && r.dueDate) current[r.taskId] = { start: r.startDate, due: r.dueDate };
  }

  const phases = getPhasesForCategory(project.category);
  const schedTasks = buildSchedTasks(phases).filter((t) => effectiveIds.has(t.id));
  const gateTaskIds = new Set(phases.map((p) => p.gateTaskId).filter((id) => effectiveIds.has(id)));
  const gateNames: Record<string, string> = {};
  for (const p of phases) if (effectiveIds.has(p.gateTaskId)) gateNames[p.gateTaskId] = p.gate;

  return computeDelayImpact({
    schedTasks, current, changedTaskId: taskId,
    newDates: { start, due }, gateTaskIds, gateNames,
    targetDate: project.targetDate ?? null,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- delay-impact-db`
Expected: PASS（3 passed）。

- [ ] **Step 5: tsc + Commit**

Run: `npx tsc --noEmit`（clean）。
```bash
git add server/db.ts server/delay-impact-db.test.ts
git commit -m "feat(延期影响): computeProjectDelayImpact 装配(按 effectiveIds 过滤裁剪)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 预览端点 tasks.delayImpact（dry-run）

**Files:**
- Modify: `server/routers/tasks.ts`（新增 `delayImpact` query）

- [ ] **Step 1: 实现 delayImpact query**

`server/routers/tasks.ts`：顶部确认已 import `computeProjectDelayImpact`（与其他 db 函数一起 import；若未 import 则加入 `from "../db"` 的解构）。在 `reschedule` 端点旁新增：
```ts
  /** 改期前预览：dry-run 算延期影响，不落库（需 canEditTasks） */
  delayImpact: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      taskId: z.string(),
      startDate: isoDateInput,
      dueDate: isoDateInput,
    }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有调整排期的权限" });
      }
      return computeProjectDelayImpact(input.projectId, input.taskId, input.startDate, input.dueDate);
    }),
```
（`getEffectiveRole`、`ROLE_PERMISSIONS`、`isoDateInput`、`TRPCError` 均已在 tasks.ts 使用——与 `reschedule` 同套。）

- [ ] **Step 2: 验证类型 + 路由可用**

Run: `npx tsc --noEmit`
Expected: clean（tRPC 自动暴露 `trpc.tasks.delayImpact`）。

- [ ] **Step 3: Commit**

```bash
git add server/routers/tasks.ts
git commit -m "feat(延期影响): tasks.delayImpact 预览端点(dry-run 不落库)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 落库改期返回 impact + 冲击 emit 事件

**Files:**
- Modify: `server/automation/rules.ts`（扩展 `AutomationEvent`）
- Modify: `server/db.ts`（`rescheduleProjectFromTask`）
- Modify: `server/routers/tasks.ts`（`reschedule` 返回 impact）
- Test: `server/delay-impact-db.test.ts`（追加 emit 断言）

- [ ] **Step 1: 扩展 AutomationEvent 类型**

`server/automation/rules.ts` 的 `AutomationEvent`：在 `action` 联合末尾加一项，并加可选 `impact`：
```ts
  action:
    | "scheduled"
    | "issue.create"
    | "issue.update"
    | "issue.close"
    | "task.update_meta"
    | "task.rescheduled"
    | "gate.create"
    | "gate.update"
    | "mp.release";
```
在该类型字段区加（紧随 `now?` 之后）：
```ts
  impact?: import("../../shared/delay-impact").DelayImpact;
```

- [ ] **Step 2: Write the failing test（emit 行为）**

在 `server/delay-impact-db.test.ts` 追加（验证落库路径 emit）：
```ts
import { rescheduleProjectFromTask } from "./db";

describe("rescheduleProjectFromTask 返回 impact + 冲击 emit", () => {
  it("返回 {count, impact}，冲击时 emit task.rescheduled", async () => {
    // 复用上面的 PRJ；新建一个干净项目避免相互污染
    const P = `di-emit-${Date.now()}`;
    await createProjectWithSeed(
      { id: P, name: "延期emit", projectNumber: "DI2", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 1 } as any,
      "npd", 1,
    );
    const { applyProjectSchedule } = await import("./db");
    await applyProjectSchedule(P);
    const db = await getDb();
    const rows = await db!.select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
      .from(projectTasks).where(eq(projectTasks.projectId, P));
    const head = rows.find((r) => r.startDate && r.dueDate)!;
    const { addWorkingDays } = await import("@shared/scheduling");

    const events: string[] = [];
    const res = await rescheduleProjectFromTask(P, head.taskId, head.startDate!, addWorkingDays(head.dueDate!, 30), {
      emit: async (e: any) => { events.push(e.action); },
    });
    expect(typeof res.count).toBe("number");
    expect(res.impact).not.toBeNull();
    // 大幅推后通常冲击 gate/目标 → emit
    if (res.impact?.hasImpact) expect(events).toContain("task.rescheduled");

    await db!.delete(projectTasks).where(eq(projectTasks.projectId, P));
    await db!.delete(projects).where(eq(projects.id, P));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- delay-impact-db`
Expected: FAIL（`rescheduleProjectFromTask` 现返回 number、无第 5 参 deps、无 impact）。

- [ ] **Step 4: 改 rescheduleProjectFromTask**

`server/db.ts`：顶部 import `emitAutomationEvent`：
```ts
import { emitAutomationEvent } from "./automation/events";
```
把 `rescheduleProjectFromTask` 改为先算 impact、落库、返回 `{count, impact}`，冲击则 emit（注入 deps 便于测试）：
```ts
export async function rescheduleProjectFromTask(
  projectId: string, taskId: string, start: string, due: string,
  deps: { emit?: (e: any) => Promise<void> } = {}
): Promise<{ count: number; impact: DelayImpact | null }> {
  const db = await getDb();
  if (!db) return { count: 0, impact: null };
  const impact = await computeProjectDelayImpact(projectId, taskId, start, due);

  const project = await getProjectById(projectId);
  if (!project) return { count: 0, impact };
  const schedTasks = buildSchedTasks(getPhasesForCategory(project.category));
  const rows = await db
    .select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
    .from(projectTasks).where(eq(projectTasks.projectId, projectId));
  const current: Schedule = {};
  for (const r of rows) if (r.startDate && r.dueDate) current[r.taskId] = { start: r.startDate, due: r.dueDate };
  const next = rescheduleFrom(schedTasks, current, taskId, { start, due });
  let n = 0;
  for (const [id, d] of Object.entries(next)) {
    if (current[id]?.start === d.start && current[id]?.due === d.due) continue;
    await db.update(projectTasks)
      .set({ startDate: d.start, dueDate: d.due })
      .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.taskId, id)));
    n += 1;
  }
  if (n > 0) await refreshProjectTaskStatuses(projectId);

  if (impact?.hasImpact) {
    const emit = deps.emit ?? emitAutomationEvent;
    await emit({
      action: "task.rescheduled",
      entityType: "task",
      entityId: taskId,
      projectId,
      impact,
    } as any);
  }
  return { count: n, impact };
}
```
（`rescheduleFrom` 需从 `../shared/scheduling` import——确认 db.ts 已 import 它，否则加入。`DelayImpact` 已由 Task 2 import。`deps.emit` 类型用 `(e: any) => Promise<void>` 避开类型循环，**不新建任何 shared/automation-event 模块**。emit 的事件对象在 action 联合已含 `task.rescheduled` 后即为合法 AutomationEvent。）

- [ ] **Step 5: 改 tasks.reschedule 返回 impact**

`server/routers/tasks.ts` 的 `reschedule` mutation 末尾：
```ts
      const { count, impact } = await rescheduleProjectFromTask(input.projectId, input.taskId, input.startDate, input.dueDate);
      return { success: true, count, impact } as const;
```

- [ ] **Step 6: Run test + tsc**

Run: `npm test -- delay-impact-db release scheduling`（确认改期既有用例不回归 + 新 emit 用例过）。
Run: `npx tsc --noEmit`（clean——注意 reschedule 返回值变了，确认无调用方依赖旧的 `{count}` 形状报错；若有则同步更新）。
Expected: PASS / clean。

- [ ] **Step 7: Commit**

```bash
git add server/automation/rules.ts server/db.ts server/routers/tasks.ts server/delay-impact-db.test.ts
git commit -m "feat(延期影响): reschedule 返回 impact + 冲击 emit task.rescheduled

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 自动化规则 delay_impact_notify

**Files:**
- Modify: `server/automation/rules.ts`（config schema + 规则 + buildMessage + 注册）
- Test: `server/delay-impact-rule.test.ts`

- [ ] **Step 1: Write the failing test**

`server/delay-impact-rule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AUTOMATION_RULES, AUTOMATION_RULE_KEYS } from "./automation/rules";

const rule = AUTOMATION_RULES.find((r) => r.key === "delay_impact_notify")!;

describe("delay_impact_notify 规则", () => {
  it("已注册到 AUTOMATION_RULES / KEYS", () => {
    expect(rule).toBeTruthy();
    expect(AUTOMATION_RULE_KEYS).toContain("delay_impact_notify");
    expect(rule.triggerType).toBe("event");
    expect(rule.recipientRoles).toContain("pm");
  });

  it("matches 仅在 action=task.rescheduled 且 impact.hasImpact 时为真", () => {
    const cfg = rule.defaultConfig;
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact: { hasImpact: true } } as any, cfg)).toBe(true);
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact: { hasImpact: false } } as any, cfg)).toBe(false);
    expect(rule.matches({ action: "issue.create", entityType: "issue" } as any, cfg)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- delay-impact-rule`
Expected: FAIL（找不到 `delay_impact_notify` 规则）。

- [ ] **Step 3: Implement the rule**

`server/automation/rules.ts`：
(a) `AUTOMATION_RULE_KEYS` 数组里加一项 `"delay_impact_notify"`（与其他 key 并列）。
(b) 加 config schema（无额外参数，留扩展位）：
```ts
const delayImpactConfigSchema = z.object({});
```
(c) 加 buildMessage（放在其他 buildXxxMessage 旁）：
```ts
function buildDelayImpactMessage(event: AutomationEvent, ctx: AutomationMessageContext): AutomationMessage {
  const impact = event.impact;
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const taskId = String(event.entityId ?? "任务");
  const gateLine = (impact?.gateImpacts ?? []).map((g) => `${g.gateName ?? g.taskId} 滑 ${g.deltaDays} 天`).join("；");
  const tb = impact?.targetBreach;
  const targetLine = tb
    ? `目标日 ${tb.targetDate} 预计${tb.newlyBreaches ? "突破" : "再恶化"}至 ${tb.newProjectedEnd}（晚 ${tb.slipDays} 天）`
    : "";
  const parts = [gateLine, targetLine].filter(Boolean).join("；");
  const messageTitle = "延期影响提醒";
  const text = `${project}任务「${taskId}」改期 → ${parts || `顺延 ${impact?.shifted.length ?? 0} 个下游`}。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${text}` };
}
```
(d) 在 `AUTOMATION_RULES` 数组里加规则对象：
```ts
  {
    key: "delay_impact_notify",
    label: "延期影响通知",
    triggerType: "event",
    defaultEnabled: true,
    defaultConfig: delayImpactConfigSchema.parse({}),
    configSchema: delayImpactConfigSchema,
    recipientRoles: ["pm"],
    matches: (event) => event.action === "task.rescheduled" && !!event.impact?.hasImpact,
    buildMessage: (event, _cfg, ctx) => buildDelayImpactMessage(event, ctx),
  },
```
（若规则对象的 `matches`/`buildMessage` 签名要求与其他规则一致，照抄 `status_change_notify` 的形参形态。`AutomationMessage` 类型即 `{title, text, markdown}`，与其他 buildMessage 返回一致。）

- [ ] **Step 4: Run test + tsc**

Run: `npm test -- delay-impact-rule`
Expected: PASS（2 passed）。
Run: `npx tsc --noEmit`（clean）。

- [ ] **Step 5: Commit**

```bash
git add server/automation/rules.ts server/delay-impact-rule.test.ts
git commit -m "feat(延期影响): delay_impact_notify 规则(默认开，冲击Gate/目标日推PM)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 前端「确认改期」流

**Files:**
- Modify: `client/src/components/views/ProjectDetailView.tsx`（dueDate input + 新增 `RescheduleConfirmDialog`）
- Modify: `client/src/pages/Home.tsx`（从 setMeta 批量移除 dueDate）

- [ ] **Step 1: Home.tsx 不再用 setMeta 写 dueDate**

`client/src/pages/Home.tsx` 约 215-225，`metaChanged` 与 `setTaskMetaMutation` 调用里**去掉 dueDate**（dueDate 由 reschedule 负责）：
- `metaChanged` 的判断去掉 `details.dueDate !== (oldMeta?.dueDate ?? null) ||` 这一行。
- `setTaskMetaMutation.mutateAsync({...})` 的入参去掉 `dueDate: details.dueDate ?? null,`。
（保留 assignee/priority 逻辑不动。）

- [ ] **Step 2: ProjectDetailView 的 dueDate input 改为打开确认弹窗**

在 `TaskDetail` 组件内（截止日期 input，约 ProjectDetailView.tsx:1009）新增本地 state 与弹窗触发。把 input 的 `onChange` 改为：
```tsx
          <input
            type="date"
            value={taskDetails?.dueDate ?? ''}
            disabled={!canEdit}
            onChange={(e) => {
              const nextDue = e.target.value || null;
              if (!nextDue || nextDue === (taskDetails?.dueDate ?? null)) return;
              if (!taskDetails?.startDate) {
                // 未排期任务：无起点不可级联，退回仅记录截止日
                onUpdate({ ...taskDetails, dueDate: nextDue });
                return;
              }
              setPendingReschedule({ taskId: taskDetails.taskId, startDate: taskDetails.startDate, newDue: nextDue });
            }}
            className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 px-2 py-1 outline-none focus:border-amber-400 transition-colors"
          />
```
在 `TaskDetail` 组件顶部加 state（与其他 useState 并列）：
```tsx
  const [pendingReschedule, setPendingReschedule] = useState<{ taskId: string; startDate: string; newDue: string } | null>(null);
```
（确认 `taskDetails` 含 `taskId` 与 `startDate`；类型见 `client/src/lib/data.ts` Task。若 `taskDetails.taskId` 不存在，用该 TaskDetail 已有的 taskId 变量。）

- [ ] **Step 3: 新增 RescheduleConfirmDialog 组件**

在 `ProjectDetailView.tsx`（文件内、`TaskDetail` 之外的模块作用域）新增组件：
```tsx
function RescheduleConfirmDialog({
  projectId, taskId, startDate, newDue, onClose, onDone,
}: {
  projectId: string; taskId: string; startDate: string; newDue: string;
  onClose: () => void; onDone: () => void;
}) {
  const { data: impact, isLoading } = trpc.tasks.delayImpact.useQuery(
    { projectId, taskId, startDate, dueDate: newDue },
    { staleTime: 0 },
  );
  const reschedule = trpc.tasks.reschedule.useMutation();
  const confirm = async () => {
    await reschedule.mutateAsync({ projectId, taskId, startDate, dueDate: newDue });
    onDone();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white border border-stone-200 w-[440px] max-w-[90vw] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-serif text-base text-stone-900 mb-2">改期影响确认</div>
        {isLoading ? (
          <p className="text-xs text-stone-400 py-4">正在计算延期影响…</p>
        ) : !impact ? (
          <p className="text-xs text-stone-500 py-4">无法计算影响（任务未排期或项目缺失）。</p>
        ) : (
          <div className="space-y-2 text-xs text-stone-700">
            <p>将顺延 <b>{impact.shifted.length}</b> 个下游任务（最大 {impact.maxDeltaDays} 天）。</p>
            {impact.gateImpacts.length > 0 && (
              <div className="text-red-600">
                <div className="font-medium">Gate 滑期：</div>
                <ul className="pl-3 list-disc">
                  {impact.gateImpacts.map((g) => <li key={g.taskId}>{g.gateName ?? g.taskId} 滑 {g.deltaDays} 天</li>)}
                </ul>
              </div>
            )}
            {impact.targetBreach && (
              <p className="text-red-600">
                {impact.targetBreach.newlyBreaches ? "原本可按期，改后" : "目标日已超，本次再"}
                破 {impact.targetBreach.slipDays} 天（预计 {impact.targetBreach.newProjectedEnd}）。
              </p>
            )}
            {!impact.hasImpact && <p className="text-stone-500">仅顺延下游，不冲击 Gate / 目标日。</p>}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 border border-stone-200 text-stone-600">取消</button>
          <button onClick={confirm} disabled={reschedule.isPending}
            className="text-xs px-3 py-1.5 bg-amber-500 text-white disabled:opacity-50">
            {reschedule.isPending ? "改期中…" : "确认改期"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 在 TaskDetail 渲染弹窗**

在 `TaskDetail` 的 return JSX 末尾（最外层 `<div>` 闭合前）加：
```tsx
      {pendingReschedule && (
        <RescheduleConfirmDialog
          projectId={projectId}
          taskId={pendingReschedule.taskId}
          startDate={pendingReschedule.startDate}
          newDue={pendingReschedule.newDue}
          onClose={() => setPendingReschedule(null)}
          onDone={() => { setPendingReschedule(null); onUpdate({ ...taskDetails, dueDate: pendingReschedule.newDue }); }}
        />
      )}
```
（`onDone` 里同步本地 dueDate 显示；级联后端已落库，列表刷新依赖既有 query 失效机制；若该视图有 `utils.invalidate`/`refetch` 入口，在 onDone 里调用更稳——按文件现有刷新方式补。`projectId` 在 TaskDetail 作用域可见，确认其来源。）

- [ ] **Step 5: tsc + 预览验证（由 controller 执行）**

Run: `npx tsc --noEmit`（clean）。
浏览器验证（controller 用 preview 工具）：进项目详情→改某已排期任务截止日→弹「改期影响确认」、列出下游/Gate/目标日→确认后下游联动。截图留证。

- [ ] **Step 6: Commit**

```bash
git add client/src/components/views/ProjectDetailView.tsx client/src/pages/Home.tsx
git commit -m "feat(延期影响): dueDate 编辑改确认改期流 + 影响预览弹窗

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾

- [ ] 全量回归：`npm test`（全绿）+ `npx tsc --noEmit`（零错）。
- [ ] 更新 memory `automation-feature-roadmap`：#3 延期影响分析标完成（含本计划 commit）。
- [ ] 推送：只 stage 本特性文件，干净后 `git push origin main`。

## 明确不做（与 spec 一致）

多任务批量改期合并影响；提前期分析；影响落库存档；钉钉/站内外渠道；甘特拖拽影响叠加（本期覆盖任务详情入口）。
