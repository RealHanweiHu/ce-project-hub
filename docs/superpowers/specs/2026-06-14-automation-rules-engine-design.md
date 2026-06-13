# 自动化规则引擎 设计文档

- 日期：2026-06-14
- 状态：已通过头脑风暴，待实现计划
- 借鉴来源：飞书项目「智能硬件制造(IHM)」方案的「DIY 自动化提醒 / 缺陷状态流转 / 量产播报」能力，按本项目（消费电子工厂 NPD/PLM、单容器自托管、已有钉钉通道）裁剪。

## 1. 目标与范围

给 ce-project-hub 加一个**轻量自动化引擎**：在项目协作的关键事件/时点上，自动把通知送到对的人和钉钉群，减少人工催办与漏跟。

第一版（MVP）覆盖 4 类场景，**动作全部是“通知”**（站内通知 + 可选钉钉群推送），不做任何改状态类副作用动作。

### MVP 内置 4 条规则
1. `overdue_reminder` — 逾期催办（时间型）
2. `high_severity_issue` — P0/P1 缺陷升级（事件型）
3. `status_change_notify` — 状态流转通知（事件型）
4. `mp_release_broadcast` — 量产发布播报（事件型）

### 关键决策（来自头脑风暴）
- **配置方式**：内置规则库 + 管理员开关/配参。**不做**自由拼装的“触发→条件→动作”可视化编辑器。
- **作用域**：全局统一一套规则；通知对象按角色在运行时解析到各项目的具体人。**不做**按项目覆盖。
- **执行模型**：进程内。事件型规则在写操作链路同步触发；时间型规则由 app 进程内的定时器周期扫描。**不引入** Redis/队列/外部 cron。
- **行为在代码、配置在库**：4 条规则的触发/条件/动作逻辑写死在代码（规则目录），数据库只存每条规则的 `enabled` + `config`。

### 明确不做（YAGNI）
- 自由规则编辑器；改状态/推进阶段等副作用动作；按项目覆盖配置；多副本分布式锁（当前单副本，未来再加）。

## 2. 架构与组件

行为在代码、配置在库。模块边界：

| 模块 | 职责 | 依赖 |
|---|---|---|
| `server/automation/rules.ts` | 内置规则目录：每条规则的 key、触发类型、默认参数、`matches()` 条件、收件人规格、消息构造器 | schema 类型 |
| `server/automation/engine.ts` | `runAutomation(event)`：取启用规则 → 判条件 → 解析收件人 → 派发（站内 + 可选钉钉）→ 落 `automation_runs` | db、notify、rules |
| `server/automation/scheduler.ts` | 进程内定时器（默认每 30min）跑时间型规则；每 tick 独立 try/catch | engine、db |
| `server/automation/events.ts` | `emitAutomationEvent(event)`：写操作后调用的薄封装，非阻断 | engine |
| `server/routers/automation.ts` | tRPC（仅 admin）：`listRules` / `updateRule` / `listRuns` | db |
| 客户端 `AutomationSettings`（Admin 内） | 规则列表（开关 + 参数）+ 最近运行记录 | trpc |

收件人解析与通知落地复用现有 `createNotification` 与 `pushWebhook`，引擎不重复造轮子。

## 3. 数据模型

新增 2 张表（附加式迁移，不动现有表）。

### `automation_rules`（每条内置规则的状态）
```
id          serial PK
ruleKey     varchar(64) UNIQUE   -- 对应代码里的内置规则 key
enabled     boolean NOT NULL default false
config      jsonb   NOT NULL default '{}'   -- 见各规则的参数 schema
updatedBy   integer
updatedAt   timestamp
```
说明：迁移时 **seed 4 条规则的默认行**（`enabled` 与 `config` 默认值见 §4 目录表）。规则的**行为不存库**——只存开关与参数。代码目录里找不到定义的 ruleKey（已下线）在加载时被忽略。

### `automation_runs`（审计 + 防重发依据）
```
id          serial PK
ruleKey     varchar(64)
projectId   varchar(32)          -- 可空（全局事件）
eventType   varchar(64)          -- 触发的 action / 'scheduled'
entityType  varchar(32)          -- task | issue | gate | mp_release | ...
entityId    varchar(64)
status      varchar(16)          -- fired | skipped | error
recipients  jsonb                -- [{userId, channel}] / {group:true}
detail      text                 -- 消息摘要或错误信息
createdAt   timestamp default now()
```
索引：`(ruleKey, entityId, createdAt)` 支撑防重发查询；`(projectId, createdAt)` 支撑审计列表。

## 4. 触发 / 条件 / 动作目录

收件人角色（运行时按项目解析）：
- `assignee` 任务/问题负责人 · `reporter` 问题创建者 · `pm` 项目 pmUserId · `manager` 成员中 manager 角色 · `owner` 项目 createdBy · `group` 钉钉群（`pushWebhook`）

| ruleKey | 触发 | 条件（可配） | 动作 | 默认启用 | 默认推群 |
|---|---|---|---|---|---|
| `overdue_reminder` | 定时扫描 | task/issue 过 dueDate 且状态未完成；`graceDays`(默认0)；`cadenceHours`(默认24)；`scope`(tasks/issues/both)；`notifyRoles`(默认 assignee,pm) | 通知“X 已逾期 N 天” | 是 | 否 |
| `high_severity_issue` | issue 创建；issue 更新且 severity 升入集合 | `severities`(默认 [P0,P1]) | 通知 pm,manager,assignee | 是 | 是 |
| `status_change_notify` | issue 状态变；task 状态变；gate 决议落定 | `transitions`(默认 issue→resolved/closed、gate→approved/rejected) | 通知 reporter/assignee,pm | 否 | 否 |
| `mp_release_broadcast` | MP Release 完成 | 无 | 群播报发布摘要（产品/版本/项目）+ 通知成员 | 是 | 是 |

各规则 `config` 的形状由 `rules.ts` 里该规则的默认参数定义；`updateRule` 用 zod 按规则校验传入的 config 子集（合并进默认值）。

## 5. 执行流

### 事件型
1. 写操作（如 issues.create / issues.update / tasks.setMeta / gateReviews.update / MP release）成功后，调用 `emitAutomationEvent({ action, projectId, entityType, entityId, before, after, actorId })`。`before/after` 用于判断“相关字段是否真的变化”。
2. 该调用 `await` 但**非阻断**：内部整体 try/catch，失败只 warn，绝不让自动化错误冒泡到写操作。
3. `runAutomation(event)`：
   - 取 `enabled=true` 且触发类型匹配 `action` 的规则；
   - 逐条 `rule.matches(event, config)` 判条件（含 before/after 字段变化判断 → 天然“一事件一次”）；
   - `rule.resolveRecipients(event, config)` → 去重的 userId 列表 + 是否推群；
   - 对每个 userId `createNotification(...)`；若推群且配了 webhook，`pushWebhook(...)`；
   - 写一条 `automation_runs`（fired / skipped）。

### 时间型
1. `scheduler` 每 30min tick（间隔可配，默认值常量）。
2. 对每条启用的时间型规则：按 `scope` 扫描候选实体（逾期未完成的 task/issue）。
3. 防重发：触发前查 `automation_runs` 是否存在同 `(ruleKey, entityId, status='fired')` 且在 `cadenceHours` 窗口内 → 命中则记 `skipped`（或直接不记），否则 fire。
4. 派发同事件型；落 run。

### 需要补的埋点
现有 `createActivityLog` 未覆盖以下事件，需在对应路由补 `emitAutomationEvent`（并按需补 activity log）：
- `issue.update`（状态/严重度变化）、`issue.close`
- `task.update_meta` 的状态变化（已落 activity，但需带 before/after 给引擎）
- `gate.update`（决议落定）
- `mp.release`（MP Release 完成）

## 6. 错误处理

- 引擎对**每条规则**的判定/派发包 try/catch：单条失败写 `status='error'` 的 run + detail，不影响其他规则。
- `emitAutomationEvent` 外层 try/catch：自动化任何异常都不冒泡到写操作链路（沿用 `pushWebhook` 的“非致命”原则）。
- 钉钉推送失败不影响站内通知（两者独立调用）。
- 定时器每个 tick 独立 try/catch；规则扫描异常只影响当条规则当次。

## 7. 测试（TDD）

`server/automation.test.ts`（打本地 PG，seed 项目 + 成员 + issue/task）：
1. 事件型：给定事件 + 启用规则 + 配参 → 断言收件人解析正确、`createNotification` 已建、`automation_runs` 已记 `fired`。
2. 条件过滤：severity 不在集合 → 不触发；状态流转不在 `transitions` → 不触发。
3. before/after：字段未变化的 update 事件 → 不触发。
4. 防重发：同一逾期实体二次扫描在 `cadenceHours` 内 → 记 `skipped`，不重复通知。
5. 关闭的规则 → no-op。
6. 隔离性：一条规则 `matches`/派发抛错 → 写 error run，其余规则仍正常执行。

引擎对 `pushWebhook` 做注入/桩，避免测试真发钉钉。

## 8. 配置项

- `AUTOMATION_SCAN_INTERVAL_MIN`（默认 30）：定时器扫描间隔。
- 复用现有 `NOTIFY_WEBHOOK_*` 做群推送；未配 webhook 时“推群”动作自动降级为仅站内。
- 部署：附加式迁移（建 2 表 + seed 4 条规则的默认行）；本地 docker 验证 → RDS 幂等 SQL + 手工补 `__drizzle_migrations` 记录（沿用既有纪律）。

## 9. 交付后

- 进入 `writing-plans` 出实现计划，按既有“每刀”纪律落地：分支 → TDD → 本地 docker 验证 → RDS 迁移 → 部署 → 合并 → push。
