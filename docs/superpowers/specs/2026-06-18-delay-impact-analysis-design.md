# 延期影响分析 — 设计文档

日期：2026-06-18
状态：已评审，待实现
范围：roadmap #3（延期影响自动分析，P1）。任务改期 → 算下游顺延/是否冲击 Gate/突破目标日 → 改期前预览 + 落库后冲击推送。其余 backlog 各自独立。相关 memory `automation-feature-roadmap`。

## 目标

PM 改某个任务的日期时，当前只会静默重排下游、返回一个改动计数，看不出"这一改会把哪些 Gate 推迟、会不会破目标交付日"。本设计复用排期依赖引擎，在改期**前**给出可预览的「延期影响摘要」，并在改期**落库后**当冲击 Gate 或破目标日时推送 PM。

## 现状（已有基础）

- `shared/scheduling.ts` `rescheduleFrom(schedTasks, current, changedTaskId, newDates): Schedule` —— 纯函数，已能算出改期后**全部下游**任务的新起止日（工作日历、拓扑传播）。`Schedule = Record<taskId, {start, due}>`。
- `shared/schedule-graph.ts` `buildSchedTasks(phases)` 把阶段任务编成 `SchedTask[]`（含 dependsOn/durationDays）。
- `server/db.ts` `rescheduleProjectFromTask(projectId, taskId, start, due)`：加载当前排期 → `rescheduleFrom` → 落库变化行 → `refreshProjectTaskStatuses` → 返回改动计数。
- `server/routers/tasks.ts` `reschedule`（tasks.ts:217）：调上面、返回 `{count}`。
- 自动化引擎：`emitAutomationEvent(event)`（`server/automation/events.ts`）→ `runAutomation`；规则形状 `{key,label,triggerType,defaultEnabled,defaultConfig,configSchema,recipientRoles,matches(event,config),buildMessage(event,config,ctx)}`（见 `rules.ts` 的 `status_change_notify`）。多个 mutation 已在 emit 事件。
- 阶段里 Gate 任务由 `phase.gateTaskId` 标识；`phase.gateName`/`name` 可作展示名。`getPhasesForCategory(category)` 给出全阶段。
- 项目 `targetDate`（`projects.targetDate`，YYYY-MM-DD 或 null）。

缺口：无影响计算、无 dry-run 预览端点、无改期冲击推送规则。

## 关键设计决策（已评审确认）

1. **预览 + 推送两者都做**，共用同一个纯函数 `computeDelayImpact`。
2. **预览 = dry-run，不落库**：独立 query 端点 `tasks.delayImpact`，与落库的 `tasks.reschedule` 分开。
3. **推送门槛 = 冲击 Gate 或破目标日**：纯下游重排（不碰 Gate/目标）属正常调度，不推送。
4. **推送收件人 = PM**（与其他规则一致，规则 config 可调）。
5. **deltaDays 用日历日**（人读直观），排期本身仍走工作日历。

## 设计

### A. 纯函数 `shared/delay-impact.ts`（新增）

无 IO，复用 `rescheduleFrom`，diff 新旧排期。便于单测。

```ts
import { rescheduleFrom, type SchedTask, type Schedule } from "./scheduling";
import { daysBetween } from "./health";  // daysBetween 在 health.ts(非 scheduling)

export type ShiftedTask = { taskId: string; oldDue: string; newDue: string; deltaDays: number };
export type GateImpact = ShiftedTask & { gateName: string | null };
export type TargetBreach = {
  oldProjectedEnd: string;
  newProjectedEnd: string;
  targetDate: string;
  slipDays: number;        // daysBetween(targetDate, newProjectedEnd)，正数=晚
  newlyBreaches: boolean;  // 改期前 oldProjectedEnd <= targetDate、改期后 > targetDate
};

export type DelayImpact = {
  changedTaskId: string;
  shifted: ShiftedTask[];      // 被顺延的下游(排除 changedTaskId 自身)，按 newDue asc
  gateImpacts: GateImpact[];   // shifted ∩ gateTaskIds
  targetBreach: TargetBreach | null;
  maxDeltaDays: number;        // shifted 里最大 deltaDays，无下游=0
  hasImpact: boolean;          // gateImpacts.length>0 || targetBreach!=null（推送门槛）
};

export function computeDelayImpact(input: {
  schedTasks: SchedTask[];
  current: Schedule;
  changedTaskId: string;
  newDates: { start: string; due: string };
  gateTaskIds: Set<string>;
  gateNames?: Record<string, string>;
  targetDate: string | null;
}): DelayImpact;
```

口径：
- `next = rescheduleFrom(schedTasks, current, changedTaskId, newDates)`。
- `shifted`：遍历 `next`，取 `id !== changedTaskId` 且 `current[id]?.due !== next[id].due` 者；`deltaDays = daysBetween(oldDue, newDue)`；只保留 `deltaDays > 0`（顺延；理论上重排只会往后）。按 `newDue` 升序。
- `gateImpacts = shifted.filter(t => gateTaskIds.has(t.taskId))`，附 `gateName = gateNames?.[id] ?? null`。
- `oldProjectedEnd = max(current.due)`，`newProjectedEnd = max(next.due)`。`targetBreach`：仅当 `targetDate && newProjectedEnd > targetDate` 时给出；`newlyBreaches = oldProjectedEnd <= targetDate`。
- `hasImpact = gateImpacts.length > 0 || targetBreach != null`。

> `daysBetween` 复用 `shared/health.ts` 既有导出（两个 YYYY-MM-DD 相减，时区无关）。`rescheduleFrom`/`SchedTask`/`Schedule` 从 `shared/scheduling.ts`。

### B. 影响数据装配（`server/db.ts`）

新增内部 helper 把 DB 状态喂给纯函数（预览与落库共用，口径单源）：

```ts
export async function computeProjectDelayImpact(
  projectId: string, taskId: string, start: string, due: string
): Promise<DelayImpact | null>;  // 项目/任务不存在或无排期→null
```
- 取 `project`（category/targetDate）、全任务当前 `startDate/dueDate` → `current`。
- `schedTasks = buildSchedTasks(getPhasesForCategory(category))`。
- `gateTaskIds`/`gateNames` 从 `getPhasesForCategory` 的 `phase.gateTaskId`/`gateName` 收集。
- 调 `computeDelayImpact(...)` 返回。

### C. 预览端点（dry-run，不落库）

`server/routers/tasks.ts` 新增：
```ts
delayImpact: protectedProcedure
  .input(z.object({ projectId: z.string(), taskId: z.string(), startDate: isoDateInput, dueDate: isoDateInput }))
  .query(async ({ ctx, input }) => {
    await assertProjectAccess(input.projectId, ctx.user);
    return computeProjectDelayImpact(input.projectId, input.taskId, input.startDate, input.dueDate);
  }),
```
纯 query，无副作用。鉴权与其他 tasks 路由一致。

### D. 落库改期返回 impact + 冲击推送（`server/db.ts` + `tasks.reschedule`）

`rescheduleProjectFromTask` 改为：落库前先 `computeProjectDelayImpact`（拿到 impact），落库后返回 `{ count, impact }`；若 `impact?.hasImpact`，调 `emitAutomationEvent`：
```ts
await emitAutomationEvent({
  type: "task.rescheduled",
  projectId,
  taskId,
  impact,                         // 携带影响载荷
  // 既有事件字段(after 等)按 AutomationEvent 规范填
});
```
`tasks.reschedule` 返回体改为 `{ count, impact }`，供 UI 落库后也能展示。

> `AutomationEvent` 类型扩展：加可选 `impact?: DelayImpact` 与 `type: "task.rescheduled"`。emit 失败不阻断改期（`emitAutomationEvent` 已 try/catch）。

### E. 新规则 `delay_impact_notify`（`server/automation/rules.ts`）

```ts
{
  key: "delay_impact_notify",
  label: "延期影响通知",
  triggerType: "event",
  defaultEnabled: false,          // 配好通知渠道后开
  defaultConfig: delayImpactConfigSchema.parse({}),
  configSchema: delayImpactConfigSchema,   // 先空配置/可留扩展位
  recipientRoles: ["pm"],
  matches: (event) => event.type === "task.rescheduled" && !!event.impact?.hasImpact,
  buildMessage: (event, _cfg, ctx) => buildDelayImpactMessage(event, ctx),
}
```
`buildDelayImpactMessage`：摘要文案，如「{项目} 任务 {taskId} 改期 → {Gate 名} 滑 {n} 天；项目目标日 {targetDate} 预计破 {slip} 天」。挂进现有 `AUTOMATION_RULES` 列表 + `AUTOMATION_RULE_KEYS`。

### F. UI（改期确认前预览）

改期入口（任务详情改日期、甘特拖拽确认）在提交前调 `trpc.tasks.delayImpact.useQuery(...)`，弹「延期影响摘要」：
- 顶部：被顺延下游 N 个、最大顺延 maxDeltaDays 天。
- Gate 滑期列表（红）：每个 `gateName 滑 deltaDays 天`。
- 目标日：`newlyBreaches` 高亮"原本可按期，改后破 slip 天"或"目标日延后至 newProjectedEnd"。
- 无影响时简单提示"仅顺延 N 个下游，不冲击 Gate/目标日"。
- 按钮：确认改期（调 reschedule）/ 取消。

### 数据流

```
预览: UI(改期前) → tasks.delayImpact(query) → computeProjectDelayImpact → computeDelayImpact → 摘要 → 弹窗
落库: UI 确认 → tasks.reschedule → rescheduleProjectFromTask
        → computeProjectDelayImpact(impact) → 落库 → 返回{count,impact}
        → impact.hasImpact? emitAutomationEvent(task.rescheduled, impact)
              → runAutomation → delay_impact_notify.matches → buildMessage → 通知 PM
```

## 模块边界

- `shared/delay-impact.ts`（新增）：纯计算，复用 rescheduleFrom。无 DB。
- `server/db.ts`：新增 `computeProjectDelayImpact`（装配+调纯函数）；`rescheduleProjectFromTask` 返回 `{count,impact}` 并条件 emit 事件。
- `server/routers/tasks.ts`：新增 `delayImpact` query；`reschedule` 返回体加 impact。
- `server/automation/rules.ts`：新增 `delay_impact_notify` 规则 + config schema + buildMessage。
- `server/automation/events.ts`/`rules.ts`：`AutomationEvent` 加 `type:"task.rescheduled"` + `impact?` 字段。
- client 改期组件：调 delayImpact 预览。
- 不改 `rescheduleFrom` 等排期纯函数。

## 测试

- `shared/delay-impact.test.ts`（新增，纯函数）：
  - 链尾任务改期 → 无下游，shifted=[]，hasImpact=false。
  - 中段任务推后 → 下游 shifted 正确、deltaDays 正确、按 newDue 排序。
  - 下游含 Gate → gateImpacts 命中、附 gateName。
  - 目标日：改后 newProjectedEnd>targetDate 且原本不破 → targetBreach.newlyBreaches=true、slipDays 正确；原本已破 → newlyBreaches=false。
  - targetDate=null → targetBreach=null。
  - 只顺延不碰 Gate/目标 → hasImpact=false。
- 集成（`server/` DB 测试）：`rescheduleProjectFromTask` 返回 `{count,impact}` 与库内一致；`impact.hasImpact` 时 emit 了 `task.rescheduled`（注入/spy deps 验证），否则不 emit。
- 规则：`delay_impact_notify.matches` 仅在 `task.rescheduled` 且 `impact.hasImpact` 为 true 时命中。

## 明确排除（YAGNI）

- 多任务批量改期的合并影响。
- 提前期（往前赶工）的"提前影响"分析。
- 影响摘要落库存档/历史（只算即时）。
- 钉钉/站内之外的通知渠道。
- 甘特图上的影响可视化叠加（先做确认弹窗）。
