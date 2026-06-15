# 项目健康度自动判定 — 设计文档

日期：2026-06-16
状态：已评审，待实现
范围：五大优先功能中的 #1（项目健康度自动判定）。#2 Gate 就绪度、#3 延期影响、#4 角色分派、#5 异常升级 各自独立成 spec。

## 目标

用 进度、逾期任务、阻塞任务、P0/P1 问题、Gate 临近未就绪、目标日偏差 自动算出每个项目的 绿/黄/红（RAG），并按可配频率（每日/每周）把异常项目推送给 PM 个人与管理群。

## 现状（已有基础）

- `shared/health.ts`：`computeRag(input)` 纯函数，「任一硬触发 → 取最严重」短路逻辑。当前输入：`risk / projectedEnd / targetDate / overdueTasks / blockedTasks / openIssues / criticalIssues`。
- `server/db.ts` `getPortfolio(userId)`：跨项目聚合每项目 `taskTotal/taskDone/overdueTasks/blockedTasks/openIssues/criticalIssues/projectedEnd(=max dueDate)`。
- `client/.../RagHealthPanel.tsx`：唯一调用方，**仅前端**计算 RAG。
- `server/automation/{rules,engine,scheduler}.ts`：成熟的自动化引擎，含 `automation_rules` 配置表、`automationRuns` 运行记录、`hasRecentAutomationFire` 去重、`createNotification`/钉钉个人/群 webhook 分发、interval 调度器。
- `risk` 是 `projects` 表的人工字段，保留。

缺口：进度偏差信号、Gate 临近未就绪信号、目标日偏差分档、原因清单、每日/每周异常项目推送。

## 设计

### A. 增强 RAG 判定（纯逻辑，`shared/health.ts`）

扩展 `RagInput`，新增三个字段（均由上层算好后传入，保持本模块零数据依赖）：

```ts
export type RagInput = {
  risk: "low" | "medium" | "high";
  projectedEnd: string | null;
  targetDate: string | null;
  overdueTasks: number;
  blockedTasks: number;
  openIssues: number;
  criticalIssues: number;       // P0/P1 未关闭
  targetSlipDays: number | null;     // 预计完成 - 目标日（正=晚），无法算→null
  progressBehindPct: number | null;  // 进度落后百分点，无计划项→null
  gateNotReady: "red" | "amber" | null; // Gate 临近未就绪等级
};
```

阈值常量集中在 `health.ts` 顶部（先写死，后续如需再做后台可配）：

```ts
const SLIP_RED = 7;        // 目标日偏差 > 7 天 → 红；1..7 → 黄
const PROGRESS_RED = 20;   // 进度落后 > 20pt → 红；10..20 → 黄
const PROGRESS_AMBER = 10;
```

信号 → 等级映射表（项目取最严重）：

| 信号 | 🔴 红 | 🟡 黄 |
|------|------|------|
| 手动 `risk` | high | medium |
| 逾期任务 `overdueTasks` | ≥1 | — |
| 阻塞任务 `blockedTasks` | — | ≥1 |
| P0/P1 未关闭 `criticalIssues` | ≥1 | — |
| 开放问题 `openIssues` | — | ≥1 |
| 目标日偏差 `targetSlipDays` | > 7 | 1..7 |
| 进度落后 `progressBehindPct` | > 20 | 10..20 |
| Gate 临近未就绪 `gateNotReady` | "red" | "amber" |

注：`targetSlipDays` 取代旧的 `isProjectedOverdue` 二元判断（旧逻辑「任意晚就红」改为分档）。`isProjectedOverdue` 保留为工具函数（供他处复用），但 `computeRag` 改走 `targetSlipDays`。上层用 `targetSlipDays = daysBetween(projectedEnd, targetDate)` 计算。

**两个导出函数：**

- `computeRag(input): RagLevel` — 保持短路「取最严重」：先判所有红触发，命中即 `red`；再判黄触发，命中即 `amber`；否则 `green`。
- `ragReasons(input): string[]` — **不短路**，收集所有触发原因，供摘要解释「为什么红/黄」。例：`["逾期×2", "P0/P1×1", "预计晚9天", "进度落后15pt"]`。等级判定与原因生成共用同一组阈值判断，避免漂移。

### 进度落后口径（确定）

用项目自身计划日期，不用 `scheduleForCategory`（甘特图日期可被 PM 编辑过，项目自身计划才是真实执行口径；目标日偏差已单独捕捉计划整体滑期）：

```
expectedProgressPct = dueItems / totalPlannedItems * 100   // dueItems = 计划 dueDate <= today 的任务数
actualProgressPct   = doneItems / totalPlannedItems * 100  // doneItems = status in (done, skipped)
progressBehindPct   = Math.max(0, expectedProgressPct - actualProgressPct)
```

无计划项（`totalPlannedItems = 0`）或无任何 `dueDate` → `progressBehindPct = null`，避免误报。在 `getPortfolio` 的 task 聚合里加一个 `count(*) filter (where dueDate <= CURRENT_DATE)` 子句即可，无需逐项目生成排期。

### Gate 临近未就绪（简化版）

本期用简化口径，完整版留给 #2 Gate 就绪度：

- 复用 `getAutomationGatePrereqs` 同款聚合：找项目内 Gate 任务（`isGate`）中未关闭、有 `incompletePrereqCount > 0` 且最近到期者。
- 距到期 ≤ 3 天 → `gateNotReady = "red"`；≤ 7 天 → `"amber"`；否则 `null`。
- 每项目取最严重的一个 Gate 作为该项目的 `gateNotReady`。

### B. 健康摘要推送（`server/automation/healthDigest.ts`，新增）

**配置**：存进现有 `automation_rules` 表，`ruleKey = "health_digest"`，复用管理页与 `seedAutomationRuleDefaults`。config（Zod）：

```ts
{
  cadence: "daily" | "weekly" = "daily",
  sendHour: 0..23 = 9,
  weekday: 0..6 = 1,           // cadence=weekly 时生效（1=周一）
  pushPmPersonal: boolean = true,
  pushManagerGroup: boolean = true,
}
```

注：`health_digest` 是聚合型规则，**不**走 `AUTOMATION_RULES` 的 `matches/buildMessage` 循环（形态不同），但配置行同表存储，以便管理页开关/配置。它有独立的扫描函数。需确认管理页能渲染「仅配置、无 event 触发」的规则行（实现时核对 `routers/automation.ts` 与 admin UI）。

**聚合**：`getPortfolioHealthForDigest()` —— 在 `getPortfolio` 基础上补 `dueItems` 与 `gateNotReady`，对每项目算 `computeRag` + `ragReasons`，过滤出黄/红，按 `pmUserId` 分组，并保留全量绿色计数。

**调度**：在 `scheduler.ts` 现有 interval 扫描末尾加 `runHealthDigestScan(now)`：
1. 读 `health_digest` 配置行；`enabled=false` → 直接返回。
2. 判断 `now` 是否落在发送时点（小时 == `sendHour`；weekly 还需 `weekday` 匹配）。
3. 当期去重：用 `automationRuns`（ruleKey=health_digest）查本「天/周」是否已 fired，已发则跳过。
4. 异常列表为空 → 写一条 `skipped`，不发消息。
5. 否则分发后写 `fired`（作为当期去重锚点）。

**分发**（注入 deps，便于测试）：
- `pushPmPersonal`：每个 PM 收到自己名下黄/红项目 → `createNotification` + `notifyUsersViaDingtalk`（个人钉钉工作通知）。
- `pushManagerGroup`：全部黄/红项目汇总 + 绿色计数 → `pushWebhook`（全局群机器人 markdown 卡片，附 appBaseUrl 链接）。「管理群」用全局 webhook，因为是跨项目组合视图，非单项目群。

### 数据流

```
scheduler(interval) → runHealthDigestScan(now)
  → 读 health_digest 配置; enabled?
  → 到点(sendHour/weekday)? & 当期(天/周)未发?
  → getPortfolioHealthForDigest() → computeRag + ragReasons → 过滤黄/红 → 按 PM 分组
  → pushPmPersonal: createNotification + notifyDingtalk(每个 PM 名下异常)
  → pushManagerGroup: pushWebhook(全部异常汇总 + 绿计数)
  → writeRun(health_digest, fired/skipped)   // 当期去重锚点
```

## 模块边界

- `shared/health.ts`：只做纯判定 + 原因生成。无 IO、无数据层依赖。输入即决定输出。
- `server/db.ts`：`getPortfolio` 扩展聚合字段（`dueItems`），新增/扩展供 digest 的健康聚合查询（含 gate 就绪）。
- `server/automation/healthDigest.ts`：只负责聚合、过滤、分组、按时点判定、分发。所有外部副作用经注入的 deps，可在测试中替换。
- `server/automation/scheduler.ts`：只多调一次 `runHealthDigestScan(now)`。

## 测试

- `server/health.test.ts` 扩展：
  - 新信号各档：`targetSlipDays` 8→red / 5→amber / 0→无；`progressBehindPct` 25→red / 15→amber / 5→无 / null→无；`gateNotReady` red/amber/null。
  - `ragReasons` 不短路：多触发同时返回全部原因；绿项目返回空数组。
  - `computeRag` 取最严重：红+黄混合 → red。
- `server/automation/healthDigest.test.ts` 新增（注入 deps，无真实副作用）：
  - 按 PM 正确分组；只发黄/红，绿不发个人。
  - 当期去重：同一天/周第二次扫描不重复发。
  - `enabled=false` 不发；异常列表为空写 skipped 不发。
  - 发送时点判定：非 `sendHour` 不发；weekly 非 `weekday` 不发。

## 明确排除（YAGNI）

- 健康度历史/趋势存储（无需求）。
- 加权评分模型（选用阈值规则）。
- 阈值后台配置 UI（先写死常量）。
- Gate 就绪度完整版（前置完成 + 交付物上传 + P0/P1 关闭 + 评审记录完整）—— 归 #2。
- 异常按时长阶梯升级（负责人→PM→manager）—— 归 #5。
