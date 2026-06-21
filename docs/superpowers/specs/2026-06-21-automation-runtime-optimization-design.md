# Automation Runtime Optimization Design

日期：2026-06-21

范围：代码评审 issue #8、#10

- #8：`exception_escalation` 的特殊行为通过 `rule.key === "exception_escalation"` 硬编码散落在 engine 内。
- #10：自动化调度热路径存在重复规则读取、重复项目/成员读取，以及批量扫描时的 O(N) 放大。

## 背景

当前自动化系统已经支持事件触发、定时扫描、规则配置、通知分发和 automation run 去重。新增异常升级后，某些规则开始需要“动态行为”：

- 动态收件人：异常升级按照 assignee / pm / manager 阶段逐级扩大通知范围。
- 动态 run entityId：异常升级需要把 escalation level 拼进 entityId，避免 assignee、pm、manager 三个阶段互相去重。

现在这些动态行为由 automation engine 直接判断 `rule.key` 实现。短期可用，但当后续再加入类似“风险升级”“Gate 条件跟进升级”“客户问题升级”时，engine 会继续膨胀，规则语义和调度运行时耦合变重。

同时，`runScheduledAutomationScan` 会为每个扫描对象调用一次 `runAutomation`。每次 `runAutomation` 又会：

- 读取 automation rules。
- 读取项目，判断是否归档。
- 构建消息上下文时再次读取项目。
- 解析收件人时再次读取项目和项目成员。

在 20 个 blocked task 或 pending review 的场景下，同一个项目和同一组规则会被重复读取几十次。

## 目标

1. 将规则差异从 engine 中下沉到 rule definition，engine 只执行通用生命周期。
2. 定时扫描内复用规则、项目、成员、消息上下文等只读数据。
3. 保持 automation run 的去重语义、日志语义、通知行为不变。
4. 让后续新增“动态收件人 / 动态 entityId / 自定义 cadence”的规则不再修改 engine 主流程。
5. 为性能优化提供可测试的计数边界，例如“规则表每次 scan 最多读取一次”。

## 非目标

- 不重写自动化规则配置 UI。
- 不引入队列、worker、分布式锁或并发调度框架。
- 不改变现有通知渠道优先级：站内通知、钉钉工作通知、项目群/全局 webhook。
- 不改变 digest rules 的独立聚合调度模型；本设计只给后续复用预留接口。

## 当前问题

### #8 规则硬编码

当前 engine 的特殊处理集中在两处：

- `resolveRecipients` 根据 `rule.key === "exception_escalation"` 调用 `exceptionEscalationRoles`。
- `entityIdForRuleRun` 根据 `rule.key === "exception_escalation"` 拼接升级 level。

问题：

- 新增类似规则必须修改 engine。
- 规则行为散落在 `rules.ts` 和 `engine.ts` 两边，阅读成本高。
- 容易出现“成功分支、跳过分支、错误分支 entityId 不一致”这类遗漏。

### #10 调度热路径重复读取

当前调用链：

```text
runScheduledAutomationScan
  for each scanned entity
    runAutomation(event)
      ensureAutomationRuleDefaults()
      getProjectById(projectId)
      listAutomationRuleRows()
      for each matching rule
        hasRecentAutomationFire()
        buildMessageContext() -> getProjectById(projectId)
        resolveRecipients() -> getProjectById(projectId), getProjectMembers(projectId)
        dispatch
        createAutomationRun()
```

主要重复：

- `listAutomationRuleRows()`：每个 event 重读一次。
- `getProjectById()`：同一 event 内最多 3 次，同一 scan 内按事件数重复。
- `getProjectMembers()`：同一项目多个事件重复读取。
- scan 层不根据启用规则裁剪查询：即使异常升级禁用，也会读取 blocked/critical/review 集合。

## 设计方案

### 1. 给规则定义增加运行时 hooks

在 `BuiltInAutomationRule` 上新增可选 hooks，让规则自己声明动态行为。

建议类型：

```ts
export type AutomationRuleRuntimeHooks<C extends AutomationRuleConfig = AutomationRuleConfig> = {
  resolveRecipientRoles?: (args: {
    event: AutomationEvent;
    config: C;
    defaultRoles: RecipientRole[];
  }) => RecipientRole[];

  entityIdForRun?: (args: {
    event: AutomationEvent;
    config: C;
    baseEntityId: string | null;
  }) => string | null;

  cadenceHoursForRun?: (args: {
    event: AutomationEvent;
    config: C;
    triggerType: "event" | "scheduled";
  }) => number | null;
};
```

`BuiltInAutomationRule` 增加字段：

```ts
runtime?: AutomationRuleRuntimeHooks;
```

默认行为由 engine 提供：

- `resolveRecipientRoles` 默认使用 config.notifyRoles 或 `rule.recipientRoles`。
- `entityIdForRun` 默认使用 `event.entityId`。
- `cadenceHoursForRun` 默认沿用现有 `getCadenceHours` / `getEventCadenceHours`。

`exception_escalation` 规则定义改为：

```ts
{
  key: "exception_escalation",
  ...
  runtime: {
    resolveRecipientRoles: ({ event, config }) =>
      exceptionEscalationRoles(event, config as ExceptionEscalationConfig),

    entityIdForRun: ({ event, config, baseEntityId }) => {
      const level = exceptionEscalationLevel(event, config as ExceptionEscalationConfig);
      return baseEntityId && level ? `${baseEntityId}:${level}` : baseEntityId;
    },

    cadenceHoursForRun: ({ config }) =>
      (config as ExceptionEscalationConfig).cadenceHours,
  },
}
```

这样 engine 不再需要知道 `exception_escalation` 的业务细节。

### 2. 引入 AutomationRuntime，承载 scan 级缓存

新增运行时对象，只在一次 scan 或一次显式 batch 中共享。

建议类型：

```ts
export type AutomationRuntime = {
  now: Date;
  ruleRowsByKey: Map<AutomationRuleKey, AutomationRuleRow>;
  projectCache: Map<string, ProjectRow | null>;
  membersCache: Map<string, ProjectMemberWithUser[]>;
};
```

创建函数：

```ts
export async function createAutomationRuntime(input?: {
  now?: Date;
}): Promise<AutomationRuntime> {
  await ensureAutomationRuleDefaults();
  const rows = await listAutomationRuleRows();
  return {
    now: input?.now ?? new Date(),
    ruleRowsByKey: new Map(rows.map((row) => [row.ruleKey, row])),
    projectCache: new Map(),
    membersCache: new Map(),
  };
}
```

缓存访问器：

```ts
async function getProjectCached(runtime: AutomationRuntime, projectId: string) {
  if (!runtime.projectCache.has(projectId)) {
    runtime.projectCache.set(projectId, await getProjectById(projectId) ?? null);
  }
  return runtime.projectCache.get(projectId) ?? null;
}

async function getMembersCached(runtime: AutomationRuntime, projectId: string) {
  if (!runtime.membersCache.has(projectId)) {
    runtime.membersCache.set(projectId, await getProjectMembers(projectId));
  }
  return runtime.membersCache.get(projectId) ?? [];
}
```

### 3. 支持单事件与批量事件共用 runtime

保留现有调用：

```ts
runAutomation(event, deps)
```

新增可选第三参数：

```ts
runAutomation(event, deps, runtime)
```

新增批量入口：

```ts
export async function runAutomationBatch(
  events: AutomationEvent[],
  deps: DispatchDeps = {},
  runtime = await createAutomationRuntime(),
): Promise<void> {
  for (const event of events) {
    await runAutomation(event, deps, runtime);
  }
}
```

第一阶段仍保持顺序执行，避免通知并发、run 去重竞态和测试不稳定。后续如果要并发，可以按 projectId 分组并发，但不放进本次设计。

### 4. Scheduler 生成事件，再批量执行

当前 scheduler 是“边扫描边执行”。改为：

```ts
export async function runScheduledAutomationScan(now = new Date()) {
  const runtime = await createAutomationRuntime({ now });
  const scanPlan = buildScheduledScanPlan(runtime);
  const events: AutomationEvent[] = [];

  if (scanPlan.needDueTasks) {
    for (const task of await getAutomationDueTasks()) events.push(toTaskDueEvent(task, now));
  }
  if (scanPlan.needDueIssues) {
    for (const issue of await getAutomationDueIssues()) events.push(toIssueDueEvent(issue, now));
  }
  if (scanPlan.needBlockedTasks) {
    for (const task of await getBlockedTasks()) events.push(toBlockedTaskEvent(task, now));
  }
  if (scanPlan.needCriticalIssues) {
    for (const issue of await getAutomationCriticalIssues()) events.push(toCriticalIssueEvent(issue, now));
  }
  if (scanPlan.needPendingReviews) {
    for (const review of await getAutomationPendingDeliverableReviews()) events.push(toPendingReviewEvent(review, now));
  }
  if (scanPlan.needGatePrereq) {
    for (const gate of await getApproachingGates()) events.push(await toGatePrereqEvent(gate, now));
  }

  await runAutomationBatch(events, {}, runtime);
  await runHealthDigestScan(now);
}
```

### 5. 根据启用规则生成 scan plan

`buildScheduledScanPlan(runtime)` 只看启用的 scheduled rules 和解析后的 config。

建议输出：

```ts
type ScheduledScanPlan = {
  needDueTasks: boolean;
  needDueIssues: boolean;
  needBlockedTasks: boolean;
  needCriticalIssues: boolean;
  needPendingReviews: boolean;
  needGatePrereq: boolean;
};
```

规则映射：

- `overdue_reminder` / `due_soon_reminder`
  - scope = tasks/both -> `needDueTasks`
  - scope = issues/both -> `needDueIssues`
- `exception_escalation`
  - include.overdueTasks -> `needDueTasks`
  - include.blockedTasks -> `needBlockedTasks`
  - include.criticalIssues -> `needCriticalIssues`
  - include.pendingReviews -> `needPendingReviews`
- `gate_prereq_incomplete` -> `needGatePrereq`

这样当异常升级禁用或某类 include 关闭时，scheduler 不再读取对应集合。

### 6. Engine 主流程重排

改造后的 `runAutomation` 主流程：

```text
runAutomation(event, deps, runtime)
  project = getProjectCached(runtime, projectId)
  if archived -> return
  for each rule by triggerType
    row = runtime.ruleRowsByKey.get(rule.key)
    if disabled -> continue
    config = parseAutomationRuleConfig(...)
    if !rule.matches(event, config) -> continue
    entityId = resolveEntityId(rule, event, config)
    cadence = resolveCadence(rule, event, config)
    if dedup -> write skipped
    ctx = buildMessageContext(event, runtime)
    message = rule.buildMessage(...)
    recipients = resolveRecipients(rule, event, config, runtime)
    dispatch
    write fired/error with same entityId
```

`resolveRecipients` 改为：

```ts
const configuredRoles = (config as { notifyRoles?: RecipientRole[] }).notifyRoles;
const defaultRoles = Array.isArray(configuredRoles) && configuredRoles.length > 0
  ? configuredRoles
  : rule.recipientRoles;
const effectiveRoles = rule.runtime?.resolveRecipientRoles?.({
  event,
  config,
  defaultRoles,
}) ?? defaultRoles;
```

### 7. 数据读取量预期

以同一项目 20 个 blocked tasks、1 条 exception rule 为例：

| 项目 | 当前 | 优化后 |
| --- | ---: | ---: |
| `listAutomationRuleRows` | 20 次 | 1 次 |
| `getProjectById` | 40-60 次 | 1 次 |
| `getProjectMembers` | 20 次 | 1 次 |
| `hasRecentAutomationFire` | 20 次 | 20 次 |
| `createAutomationRun` | 20 次 | 20 次 |

去重查询和 run 写入仍按事件执行，因为它们是每个 entity 的审计边界，不建议合并。

## 兼容性

- `runAutomation(event, deps)` 保持可用。
- 现有 tests 可以逐步迁移到 `runAutomationBatch`，不强制一次改完。
- 规则配置 JSON 不变。
- automation run 表结构不变。
- `exception_escalation` 的 run entityId 保持当前 level 化格式。

## 实施步骤

### Phase 1：规则 hooks 下沉

1. 扩展 `BuiltInAutomationRule` 类型，加入 `runtime` hooks。
2. 将 `exception_escalation` 的收件人解析、entityId 后缀、cadence 逻辑移入 rule definition。
3. 删除 engine 内 `rule.key === "exception_escalation"` 分支。
4. 补测试：`engine.ts` 中不再需要硬编码 exception key；异常升级 fired/skipped/error 的 entityId 均一致。

### Phase 2：AutomationRuntime 缓存

1. 新增 `createAutomationRuntime`。
2. `runAutomation` 接收可选 runtime。
3. `buildMessageContext`、`resolveRecipients` 改用 runtime cache。
4. 补测试：同一 runtime 下同项目多个 event 只读取一次 project/members。

### Phase 3：Scheduler batch 化

1. scheduler 先创建 runtime。
2. 将扫描对象转换成 events 数组。
3. 使用 `runAutomationBatch(events, deps, runtime)`。
4. 补测试：一次 scheduled scan 只读取一次 rule rows。

### Phase 4：Scan plan 裁剪查询

1. 实现 `buildScheduledScanPlan(runtime)`。
2. 根据启用规则和 config 控制是否调用各类 scanner。
3. 补测试：
   - 关闭 `exception_escalation.include.blockedTasks` 后不调用 `getBlockedTasks`。
   - 关闭 due soon / overdue 相关规则后不调用 due task / due issue scanner。

## 测试计划

### 单元测试

- `rules.test.ts`
  - `exception_escalation.runtime.resolveRecipientRoles` 在 2/5/10 天阈值下返回正确角色。
  - `exception_escalation.runtime.entityIdForRun` 返回 level 化 entityId。

- `engine.test.ts`
  - fired/skipped/error 三种 run 状态使用同一个 resolved entityId。
  - 同一 runtime、多事件、同项目时 project/members 读取次数为 1。
  - 未传 runtime 时行为与当前一致。

- `scheduler.test.ts`
  - `runScheduledAutomationScan` 每次 scan 只创建一次 runtime。
  - scan plan 根据规则启用状态裁剪 scanner。

### 集成测试

- 保留现有 automation engine / scheduler / health digest 全量测试。
- 增加一个批量 blocked tasks 场景：
  - 20 条 blocked tasks 属于同一项目。
  - 期望通知/run 数量仍为 20。
  - 期望 project/members/rules 读取次数不随 20 线性增长。

### 回归测试

- `exception_escalation` assignee / pm / manager 三阶段仍独立去重。
- disabled rule 不触发。
- archived project 不触发。
- no recipients 仍写 skipped run。

## 验收标准

1. `pnpm check` 通过。
2. `node scripts/test.mjs` 全量通过。
3. `server/automation/engine.ts` 不再出现 `rule.key === "exception_escalation"`。
4. scheduled scan 中 `listAutomationRuleRows()` 每次最多执行一次。
5. 同一 scan、同一 project 的 `getProjectById()` 和 `getProjectMembers()` 每类最多执行一次。
6. 异常升级 fired/skipped/error run 的 `entityId` 均包含相同 escalation level 后缀。
7. 新增类似动态规则时，只需要修改 `rules.ts` 中该规则定义，不需要修改 engine 主流程。

## 风险与取舍

- 缓存只在单次 runtime 内有效，不跨 scan 保存，避免规则配置、项目归档、成员变更的陈旧数据问题。
- 第一阶段 batch 仍顺序执行，牺牲一部分吞吐，换取去重行为稳定。
- `hasRecentAutomationFire` 仍保留逐事件查询，因为去重边界是 rule + entityId；后续可以按 rule/entityId 批量预取，但不放在本轮。
- Gate readiness 仍可能按 gate 逐个计算；如果后续 gate 数量上来，可再设计 gate readiness batch API。

## 后续可选优化

1. 批量预取 recent automation runs：
   - 输入本次 batch 的 `(ruleKey, entityId)` 集合。
   - 一次 SQL 查出 cadence 窗口内已 fired 的 run。
   - 替代逐事件 `hasRecentAutomationFire`。

2. 通知批量写入：
   - 对站内通知可批量 insert。
   - 钉钉工作通知仍按渠道能力决定是否批量。

3. 事件 coalescing：
   - 同一 task 同时属于 due soon / overdue / blocked 时，由 scheduler 明确优先级。
   - 当前建议优先级：blocked > overdue > due soon。

4. 运行时指标：
   - 输出 scan 级 debug summary：events count、rules evaluated、project cache hits、member cache hits、runs fired/skipped/error。
   - 先写 structured log，不进入 DB schema。
