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

扩展 `RagInput`，**只新增两个字段**（`progressBehindPct`、`gateNotReady`）；目标日偏差由 `computeRag` 内部从已有的 `projectedEnd`/`targetDate` 推导，避免让调用方（含前端面板）多算一项。各字段均由上层算好后传入，保持本模块零数据依赖：

```ts
export type RagInput = {
  risk: "low" | "medium" | "high";
  projectedEnd: string | null;       // = max(task.dueDate)，当前计划结束日(语义见「plannedEnd 语义」)
  targetDate: string | null;
  overdueTasks: number;
  blockedTasks: number;
  openIssues: number;
  criticalIssues: number;            // P0/P1 未关闭
  progressBehindPct: number | null;  // 进度落后百分点，无计划项→null（上层算好传入）
  gateNotReady: "red" | "amber" | null; // Gate 临近未就绪等级（上层算好传入）
};
```

`computeRag`/`ragReasons` 内部：`targetSlipDays = daysBetween(projectedEnd, targetDate)`（两个 `YYYY-MM-DD` 字符串相减，与时区无关），无法算（任一为 null）→ 视为无偏差。

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

注：`targetSlipDays` 取代旧的 `isProjectedOverdue` 二元判断（旧逻辑「任意晚就红」改为分档）。`isProjectedOverdue` 保留为工具函数（供他处复用），但 `computeRag` 改走 `targetSlipDays`。上层用 `targetSlipDays = daysBetween(plannedEnd, targetDate)` 计算（见下「plannedEnd 语义」）。

**两个导出函数：**

- `computeRag(input): RagLevel` — 保持短路「取最严重」：先判所有红触发，命中即 `red`；再判黄触发，命中即 `amber`；否则 `green`。
- `ragReasons(input): string[]` — **不短路**，收集所有触发原因，供摘要解释「为什么红/黄」。例：`["逾期×2", "P0/P1×1", "预计晚9天", "进度落后15pt"]`。等级判定与原因生成共用同一组阈值判断，避免漂移。

### 进度落后口径（确定）

用项目自身计划日期，不用 `scheduleForCategory`（甘特图日期可被 PM 编辑过，项目自身计划才是真实执行口径；目标日偏差已单独捕捉计划整体滑期）。

**分母必须是「有计划日期的任务」，不是 `taskTotal`** —— 否则无 `dueDate` 的任务会稀释进度落后：

```
plannedItems     = count(dueDate is not null)                              // 分母
dueItems         = count(dueDate is not null and dueDate <= :todayISO)     // 到今天应完成
donePlannedItems = count(dueDate is not null and status in (done,skipped)) // 已完成(限有计划日期的)

expectedProgressPct = dueItems / plannedItems * 100
actualProgressPct   = donePlannedItems / plannedItems * 100
progressBehindPct   = Math.max(0, expectedProgressPct - actualProgressPct)
```

`plannedItems = 0`（无任何带 `dueDate` 的任务）→ `progressBehindPct = null`，避免误报。SQL 里用传入的 `:todayISO`（见「日期/时区」），**不用 `CURRENT_DATE`**。

### plannedEnd 语义（澄清）

现有 `PortfolioRow.projectedEnd = max(task.dueDate)`，实质是「当前计划结束日」而非预测算法算出的预计完成日。本设计统一改称 `plannedEnd`，digest 聚合查询输出该字段名；`targetSlipDays = daysBetween(plannedEnd, targetDate)`。为避免前端连带改动，**暂不重命名**现有 `PortfolioRow.projectedEnd` 字段，但代码注释写明其取值口径。

### Gate 临近未就绪（简化版）

本期用简化口径，完整版留给 #2 Gate 就绪度：

- 复用 `getAutomationGatePrereqs` 同款聚合：找项目内 Gate 任务（`isGate`）中未关闭、有 `incompletePrereqCount > 0` 且最近到期者。
- `daysUntilGate = daysBetween(:todayISO, gate.dueDate)`。**包括已过期（负数）**：现有 `matchesGatePrereq` 用 `d >= 0 && d <= leadDays` 会漏掉昨天已过 Gate 但前置未完的情况；健康度判定不能漏，故：
  - `daysUntilGate <= 3` → `gateNotReady = "red"`（含负数/已过期）
  - `daysUntilGate <= 7` → `"amber"`
  - 否则 `null`
- 每项目取最严重的一个 Gate 作为该项目的 `gateNotReady`。

### B. 健康摘要推送（`server/automation/healthDigest.ts`，新增）

**配置 + 管理页可见性**：config 行存进现有 `automation_rules` 表，`ruleKey = "health_digest"`。但现有 `automationRouter.listRules` 只映射静态 `AUTOMATION_RULES`、`updateRule` 只接受 `z.enum(AUTOMATION_RULE_KEYS)` —— 单纯 seed 一行 UI 看不到也存不了。故新增独立的「digest 规则描述符」并改造 router：

```ts
// server/automation/digestRules.ts
export const DIGEST_RULE_KEYS = ["health_digest"] as const;
export const DIGEST_RULES = [{
  key: "health_digest",
  label: "健康度摘要推送",
  triggerType: "digest",          // 标记：不进 runAutomation
  defaultEnabled: false,          // 默认关，配好 webhook/钉钉再开
  defaultConfig: healthDigestConfigSchema.parse({}),
  configSchema: healthDigestConfigSchema,
}] as const;
```

config（Zod `healthDigestConfigSchema`）：

```ts
{
  cadence: "daily" | "weekly" = "daily",
  sendHour: 0..23 = 9,         // Asia/Shanghai
  weekday: 1..7 = 1,           // cadence=weekly 时生效(ISO: 1=周一)
  pushPmPersonal: boolean = true,
  pushManagerGroup: boolean = true,
}
```

Router 改造（最小面）：`listRules` 在返回末尾追加 `DIGEST_RULES` 映射；`updateRule` 的 `ruleKey` 改为 `z.enum([...AUTOMATION_RULE_KEYS, ...DIGEST_RULE_KEYS])`，配置解析按 key 路由到对应 schema；`seedAutomationRuleDefaults` 一并 seed digest 行。**`runAutomation` 不动**——它仍只遍历 `AUTOMATION_RULES`，引擎永不执行 digest（`triggerType:"digest"` 仅作 UI 标识）。

**聚合**：`getPortfolioHealthForDigest(todayISO)`（`server/db.ts` 新增，**不复用** `getPortfolio(userId)`）：
- 直接查 `projects.archived = false` 的**全量活跃项目**（管理群需看全部，不能用某用户视角）。
- 聚合每项目：`overdueTasks/blockedTasks/openIssues/criticalIssues/plannedEnd`，加 `plannedItems/dueItems/donePlannedItems`（算 `progressBehindPct`），加 gate 就绪聚合（算 `gateNotReady`）。SQL 一律用传入 `todayISO`。
- 对每项目算 `computeRag` + `ragReasons`，过滤出黄/红，按 `pmUserId` 分组，并保留全量绿色计数。

**调度**：在 `scheduler.ts` 现有 interval 扫描末尾加 `runHealthDigestScan(now)`：
1. 读 `health_digest` 配置行；`enabled=false` → 直接返回。
2. **时区统一**：用 `now` 在 `Asia/Shanghai` 下算出 `todayISO`、`hour`、`isoWeekday`，及本期标识 `periodKey`（daily=`2026-06-16`，weekly=`2026-W25`）。
3. **命中 + 去重（一体判断，支持补发）**：
   - 算本期「计划发送时间」`scheduledAt`（daily：当天 `sendHour:00`；weekly：本 ISO 周 `weekday` 当天 `sendHour:00`）。
   - 查 `automationRuns`（ruleKey=health_digest，`entityId == periodKey`）是否已有**任意** run（`fired` 或 `skipped`）。
   - 条件：`now >= scheduledAt` 且 本期无 run → 处理本期。否则返回。
   - 这样服务在 9:00 没跑、9:30 才扫到也能补发；30 分钟扫描多次只处理一次（已有 run 即跳过）。
4. 处理：调 `getPortfolioHealthForDigest(todayISO)`。异常列表为空 → 写 `skipped`（**算本期已处理锚点**），不发消息。
5. 否则分发后写 `fired`（`entityId = periodKey`）。

> 口径确定：固定播报 —— 本期任何 `fired` **或** `skipped` 都算已处理，去重查询两者都算。即「9 点为空就本期不再补」，避免同一天反复扫出不同结果重复打扰。

**分发**（注入 deps，便于测试）：
- `pushPmPersonal`：每个 PM 收到自己名下黄/红项目 → `createNotification` + `notifyUsersViaDingtalk`（个人钉钉工作通知）。
- `pushManagerGroup`：全部黄/红项目汇总 + 绿色计数 → `pushWebhook`（全局群机器人 markdown 卡片，附 appBaseUrl 链接）。「管理群」用全局 webhook，因为是跨项目组合视图，非单项目群。

### 数据流

```
scheduler(interval) → runHealthDigestScan(now)
  → 读 health_digest 配置; enabled?
  → Asia/Shanghai 算 todayISO/hour/weekday/periodKey
  → now >= 本期 scheduledAt? & 本期(periodKey)无 fired/skipped run?
  → getPortfolioHealthForDigest(todayISO)   // 全量 archived=false 项目
      → computeRag + ragReasons → 过滤黄/红 → 按 PM 分组 + 绿计数
  → 空: writeRun(skipped, entityId=periodKey)  // 本期已处理，不发
  → 非空:
      pushPmPersonal:   createNotification + notifyDingtalk(每个 PM 名下异常)
      pushManagerGroup: pushWebhook(全部异常汇总 + 绿计数)
      writeRun(fired, entityId=periodKey)       // 本期去重锚点
```

## 日期/时区（统一口径）

DB 时区与 Node 时区可能不一致，直接混用 SQL `CURRENT_DATE` 与 Node `now` 会导致摘要早/晚一天。统一规则：
- digest 在 app 侧用 `Asia/Shanghai` 算出 `todayISO`（`YYYY-MM-DD`）、`isoWeekday`、`hour`、`periodKey`。
- 所有 digest 聚合 SQL（`getPortfolioHealthForDigest`）用传入的 `:todayISO` 比较，不用 `CURRENT_DATE`。
- 现有 `getPortfolio`（前端面板路径）维持 `CURRENT_DATE` 不动（非本期目标，避免连带回归）。

## 模块边界

- `shared/health.ts`：只做纯判定 + 原因生成。无 IO、无数据层依赖。输入即决定输出。
- `server/automation/digestRules.ts`（新增）：digest 规则描述符 + `healthDigestConfigSchema`。纯声明，无副作用。
- `server/db.ts`：新增 `getPortfolioHealthForDigest(todayISO)`（查 `archived=false` 全量项目 + 进度/gate 聚合）。`getPortfolio` 仅可选地补 `dueItems` 给前端面板（如需面板也显示进度信号），否则不动。
- `server/automation/healthDigest.ts`（新增）：只负责命中/去重判定、聚合调用、过滤分组、分发。所有外部副作用经注入的 deps，可在测试中替换。
- `server/automation/scheduler.ts`：只多调一次 `runHealthDigestScan(now)`。
- `server/routers/automation.ts`：`listRules`/`updateRule` 合入 `DIGEST_RULES`；`runAutomation` 不变。

## 测试

- `server/health.test.ts` 扩展：
  - 新信号各档：`targetSlipDays` 8→red / 5→amber / 0→无；`progressBehindPct` 25→red / 15→amber / 5→无 / null→无；`gateNotReady` red/amber/null。
  - `ragReasons` 不短路：多触发同时返回全部原因；绿项目返回空数组。
  - `computeRag` 取最严重：红+黄混合 → red。
- `server/automation/healthDigest.test.ts` 新增（注入 deps，无真实副作用）：
  - 按 PM 正确分组；只发黄/红，绿不发个人。
  - 当期去重：同一 `periodKey` 第二次扫描不重复发（已有 fired 或 skipped 即跳过）。
  - 补发：`now` 晚于 `scheduledAt` 且本期无 run → 仍发（服务晚启动场景）。
  - 未到点：`now < scheduledAt` → 不处理。
  - `enabled=false` 不发；异常列表为空 → 写 skipped 且本期不再发（空也算已处理）。
  - weekly：非目标 `weekday` 的 `periodKey` 未到 `scheduledAt` → 不发。
  - 聚合覆盖全量：`getPortfolioHealthForDigest` 含某用户未创建/未加入的 `archived=false` 项目。

## 明确排除（YAGNI）

- 健康度历史/趋势存储（无需求）。
- 加权评分模型（选用阈值规则）。
- 阈值后台配置 UI（先写死常量）。
- Gate 就绪度完整版（前置完成 + 交付物上传 + P0/P1 关闭 + 评审记录完整）—— 归 #2。
- 异常按时长阶梯升级（负责人→PM→manager）—— 归 #5。
