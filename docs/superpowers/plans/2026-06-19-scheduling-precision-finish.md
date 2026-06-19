# 项目轴排期精度收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给纯排期引擎注入全局节假日日历（含调休），并把 in-progress 任务的预测按「计划起始已耗工期」缩放，让自动排期与健康度/RAG 预测更准。

**Architecture:** 纯函数引擎 `shared/scheduling.ts` 接受可选 `CalendarExceptions`（不传 = 现有「周一~六」口径，零破坏）；DB 侧 `getCalendarExceptions()` 把全局 `calendar_exceptions` 表转成引擎输入，在写库入口（applyProjectSchedule/rescheduleProjectFromTask）和唯一预测适配器 `forecastProjectEnd`（getPortfolio + digest 共用）注入；admin 后台维护节假日；预测缩放仅改 `forecastSchedule` 内部。

**Tech Stack:** TypeScript、tRPC、drizzle-orm（Postgres）、vitest、React（前端 admin 表格）。

**Conventions:** 测试用 vitest，单测命令 `pnpm test`；类型检查 `pnpm check`；迁移走 `pnpm db:push`（drizzle-kit generate + migrate），不写裸 SQL。spec 见 `docs/superpowers/specs/2026-06-19-scheduling-precision-finish-design.md`。

---

## Part 1 — 引擎：日历例外注入（纯函数，零破坏）

### Task 1: `CalendarExceptions` 类型 + `isWorkingDay/nextWorkingDay/addWorkingDays` 接受可选 cal

**Files:**
- Modify: `shared/scheduling.ts:39-67`
- Test: `server/scheduling.test.ts`

- [ ] **Step 1: 写失败测试**（追加到 `server/scheduling.test.ts`）

```ts
import { describe, it, expect } from "vitest";
import { isWorkingDay, addWorkingDays, nextWorkingDay, type CalendarExceptions } from "@shared/scheduling";

describe("calendar exceptions", () => {
  const cal: CalendarExceptions = {
    holidays: new Set(["2026-02-17"]),        // 春节(周二)放假
    makeupWorkdays: new Set(["2026-02-15"]),  // 周日调休上班
  };
  it("法定假在周一~六也算休息", () => {
    expect(isWorkingDay("2026-02-17")).toBe(true);        // 不传 cal: 周二=工作日
    expect(isWorkingDay("2026-02-17", cal)).toBe(false);  // 传 cal: 假日
  });
  it("调休周日算工作日", () => {
    expect(isWorkingDay("2026-02-15")).toBe(false);       // 周日默认休息
    expect(isWorkingDay("2026-02-15", cal)).toBe(true);   // 调休上班
  });
  it("addWorkingDays 跳过假日", () => {
    // 2026-02-16(周一) 加 1 工作日，若 02-17 放假则落到 02-18(周三)
    expect(addWorkingDays("2026-02-16", 1, cal)).toBe("2026-02-18");
    expect(addWorkingDays("2026-02-16", 1)).toBe("2026-02-17"); // 不传 cal
  });
  it("不传 cal 时行为与现状一致", () => {
    expect(nextWorkingDay("2026-06-21")).toBe("2026-06-22"); // 周日→周一
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- scheduling`
Expected: FAIL —— `CalendarExceptions` 未导出 / `isWorkingDay` 不接受第二参。

- [ ] **Step 3: 改实现**（替换 `shared/scheduling.ts:39-67` 三个函数 + 新增类型）

```ts
/** 全局日历例外（YYYY-MM-DD 集合）。holidays=法定假(休)，makeupWorkdays=调休上班(工)。 */
export type CalendarExceptions = {
  holidays: Set<string>;
  makeupWorkdays: Set<string>;
};

/**
 * 工厂工作日历：周一至周六为工作日，周日休息。
 * 可选 cal 叠加法定假/调休；不传则仅按周末口径（与历史一致）。
 * 优先级：调休上班 > 法定假 > 周一~六默认。
 */
export function isWorkingDay(iso: string, cal?: CalendarExceptions): boolean {
  if (!isISODate(iso)) return false;
  if (cal?.makeupWorkdays.has(iso)) return true;
  if (cal?.holidays.has(iso)) return false;
  return new Date(`${iso}T00:00:00Z`).getUTCDay() !== 0;
}

export function nextWorkingDay(iso: string, cal?: CalendarExceptions): string {
  if (!isISODate(iso)) throw new Error(`Invalid ISO date: ${iso}`);
  let out = iso;
  while (!isWorkingDay(out, cal)) out = addDays(out, 1);
  return out;
}

/** ISO 日期加 n 个工厂工作日；起点若落在休息日，先顺延到下一个工作日。 */
export function addWorkingDays(iso: string, n: number, cal?: CalendarExceptions): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid working day delta: ${n}`);
  let out = nextWorkingDay(iso, cal);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(n));
  while (remaining > 0) {
    out = addDays(out, step);
    if (isWorkingDay(out, cal)) remaining -= 1;
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- scheduling`
Expected: PASS（含「不传 cal 行为一致」回归用例）。

- [ ] **Step 5: 提交**

```bash
git add shared/scheduling.ts server/scheduling.test.ts
git commit -m "feat(排期): isWorkingDay/addWorkingDays 接受可选节假日日历(cal?)"
```

---

### Task 2: 新增 `workingDaysBetween`（半开区间 `[from, to)`）

**Files:**
- Modify: `shared/scheduling.ts`（在 `addWorkingDays` 之后新增）
- Test: `server/scheduling.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { workingDaysBetween } from "@shared/scheduling";

describe("workingDaysBetween [from, to)", () => {
  it("from==to → 0（今天等于计划开始，刚开工）", () => {
    expect(workingDaysBetween("2026-06-22", "2026-06-22")).toBe(0);
  });
  it("from>to → 0（clamp，不返回负数）", () => {
    expect(workingDaysBetween("2026-06-25", "2026-06-22")).toBe(0);
  });
  it("跨一个完整周一~六 = 6", () => {
    // [2026-06-22(周一), 2026-06-29(周一)) = 周一..周六 6 个工作日(周日不计)
    expect(workingDaysBetween("2026-06-22", "2026-06-29")).toBe(6);
  });
  it("与 addWorkingDays 互逆：workingDaysBetween(s, addWorkingDays(s, n)) == n", () => {
    const s = "2026-06-20"; // 周六
    expect(workingDaysBetween(s, addWorkingDays(s, 5))).toBe(5);
  });
  it("尊重 cal：假日不计入", () => {
    const cal = { holidays: new Set(["2026-06-23"]), makeupWorkdays: new Set<string>() };
    // [06-22(一),06-24(三)) 正常=2，假日 06-23 扣掉 → 1
    expect(workingDaysBetween("2026-06-22", "2026-06-24", cal)).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- scheduling`
Expected: FAIL —— `workingDaysBetween` 未定义。

- [ ] **Step 3: 写实现**（新增到 `shared/scheduling.ts`，紧跟 `addWorkingDays`）

```ts
/** 半开区间 [fromISO, toISO) 内的工作日数；与 addWorkingDays「起点不计增量」互逆。from>=to → 0。 */
export function workingDaysBetween(fromISO: string, toISO: string, cal?: CalendarExceptions): number {
  if (!isISODate(fromISO) || !isISODate(toISO)) return 0;
  if (fromISO >= toISO) return 0;
  let count = 0;
  let cur = fromISO;
  while (cur < toISO) {
    if (isWorkingDay(cur, cal)) count += 1;
    cur = addDays(cur, 1);
  }
  return count;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- scheduling`
Expected: PASS（5 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add shared/scheduling.ts server/scheduling.test.ts
git commit -m "feat(排期): workingDaysBetween 半开区间工作日数 + cal 支持"
```

---

### Task 3: cal 穿透 `computeStart/generateSchedule/rescheduleFrom` + `scheduleForCategory`

**Files:**
- Modify: `shared/scheduling.ts:95-148`
- Modify: `shared/schedule-graph.ts:61-64`
- Test: `server/scheduling.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { generateSchedule, rescheduleFrom, type SchedTask } from "@shared/scheduling";

describe("generateSchedule with cal", () => {
  const tasks: SchedTask[] = [{ id: "a", durationDays: 2 }, { id: "b", durationDays: 2, dependsOn: ["a"] }];
  it("假日把整链向后顺延", () => {
    const cal = { holidays: new Set(["2026-06-23"]), makeupWorkdays: new Set<string>() };
    const plain = generateSchedule(tasks, "2026-06-22");       // 周一起
    const withHol = generateSchedule(tasks, "2026-06-22", cal); // 06-23 放假
    expect(withHol["b"].due > plain["b"].due).toBe(true);
  });
  it("不传 cal 与现状一致", () => {
    const s = generateSchedule(tasks, "2026-06-22");
    expect(s["a"].start).toBe("2026-06-22");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- scheduling`
Expected: FAIL —— `generateSchedule` 第三参不被接受（或假日链不顺延）。

- [ ] **Step 3: 改实现**

`shared/scheduling.ts` —— `computeStart` 加 cal，并由 `generateSchedule`/`rescheduleFrom` 透传：

```ts
function computeStart(t: SchedTask, sched: Schedule, startDate: string, idsInScope: Set<string>, cal?: CalendarExceptions): string {
  const deps = (t.dependsOn ?? []).filter((d) => idsInScope.has(d));
  const dues = deps.map((d) => sched[d]?.due).filter((x): x is string => !!x);
  let start = dues.length ? dues.reduce((a, b) => (b > a ? b : a)) : startDate;
  return addWorkingDays(start, t.lagDays ?? 0, cal);
}

export function generateSchedule(tasks: SchedTask[], startDate: string, cal?: CalendarExceptions): Schedule {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ids = new Set(tasks.map((t) => t.id));
  const order = topoOrder(tasks) ?? tasks.map((t) => t.id);
  const sched: Schedule = {};
  for (const id of order) {
    const t = byId.get(id)!;
    const start = computeStart(t, sched, startDate, ids, cal);
    sched[id] = { start, due: addWorkingDays(start, Math.max(0, t.durationDays ?? 1), cal) };
  }
  return sched;
}

export function rescheduleFrom(
  tasks: SchedTask[], current: Schedule, changedTaskId: string,
  newDates: { start: string; due: string }, cal?: CalendarExceptions
): Schedule {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ids = new Set(tasks.map((t) => t.id));
  const sched: Schedule = { ...current, [changedTaskId]: { ...newDates } };
  const dependents = new Map<string, string[]>();
  for (const t of tasks) for (const d of t.dependsOn ?? []) (dependents.get(d) ?? dependents.set(d, []).get(d)!).push(t.id);
  const affected = new Set<string>();
  const stack = [...(dependents.get(changedTaskId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (affected.has(id)) continue;
    affected.add(id);
    for (const s of dependents.get(id) ?? []) stack.push(s);
  }
  const order = (topoOrder(tasks) ?? tasks.map((t) => t.id)).filter((id) => affected.has(id));
  for (const id of order) {
    const t = byId.get(id)!;
    const start = computeStart(t, sched, newDates.start, ids, cal);
    sched[id] = { start, due: addWorkingDays(start, Math.max(0, t.durationDays ?? 1), cal) };
  }
  return sched;
}
```

`shared/schedule-graph.ts:61-64` —— `scheduleForCategory` 透传 cal：

```ts
export function scheduleForCategory(category: string | undefined, startDate: string, cal?: CalendarExceptions): Schedule {
  return generateSchedule(buildSchedTasks(getPhasesForCategory(category)), startDate, cal);
}
```

（在 `schedule-graph.ts` 顶部 import 补 `type CalendarExceptions`。`criticalPathTasks`、`flattenPhases`、`buildSchedTasks` **不改**——见 spec：holiday-invariant、不做日期计算。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- scheduling` 然后 `pnpm check`
Expected: PASS + 类型零错。

- [ ] **Step 5: 提交**

```bash
git add shared/scheduling.ts shared/schedule-graph.ts server/scheduling.test.ts
git commit -m "feat(排期): generateSchedule/rescheduleFrom/scheduleForCategory 透传 cal"
```

---

## Part 2 — 数据层：节假日表 + 服务 + admin

### Task 4: schema `calendar_exceptions` 表 + 迁移

**Files:**
- Modify: `drizzle/schema.ts`（在 `projectCalendarEvents` 块之后新增）
- Create: 迁移文件（由 drizzle-kit 生成，勿手写）

- [ ] **Step 1: 加表定义**（`drizzle/schema.ts`，紧跟 `projectCalendarEvents` 的 type 导出之后）

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Calendar Exceptions（全局工作日历例外：法定假 / 调休上班）
// ─────────────────────────────────────────────────────────────────────────────
export const calendarExceptions = pgTable("calendar_exceptions", {
  date: date("date", { mode: "string" }).primaryKey(),     // 一天一条
  type: varchar("type", { length: 16 }).notNull(),          // 'holiday' | 'makeup_workday'
  name: varchar("name", { length: 128 }).notNull().default(""),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CalendarExceptionRow = typeof calendarExceptions.$inferSelect;
export type InsertCalendarException = typeof calendarExceptions.$inferInsert;
```

- [ ] **Step 2: 生成并应用迁移**

Run: `pnpm db:push`
Expected: 生成 `drizzle/0024_*.sql`（CREATE TABLE calendar_exceptions）并 migrate 成功，无报错。

- [ ] **Step 3: 验证类型**

Run: `pnpm check`
Expected: 类型零错。

- [ ] **Step 4: 提交**

```bash
git add drizzle/schema.ts drizzle/0024_*.sql drizzle/meta/
git commit -m "feat(排期): calendar_exceptions 全局节假日例外表 + 迁移"
```

---

### Task 5: `db.getCalendarExceptions()`

**Files:**
- Modify: `server/db.ts`（新增导出函数；顶部 import 补 `calendarExceptions`、`CalendarExceptions`）
- Test: `server/calendar.test.ts`

- [ ] **Step 1: 写失败测试**（追加到 `server/calendar.test.ts`）

```ts
import { getCalendarExceptions } from "./db";
// 前置：插入 calendar_exceptions 两行（用测试已有的 db 句柄/工厂；参考本文件已有 setup）
it("getCalendarExceptions 按 type 分桶成两个 Set", async () => {
  // seed: ('2026-02-17','holiday'), ('2026-02-15','makeup_workday')
  const cal = await getCalendarExceptions();
  expect(cal.holidays.has("2026-02-17")).toBe(true);
  expect(cal.makeupWorkdays.has("2026-02-15")).toBe(true);
  expect(cal.holidays.has("2026-02-15")).toBe(false);
});
```

> 注：若 `server/calendar.test.ts` 现有 setup 未建插入辅助，参照同文件已有用例的 db 初始化方式插入两行后再断言。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- calendar`
Expected: FAIL —— `getCalendarExceptions` 未导出。

- [ ] **Step 3: 写实现**（`server/db.ts` 新增）

```ts
import { calendarExceptions } from "../drizzle/schema";
import type { CalendarExceptions } from "../shared/scheduling";

const EMPTY_CAL: CalendarExceptions = { holidays: new Set(), makeupWorkdays: new Set() };

/** 全局节假日例外 → 引擎输入。无 DB 时返回空集（退回仅周末口径）。 */
export async function getCalendarExceptions(): Promise<CalendarExceptions> {
  const db = await getDb();
  if (!db) return EMPTY_CAL;
  const rows = await db.select({ date: calendarExceptions.date, type: calendarExceptions.type }).from(calendarExceptions);
  const holidays = new Set<string>();
  const makeupWorkdays = new Set<string>();
  for (const r of rows) {
    if (r.type === "makeup_workday") makeupWorkdays.add(r.date);
    else holidays.add(r.date);
  }
  return { holidays, makeupWorkdays };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- calendar`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/db.ts server/calendar.test.ts
git commit -m "feat(排期): db.getCalendarExceptions 全表转引擎日历输入"
```

---

### Task 6: 把 cal 注入写库入口 + 预测适配器

**Files:**
- Modify: `server/db.ts` —— `applyProjectSchedule:2020`、`rescheduleProjectFromTask:2038`、`forecastProjectEnd:423`、`getPortfolio`（调用 forecastProjectEnd 处 :569）、`getPortfolioHealthForDigest`（:697）
- Test: `server/portfolio-health.test.ts`

- [ ] **Step 1: 写失败测试**（追加到 `server/portfolio-health.test.ts`）

```ts
// 种一个落在某 in-progress 任务工期内的法定假后，getPortfolio 与 digest 的 projectedEnd 应一致且晚于无假日版本。
it("digest 与 getPortfolio 用同一 cal、projectedEnd 一致", async () => {
  // seed 一个项目 + 任务 + 一条 calendar_exceptions(holiday)
  const portfolio = await getPortfolio(testUserId);
  const digest = await getPortfolioHealthForDigest(todayISO);
  const p = portfolio.find((x) => x.id === testProjectId)!;
  const d = digest.find((x) => x.id === testProjectId)!;
  expect(p.projectedEnd).toBe(d.projectedEnd); // 同源同口径
});
```

> 注：复用本文件已有的项目/任务 seed helper；只需额外插入一行 holiday 并断言两路一致。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- portfolio-health`
Expected: FAIL（当前 forecastProjectEnd 不读 cal，假日不影响 → 与预期不符）或编译失败。

- [ ] **Step 3: 改实现**

`forecastProjectEnd`（:423）加 `cal` 参数并透传给 `forecastSchedule`：

```ts
function forecastProjectEnd(
  project: Pick<ProjectRow, "category" | "startDate">,
  rows: Array<{ taskId: string; status: string; completed: boolean; startDate: string | null; dueDate: string | null; completedAt: Date | null }>,
  todayISO: string,
  cal?: CalendarExceptions,
): string | null {
  // ...（前段不变）...
  return projectedEndFromSchedule(forecastSchedule(schedTasks, states, todayISO, project.startDate, cal));
}
```

`getPortfolio`：在项目循环**之前**取一次 cal，循环内传入：

```ts
const cal = await getCalendarExceptions();
// ...循环内：
const projectedEnd = forecastProjectEnd(p, projectTaskRows, todayISO, cal);
```

`getPortfolioHealthForDigest`：同样循环外取一次、循环内传入（:697 调用处加 `cal`）。

`applyProjectSchedule`（:2025）：

```ts
const cal = await getCalendarExceptions();
const schedule = scheduleForCategory(project.category, project.startDate, cal);
```

`rescheduleProjectFromTask`（:2051）：

```ts
const cal = await getCalendarExceptions();
const next = rescheduleFrom(schedTasks, current, taskId, { start, due }, cal);
```

（`forecastSchedule` 的 cal 形参在 Task 7 加；本任务先改它的调用方传参——若 Task 7 尚未做，`forecastSchedule` 多收一个被忽略的参数不影响编译。为顺序安全，**建议把 Task 7 的 forecastSchedule 签名改并入本步**：见下。）

- [ ] **Step 3b: 同步给 `forecastSchedule` 加 cal 形参**（`shared/scheduling.ts:173`，行为暂不变，仅透传给内部 addWorkingDays）

```ts
export function forecastSchedule(
  tasks: SchedTask[], states: ForecastTaskState[], todayISO: string,
  projectStartDate?: string | null, cal?: CalendarExceptions
): Schedule {
  // ...内部所有 addWorkingDays(...) 调用补第三参 cal...
  const start = addWorkingDays(base, t.lagDays ?? 0, cal);
  sched[id] = { start, due: addWorkingDays(start, Math.max(0, t.durationDays ?? 1), cal) };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- portfolio-health` 然后 `pnpm check`
Expected: PASS + 类型零错。

- [ ] **Step 5: 提交**

```bash
git add server/db.ts shared/scheduling.ts server/portfolio-health.test.ts
git commit -m "feat(排期): cal 注入 forecastProjectEnd(getPortfolio+digest同源)/applyProjectSchedule/reschedule"
```

---

### Task 7: admin 路由 `calendarExceptions.list/upsert/remove`

**Files:**
- Modify: `server/routers/admin.ts`（在 `adminRouter` 内新增；顶部 import 补 `calendarExceptions`）
- Test: `server/calendar.test.ts`（或新增 `server/calendar-exceptions-router.test.ts`）

- [ ] **Step 1: 写失败测试**

```ts
// 用 adminRouter.createCaller 构造 admin / 非 admin 两种 ctx
it("非 admin upsert 被拒", async () => {
  const caller = adminRouter.createCaller({ user: { id: 9, role: "user" } } as any);
  await expect(caller.calendarExceptions.upsert({ date: "2026-10-01", type: "holiday", name: "国庆" }))
    .rejects.toThrow();
});
it("admin upsert 幂等，list 可见，remove 生效", async () => {
  const caller = adminRouter.createCaller({ user: { id: 1, role: "admin" } } as any);
  await caller.calendarExceptions.upsert({ date: "2026-10-01", type: "holiday", name: "国庆" });
  await caller.calendarExceptions.upsert({ date: "2026-10-01", type: "holiday", name: "国庆节" }); // 同日覆盖
  const list = await caller.calendarExceptions.list();
  expect(list.filter((e) => e.date === "2026-10-01")).toHaveLength(1);
  await caller.calendarExceptions.remove({ date: "2026-10-01" });
  const after = await caller.calendarExceptions.list();
  expect(after.find((e) => e.date === "2026-10-01")).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- calendar`
Expected: FAIL —— `calendarExceptions` 子路由不存在。

- [ ] **Step 3: 写实现**（`server/routers/admin.ts`，`adminRouter` 内新增子路由）

```ts
import { calendarExceptions as calendarExceptionsTable } from "../../drizzle/schema";
// ...在 adminRouter({ ... }) 内：
calendarExceptions: router({
  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(calendarExceptionsTable).orderBy(calendarExceptionsTable.date);
  }),
  upsert: adminProcedure
    .input(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      type: z.enum(["holiday", "makeup_workday"]),
      name: z.string().max(128).default(""),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });
      await db.insert(calendarExceptionsTable)
        .values({ date: input.date, type: input.type, name: input.name, createdBy: ctx.user.id })
        .onConflictDoUpdate({ target: calendarExceptionsTable.date, set: { type: input.type, name: input.name } });
      return { ok: true };
    }),
  remove: adminProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });
      await db.delete(calendarExceptionsTable).where(eq(calendarExceptionsTable.date, input.date));
      return { ok: true };
    }),
}),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- calendar` 然后 `pnpm check`
Expected: PASS + 类型零错。

- [ ] **Step 5: 提交**

```bash
git add server/routers/admin.ts server/calendar.test.ts
git commit -m "feat(排期): admin.calendarExceptions list/upsert/remove(仅 admin)"
```

---

### Task 8: seed 脚本 `scripts/seed-holidays-2026.ts`

**Files:**
- Create: `scripts/seed-holidays-2026.ts`
- Modify: `package.json`（加 `"seed:holidays-2026"` 脚本）

- [ ] **Step 1: 写脚本**（参照 `scripts/migrate-working-calendar.ts` 的 pg.Client + dotenv 范式）

```ts
import "dotenv/config";
import pg from "pg";

// 2026 中国法定节假日 + 调休上班日（首版经验值，可改）。
const HOLIDAYS: Array<[string, string]> = [
  ["2026-01-01", "元旦"],
  ["2026-02-16", "春节"], ["2026-02-17", "春节"], ["2026-02-18", "春节"],
  ["2026-02-19", "春节"], ["2026-02-20", "春节"], ["2026-02-21", "春节"], ["2026-02-22", "春节"],
  ["2026-04-05", "清明"], ["2026-05-01", "劳动节"], ["2026-06-19", "端午"],
  ["2026-09-25", "中秋"], ["2026-10-01", "国庆"], ["2026-10-02", "国庆"], ["2026-10-03", "国庆"],
  ["2026-10-04", "国庆"], ["2026-10-05", "国庆"], ["2026-10-06", "国庆"], ["2026-10-07", "国庆"],
];
const MAKEUP_WORKDAYS: Array<[string, string]> = [
  ["2026-02-15", "春节调休"], ["2026-09-27", "国庆调休"], ["2026-10-10", "国庆调休"],
];

async function main() {
  const { Client } = pg;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const [date, name] of HOLIDAYS) {
      await client.query(
        `INSERT INTO calendar_exceptions(date, type, name) VALUES($1,'holiday',$2)
         ON CONFLICT (date) DO UPDATE SET type='holiday', name=$2`, [date, name]);
    }
    for (const [date, name] of MAKEUP_WORKDAYS) {
      await client.query(
        `INSERT INTO calendar_exceptions(date, type, name) VALUES($1,'makeup_workday',$2)
         ON CONFLICT (date) DO UPDATE SET type='makeup_workday', name=$2`, [date, name]);
    }
    console.log(`seeded ${HOLIDAYS.length} holidays + ${MAKEUP_WORKDAYS.length} makeup workdays`);
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 加 package.json 脚本**

在 `scripts` 段加：`"seed:holidays-2026": "tsx scripts/seed-holidays-2026.ts",`

- [ ] **Step 3: 干跑验证（本地有 DB 时）**

Run: `pnpm seed:holidays-2026`
Expected: 打印 `seeded 19 holidays + 3 makeup workdays`，重跑幂等不报错。
（CI/无 DB 环境跳过；脚本不参与单测。）

- [ ] **Step 4: 提交**

```bash
git add scripts/seed-holidays-2026.ts package.json
git commit -m "feat(排期): seed-holidays-2026 种当年法定假+调休(幂等 upsert)"
```

---

### Task 9: AdminPanel 节假日表格 UI（最小）

**Files:**
- Modify: `client/src/pages/AdminPanel.tsx`（在「用户管理」表之后新增一个 section）

- [ ] **Step 1: 加查询/变更 + 表格**（在 `AdminPanel` 组件内，参照已有 `trpc.admin.*` 用法）

```tsx
const { data: calExceptions, refetch: refetchCal } = trpc.admin.calendarExceptions.list.useQuery();
const upsertCal = trpc.admin.calendarExceptions.upsert.useMutation({ onSuccess: () => refetchCal() });
const removeCal = trpc.admin.calendarExceptions.remove.useMutation({ onSuccess: () => refetchCal() });
const [calForm, setCalForm] = useState({ date: "", type: "holiday" as "holiday" | "makeup_workday", name: "" });
```

```tsx
{/* Calendar Exceptions Table */}
<section className="mt-8 border border-stone-200 rounded-md p-4">
  <h2 className="font-serif text-base text-stone-900 mb-1">工作日历例外（节假日 / 调休）</h2>
  <p className="text-xs text-stone-500 mb-3">默认周一~六工作、周日休息。此处登记法定假（休）与调休上班日（工）。</p>
  <div className="flex gap-2 mb-3 items-end">
    <input type="date" value={calForm.date} onChange={(e) => setCalForm({ ...calForm, date: e.target.value })}
      className="border border-stone-300 rounded px-2 py-1 text-sm" />
    <select value={calForm.type} onChange={(e) => setCalForm({ ...calForm, type: e.target.value as any })}
      className="border border-stone-300 rounded px-2 py-1 text-sm">
      <option value="holiday">法定假（休）</option>
      <option value="makeup_workday">调休上班（工）</option>
    </select>
    <input placeholder="名称" value={calForm.name} onChange={(e) => setCalForm({ ...calForm, name: e.target.value })}
      className="border border-stone-300 rounded px-2 py-1 text-sm" />
    <button disabled={!calForm.date} onClick={() => upsertCal.mutate(calForm)}
      className="bg-stone-900 text-white text-sm rounded px-3 py-1 disabled:opacity-40">添加/更新</button>
  </div>
  <table className="w-full text-sm">
    <thead><tr className="text-left text-stone-500 border-b border-stone-200">
      <th className="py-1">日期</th><th>类型</th><th>名称</th><th></th>
    </tr></thead>
    <tbody>
      {(calExceptions ?? []).map((e) => (
        <tr key={e.date} className="border-b border-stone-100">
          <td className="py-1 font-mono">{e.date}</td>
          <td>{e.type === "holiday" ? "法定假" : "调休上班"}</td>
          <td>{e.name}</td>
          <td className="text-right"><button onClick={() => removeCal.mutate({ date: e.date })}
            className="text-rose-600 text-xs">删除</button></td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
```

- [ ] **Step 2: 类型检查 + 起服务目视**

Run: `pnpm check`
Expected: 类型零错。（前端目视：admin 页能增删节假日、表格刷新。）

- [ ] **Step 3: 提交**

```bash
git add client/src/pages/AdminPanel.tsx
git commit -m "feat(排期): admin 后台节假日例外维护表格"
```

---

## Part 3 — 预测缩放：in-progress 按已耗工期

### Task 10: `forecastSchedule` in-progress 缩放 + FLOOR

**Files:**
- Modify: `shared/scheduling.ts:173-204`（`forecastSchedule` 未完成分支）
- Test: `server/scheduling.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { forecastSchedule, type SchedTask, type ForecastTaskState } from "@shared/scheduling";

describe("forecastSchedule in-progress 缩放", () => {
  const tasks: SchedTask[] = [{ id: "a", durationDays: 10 }];
  const today = "2026-06-29"; // 周一
  it("in_progress 半程 → 剩余约减半（不再按全工期）", () => {
    // 计划 06-15(周一) 开工、10 工作日；今天 06-29 已耗约 12 自然日≈10+ 工作日
    const states: ForecastTaskState[] = [{ id: "a", status: "in_progress", startDate: "2026-06-22", dueDate: null }];
    const due = forecastSchedule(tasks, states, today)["a"].due;
    const fullDue = forecastSchedule(tasks, [{ id: "a", status: "todo", startDate: "2026-06-22" }], today)["a"].due;
    expect(due < fullDue).toBe(true); // 已耗工期被扣减
  });
  it("逾期未完 → 落到 FLOOR(今天+1工作日)", () => {
    const states: ForecastTaskState[] = [{ id: "a", durationDays: 2, status: "in_progress", startDate: "2026-06-01" }];
    const due = forecastSchedule([{ id: "a", durationDays: 2 }], states, today)["a"].due;
    expect(due).toBe(addWorkingDays(today, 1)); // remaining floored to 1
  });
  it("todo 未开工 → 全工期不变", () => {
    const before = forecastSchedule(tasks, [{ id: "a", status: "todo" }], today)["a"].due;
    expect(before).toBe(addWorkingDays(today, 10));
  });
  it("done → 锚 completedAt 不变", () => {
    const due = forecastSchedule(tasks, [{ id: "a", status: "done", completedAtISO: "2026-06-20" }], today)["a"].due;
    expect(due).toBe("2026-06-20");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- scheduling`
Expected: FAIL —— in_progress 仍按全工期，前两个用例不通过。

- [ ] **Step 3: 改实现**（`shared/scheduling.ts`，替换 `forecastSchedule` 未完成分支 :196-201；顶部加常量）

```ts
const FORECAST_FLOOR = 1; // 进行中任务剩余工期下限（工作日）

// ...forecastSchedule 内，替换 isTaskDone 之后的未完成分支：
    const deps = (t.dependsOn ?? []).filter((d) => ids.has(d));
    const depDue = maxISO(deps.map((d) => sched[d]?.due));
    const duration = Math.max(0, t.durationDays ?? 1);
    const started = state?.status === "in_progress";

    if (started) {
      // 进行中：从今天起算「剩余」= 工期 − 已耗(计划起始→今天，半开区间)，下限 FLOOR
      const plannedStart = state?.startDate && isISODate(state.startDate) ? state.startDate : null;
      const elapsed = plannedStart ? workingDaysBetween(plannedStart, todayISO, cal) : 0;
      const remaining = Math.max(FORECAST_FLOOR, duration - elapsed);
      const start = maxISO([todayISO, depDue]) ?? todayISO;
      sched[id] = { start, due: addWorkingDays(start, remaining, cal) };
    } else {
      // 未开工(todo)：维持全工期，从 anchor/计划起始/前置较晚者起算
      const base = maxISO([anchor, state?.startDate, depDue]) ?? anchor;
      const start = addWorkingDays(base, t.lagDays ?? 0, cal);
      sched[id] = { start, due: addWorkingDays(start, duration, cal) };
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- scheduling` 然后 `pnpm check`
Expected: PASS（4 个新用例 + 旧用例全绿）+ 类型零错。

- [ ] **Step 5: 提交**

```bash
git add shared/scheduling.ts server/scheduling.test.ts
git commit -m "feat(预测): in-progress 按计划起始已耗工期缩放(FLOOR=1)"
```

---

### Task 11: 全量回归 + 收尾

**Files:** 无新增

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全绿（含 portfolio-health digest 同源、scheduling 全部新用例）。

- [ ] **Step 2: 类型检查**

Run: `pnpm check`
Expected: 零错误。

- [ ] **Step 3: 自查 spec 覆盖**

对照 `docs/superpowers/specs/2026-06-19-scheduling-precision-finish-design.md` 的「测试」与「设计」两节，确认每条都有对应 Task。无遗漏即完成。

---

## Self-Review（写计划时已核对）

- **Spec 覆盖**：A 引擎注入→Task 1/2/3；B schema→Task 4；C 服务+入口→Task 5/6；D admin+seed→Task 7/8/9；E 预测缩放→Task 10；测试→分散在各 Task + Task 11 回归。无遗漏。
- **不穿透项**：criticalPathTasks/flattenPhases/buildSchedTasks 明确不改（Task 3 注明）。
- **类型一致**：`CalendarExceptions`（holidays/makeupWorkdays 两个 Set）贯穿 scheduling.ts→schedule-graph.ts→db.ts；`getCalendarExceptions` 返回同型；`forecastSchedule`/`generateSchedule`/`rescheduleFrom`/`scheduleForCategory`/`forecastProjectEnd` 的 `cal?` 均为最后一个可选参；`workingDaysBetween(from,to,cal?)` 半开区间，被 Task 10 复用。
- **入口准确（按评审 P1）**：预测仅经 `forecastProjectEnd` 单点，getPortfolio + digest 同 cal；getMyTasks 不涉及。
