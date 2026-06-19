# 项目轴排期精度收尾 — 节假日日历 + in-progress 预测缩放 — 设计文档

## 目标

补齐「项目轴硬化」遗留的两个排期精度短板：

1. **法定节假日日历**：现 `shared/scheduling.ts` 只按「周一~六工作、周日休息」算工作日，法定假（春节/国庆等）被当工作日 → 自动排期系统性偏乐观；中国调休（周日变上班）也未处理。
2. **in-progress 预测缩放**：现 `forecastSchedule` 对进行中任务一律按**全工期**从锚点顺推，90% 完成的任务仍当作刚开工 → 高估 `projectedEnd`。

两项都属排期精度收尾，合一个 spec，实现拆成两个可独立审查的 commit。

## 现状（已有基础）

- `shared/scheduling.ts`：纯函数引擎。`isWorkingDay(iso)`（周日休息）、`addWorkingDays(iso, n)`、`nextWorkingDay`、`generateSchedule`、`rescheduleFrom`、`forecastSchedule`、`flattenPhases`；`shared/schedule-graph.ts` 的 `criticalPathTasks` 走工作日整数计数。全部不读时钟、无副作用，日历数据由上层注入——本设计沿用该模式。
- `projectTasks` 字段：`startDate`/`dueDate`（计划，DATE）、`completedAt`（实际完成 ts）、`status`、`completed`。**无完成度% / 无实际开始日** → 预测缩放只能用「计划起始推算」。
- `forecastSchedule`：已完成锚 `completedAt`，未完成从 `max(anchor, startDate, depDue)` 起算全工期。on-read，不持久化。
- 无任何全局节假日表；`project_calendar_events` 是 per-project 会议日程，与节假日无关。
- `applyProjectSchedule` 仅在新建/手动触发时跑；存量项目日期不自动重算。

## 关键设计决策（已评审确认）

- 节假日数据源：**全局例外表 + 手工维护**（admin 后台），双向支持调休。
- 预测模型：**按计划起始推算已耗工期**（零新字段）。
- FLOOR（逾期未完任务的剩余下限）= **1 个工作日**。
- v1 节假日维护：建表 + seed 脚本 + **最小 admin CRUD**（无日历控件）。
- 两项合一个 spec、两个 commit。

## 设计

### A. 引擎改造 `shared/scheduling.ts`（日历例外注入）

新增可选日历例外类型，沿现有「数据上层注入」模式穿透：

```ts
export type CalendarExceptions = {
  holidays: Set<string>;       // YYYY-MM-DD，法定假：即使周一~六也休息
  makeupWorkdays: Set<string>; // YYYY-MM-DD，调休上班：即使周日也工作
};

// 默认 undefined → 退回今天「仅周末」口径，零破坏
export function isWorkingDay(iso: string, cal?: CalendarExceptions): boolean {
  if (!isISODate(iso)) return false;
  if (cal?.makeupWorkdays.has(iso)) return true;   // 调休优先
  if (cal?.holidays.has(iso)) return false;
  return new Date(`${iso}T00:00:00Z`).getUTCDay() !== 0; // 周日休息
}
```

优先级：调休上班 > 法定假 > 默认（周一~六）。

把可选 `cal` 参数顺着穿透：`nextWorkingDay`、`addWorkingDays`、`computeStart`(内部)、`generateSchedule`、`rescheduleFrom`、`forecastSchedule`、`flattenPhases`，以及 `shared/schedule-graph.ts` 的 `buildSchedTasks`/`criticalPathTasks`/`scheduleForCategory`。所有签名以 `cal?` 结尾，不传即现状行为。

### B. Schema 变更（drizzle generate 迁移）

新表 `calendar_exceptions`（全局，无 projectId）：

```ts
export const calendarExceptions = pgTable("calendar_exceptions", {
  date: date("date", { mode: "string" }).primaryKey(),       // 一天一条
  type: varchar("type", { length: 16 }).notNull(),           // 'holiday' | 'makeup_workday'
  name: varchar("name", { length: 128 }).notNull().default(""),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
```

迁移走 drizzle-kit generate（见 [[migration-mechanism-unified]]），不写裸 SQL。

### C. 服务层 `server/db.ts`

- `getCalendarExceptions(): Promise<CalendarExceptions>`：一次性 load 全表，按 type 分桶成两个 Set。
- 排期/预测入口（`applyProjectSchedule`、`rescheduleProjectFromTask`、`scheduleForCategory` 调用处、`getPortfolio`/`getMyTasks` 里算 `forecastProjectEnd` 的地方）先取 `cal` 再传入引擎。
- 单次请求内可复用同一 `cal`（避免 N 次全表查）。

### D. admin CRUD（最小）

- tRPC `admin.calendarExceptions`：`list` / `upsert`(date,type,name) / `remove`(date)，仅 `role==='admin'`。
- seed 脚本 `scripts/seed-holidays-2026.ts`：种 2026 年中国法定假 + 调休上班日（含 name），幂等 upsert。
- 前端：现有 admin 后台加一个简单表格（日期 + 类型下拉 + 名称 + 删除），无日历控件。

### E. 预测缩放 `shared/scheduling.ts` `forecastSchedule`

进行中任务改为「计划起始推算已耗工期」：

```ts
const FORECAST_FLOOR = 1; // 工作日
// in_progress（已开工、未完成）:
//   elapsed = workingDaysBetween(plannedStart, today, cal)   // clamp ≥ 0
//   remaining = max(FORECAST_FLOOR, duration - elapsed)
//   forecastStart = today; forecastDue = addWorkingDays(today, remaining, cal)
// todo / 未到计划起始: 全工期（现状）
// done: 锚 completedAt（现状）
```

- 需新增 `workingDaysBetween(fromISO, toISO, cal?)` 工具（纯函数）。
- 逾期未完（elapsed ≥ duration）→ remaining = FLOOR = 1，projectedEnd ≈ 今天+1；RAG 的 `overdueTasks` 维度单独兜底报警，不漏。
- `today` 由调用方传入（上海时区 `todayInShanghaiISO()`），引擎不读时钟。

### 数据流

```
admin 维护 calendar_exceptions ──┐
                                 ▼
db.getCalendarExceptions() → CalendarExceptions {holidays, makeupWorkdays}
                                 │
        ┌────────────────────────┼─────────────────────────┐
        ▼                        ▼                          ▼
applyProjectSchedule       forecastSchedule(on-read)   criticalPathTasks
(写库:新建/手动)            (getPortfolio/getMyTasks)    (Gantt 高亮)
        │                        │
   计划基线日期              projectedEnd → RAG/slip
```

种完节假日后，预测/RAG 立刻变准（on-read）；存量已落库的计划日期不自动改写（无强制迁移）。

## 模块边界

- `shared/scheduling.ts`：纯排期/预测/日历判定。输入 `(tasks, startDate, cal?)`，输出 `Schedule`。不依赖 DB/时钟。
- `db.getCalendarExceptions`：唯一把 DB 例外数据转成引擎输入的适配点。
- `admin.calendarExceptions` 路由 + seed 脚本：数据维护，独立于引擎。
- 预测缩放仅改 `forecastSchedule` 内部，对外 `projectedEndFromSchedule` 签名不变。

## 测试

排期（scheduling.test.ts）：
- 法定假落在计划工作日 → 整体顺延。
- 调休周日 → 计入工作日。
- `addWorkingDays` 跨春节假期段正确跳过。
- 不传 `cal` → 行为与现状逐字节一致（回归保护）。

预测（scheduling.test.ts / portfolio-health.test.ts）：
- in_progress 半程 → 剩余约减半。
- 逾期未完 → 落到 FLOOR=1。
- todo / 未开工 → 全工期不变。
- done → 锚 completedAt 不变。

admin：list/upsert/remove 权限（非 admin 拒绝）、upsert 幂等。

## 明确排除（YAGNI）

- 每项目独立日历（工厂场景同一套日历，全局即可）。
- 完成度% / 实际开始日字段（本期用计划起始推算）。
- 日历可视化控件（admin 纯表格）。
- 内置多年法定假数据（仅 seed 当年；跨年再补脚本）。
- 存量项目日期的节假日回填重排（按需手动触发即可）。
