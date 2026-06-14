# 自动排期引擎 + 周会提醒 设计文档

- 日期：2026-06-14
- 状态：已通过头脑风暴，待最终复核 → 实现
- 借鉴来源：飞书项目 SKG / 范泰克(fantikk) 案例——「一页纸 WBS：PM 输入开始时间后排期自动生成；改一处，后续联动顺延」+「项目创建后自动生成周会提醒」。

## 1. 目标与关键决策

把项目管理轴从「资料展示」推进成「项目推进系统」。第一版聚焦两件事：
1. **自动排期引擎**：每个 SOP 任务预置「工期 + 依赖」，项目按开始日自动生成全套任务起止日期；过程中改任意一项，下游联动顺延。
2. **周会提醒（轻量档）**：项目创建后默认配一个每周例会，按周往钉钉群推提醒卡片（复用现有 webhook + 自动化 scheduler，不建钉钉应用）。

### 关键决策（头脑风暴确定）
- **依赖图由我按 IPD 消费电子流程预置**进 SOP 模板（PM 零录入负担）。
- **日历日**（非工作日）——对硬件长交期（模具/认证/打样）更贴实，且不维护节假日表；工作日制留后续。
- **正向排期**：从项目开始日向后推；算出预计完成日，超过 `targetDate` 则标记超期。不做反向倒排。
- **依赖 = finish-to-start**；阶段串联靠「每阶段入口任务依赖上一阶段的 gateTaskId」，复用现有 gate 把关。
- **改一项 → 只向后重算其传递后继**，上游不动；v1 不做「锁定/手工 pin」。
- **周会 = 轻量档**：只推群提醒，无真日历/会议链接（webhook 能力所限，已与用户确认）。

### 不在本期范围（YAGNI）
工作日/节假日历、反向倒排、关键路径高亮、资源/产能占用、真钉钉日程+会议链接。

## 2. 数据模型

### SOP 模板（代码，无迁移）——`shared/sop-templates.ts`
- `SOPTask` 增：
  - `durationDays: number` —— 任务工期（日历日；评审/Gate 任务设 0–1 天）
  - `dependsOn?: string[]` —— 前置任务 id（同项目内 taskId；跨阶段可指向上一阶段 gateTaskId）
- `SOPPhase` 增（可选）：`bufferDays?: number` —— 进入该阶段前的缓冲天数（默认 0）

### 持久化（附加式迁移 0011）
- `project_tasks` 增列 `startDate: date(mode:"string")`（已有 `dueDate`）。
- `projects` 增列 `meetingConfig: jsonb`，形如 `{ enabled, weekday(0-6), time:"HH:MM", durationMin, title }`，默认 `{ enabled:true, weekday:3, time:"15:00", durationMin:60, title:"项目周会" }`。
- 前端 `TaskDetails` 增 `startDate?: string`；`Project` 增 `meetingConfig?`。

## 3. 依赖图编排（我来做的"复杂活"）

原则：
- 每阶段**入口任务**（无阶段内前置者）`dependsOn = [上一阶段.gateTaskId]`，实现阶段串联；首阶段入口无依赖（= 项目开始日）。
- 阶段内：能并行的并行（无相互依赖），有先后的串依赖；**Gate 任务**依赖该阶段所有关键产出任务。
- 工期为首版经验值，**可在模板里随时调**（纯数据）。

**NPD 已编排示例（concept + planning，其余阶段实现时同法补全）：**

| 任务 | 名称 | durationDays | dependsOn |
|---|---|---|---|
| c1 | 市场调研与竞品分析 | 7 | （阶段入口，无） |
| c2 | 用户需求收集 VoC | 7 | （并行，无） |
| c3 | 产品概念定义 | 5 | c1, c2 |
| c4 | 技术可行性评估 | 7 | c3 |
| c5 | 商业可行性分析 | 5 | c3 |
| c6 | 立项评审 (Gate1) | 1 | c4, c5 |
| p1 | 产品需求文档 PRD | 10 | c6 |
| p2 | 产品规格书 PSD | 10 | p1 |
| p3 | 项目时程规划 | 5 | p1 |
| p4 | BOM 初版 | 7 | p2 |
| p5 | 关键供应商初选 | 14 | p4 |
| p6 | 团队组建与资源分配 | 5 | c6 |
| p7 | Kickoff (Gate2) | 1 | p2, p3, p5, p6 |

- **design / EVT / DVT / PVT / MP** 五阶段、以及 **ECO(5) / IDR(4)** 全量，实现时按同一原则补齐（含模具 T1/T2、EVT/DVT/PVT build、认证送测等长交期节点的合理工期）。
- 实现 PR 里会附完整依赖图表供你核对、调参。

## 4. 排期算法（纯函数，shared/，可单测）

`shared/scheduling.ts`：
- `generateSchedule(category, startDateISO) → Record<taskId, { start: string; due: string }>`
  - 取该 category 的 phases→tasks，按 `dependsOn` 拓扑序正向遍历；
  - `start = max(各前置.due) + 阶段 bufferDays`（无前置 = 项目开始日）；`due = start + durationDays`（日历日）；
  - 返回每任务 start/due；项目预计完成 = 最大 due。
- `rescheduleFrom(schedule, deps, changedTaskId, newDates) → schedule'`
  - 锚定被改任务的新 start/due，**仅重算其传递后继**（BFS/拓扑），上游与无关分支不动。
- 纯函数、确定性（不读时钟，startDate 由入参传入）；环检测：若 dependsOn 成环则跳过成环节点并告警（防御）。

## 5. 接入与 UI

- **建项目**：拿到 category + 开始日 → `generateSchedule` → 批量写入各任务 `startDate/dueDate`（createProjectWithSeed 之后补一步排期写入）。开始日为空则不自动排（保持手填）。
- **改任务日期**：任务详情/甘特里改 start 或 due → `rescheduleFrom` 算下游 → 批量保存变更任务。
- **「重新生成排期」按钮**（PM 可见）：以当前项目开始日重生成整套（覆盖确认弹窗）。
- **展示**：甘特图按 start~due 画条；任务卡显示起止；总揽「整体进度」旁可加「预计完成 / 是否超期」。
- 超期：预计完成 > `targetDate` → 总揽/Dashboard 标记。

## 6. 周会提醒（轻量档，挂自动化引擎）

- 登记为内置规则 `weekly_meeting_reminder`（scheduled、默认启用），出现在 Admin 自动化设置里可全局开关。
- 它是**项目级配置驱动**的 scheduled 逻辑（不同于走 `matches(event,config)` 的事件规则），实现为 scheduler 里一个专门分支：**沿用现有 30min tick**，每 tick 判"今天=周会日且本周未推"——遍历活跃项目，读 `project.meetingConfig`，若 `enabled` 且 `今天 weekday == config.weekday`：
  - 防重发：`hasRecentAutomationFire`（ruleKey=weekly_meeting_reminder, entityId=projectId, since=本周一）→ 命中则 skip；
  - 否则 `pushWebhook`：`【项目名】本周项目周会 周三 15:00（60 分钟）`（markdown 卡片，带站点链接），并落 `automation_runs`。
- 复用现有 `pushWebhook` / dedup / `automation_runs` 审计；无新表。

## 7. 迁移与部署

- 迁移 0011（附加式）：`project_tasks.startDate` 列 + `projects.meetingConfig` 列。
- 沿用纪律：分支 → 改 → 本地 docker 验证 → 全量测试 → RDS 幂等迁移(ADD COLUMN IF NOT EXISTS)+补 drizzle 记录 → 部署 → 合并 → push。
- SOP 模板依赖图是代码改动，无迁移；老项目不受影响（无 startDate 的任务照常手填）。

## 8. 测试（TDD）

`shared/scheduling.test.ts`（纯函数，无 DB）：
1. 线性依赖：c1→c3→c6 起止日按工期累加正确。
2. 并行依赖：c3 依赖 c1+c2，start = max(c1.due, c2.due)。
3. 阶段串联：p1 依赖上一阶段 gate c6，start = c6.due。
4. 联动顺延：改 c3.due → c4/c5/c6 顺延，c1/c2 不动。
5. 环检测：人为成环 → 不死循环、告警跳过。

集成：建项目后任务带 startDate/dueDate；改一项后下游 dueDate 变。周会：构造"今天=周会日"事件，断言推送一次且同周二次 skip。

## 9. 交付后

进入实现：分支 `feat-scheduling-engine` → 先补全依赖图 + 排期纯函数(TDD) → 存储迁移 → 接入建项目/改期/甘特 → 周会规则 → 验证 → 拆 commit → push。
