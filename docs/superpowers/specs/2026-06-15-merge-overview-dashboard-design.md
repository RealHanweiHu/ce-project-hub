# 总览页合并设计：仪表盘 + 组合看板 + 报表 → 单一「总览」

日期：2026-06-15
状态：设计已确认，待写实施计划

## 背景与问题

当前侧边栏存在三个高度重叠的跨项目分析视图：

- **仪表盘**（`DashboardView`）：KPI 卡 + 阶段分布 + 即将到来的 Gate + P0/P1 告警 + 项目总览表。
- **组合看板**（`PortfolioBoard`）：汇总卡 + 可排序/筛选的跨项目表（进度/风险/逾期/阻塞/开放问题/预计完成）。
- **报表**（`ReportsView`）：管理层 / PM / 我的 三视角。

三者本质都是「一屏看全部项目 + 点击下钻」。更严重的是**仪表盘的数据是坏的**：它走 `trpc.projects.list`，而 `rowToProject`（`client/src/pages/Home.tsx`）把 `phases` 写死为 `{}`，导致：

- `computeOverallProgress` 的 doneTasks 恒为 0 → **每个项目进度显示 0%、平均进度 0%**。
- P0/P1「高优先级未关闭问题」面板遍历空 `phases` → **永不显示**。
- 项目总览表「问题」列恒为空、「即将到来的 Gate」进度恒 0。

而组合看板走 `trpc.projects.portfolio`（`server/db.ts` 的 `getPortfolio`），用 SQL 聚合得到准确的任务/问题计数。

此外，侧边栏的 **我的任务 / 逾期 / 阻塞** 三个任务入口与报表的「我的视角」也有重叠（详见下文作用域分析）。

## 目标

把 **仪表盘 + 组合看板 + 报表** 合并为单一「总览」页，并将 **我的任务 / 逾期 / 阻塞** 三个入口一并并入；同时新增两个 PMO 必备视图：**项目健康度 RAG** 与 **里程碑 / Gate 日历**。

核心原则：**兼顾全局共识与千人千面**——一屏内，上半部分是人人一致的事实（共识），下半部分按登录人身份自动呈现（个性）。全页数据统一走准确的聚合源，彻底弃用坏掉的 `projects.list` 渲染路径。

非目标（本次不动）：项目管理 / 产品库 / 需求池 / SOP 流程库 入口；跨项目甘特图、资源/工作量负载视图（后期再加）。

## 关键决策（已与用户确认）

1. **结构 = 上下分层**：顶部「全局共识区」（人人相同）+ 下方「千人千面区」（按角色）。
2. **视角切换控件**放在**页面顶部标题行右侧**，作为「以 XX 视角查看」的全局开关；**不**夹在共识区与个性区之间。
3. **视角权限**：默认按角色，**任何人可手动切**视角（成员也能切到管理层视角看全局）。数据上无新增泄露——共识区本就人人可见，且每个人的口径只覆盖自己有权限的项目。
4. **新增 PM 视图**：里程碑/Gate 日历 + 项目健康度 RAG（不做甘特、不做工作量负载）。
5. **里程碑日历只放里程碑级事件**：阶段截止日 / Gate 评审 / 项目目标日，**不**灌入每条任务截止日。
6. **三个任务入口全部并入总览**：
   - 我的任务 → 并成「我的视角」。
   - 逾期 / 阻塞 → 点共识区 KPI 卡（逾期任务 / 阻塞任务）下钻出实际清单。
   - 侧边栏移除这三项。

## 我的任务 / 逾期 / 阻塞 的作用域分析

三者**不是同一个「我」**，处理方式因此不同：

| 入口 | 端点 | 作用域 | 结论 |
|---|---|---|---|
| 我的任务 | `tasks.myTasks` → `getMyTasks(user.id)` | 指派给**我**的任务 | 与「我的视角」**真重叠** → 合并 |
| 逾期 | `tasks.overdue` | admin 看全部项目；其他人看有权限的项目，**不分指派人** | 管理盯进度的下钻清单 → 作为 KPI 下钻 |
| 阻塞 | `tasks.blocked` | 同上 | 同上 |

逾期/阻塞与共识区有部分重叠，但共识区现在只给**计数**；它们提供的正是缺失的**任务级清单**，因此作为 KPI 卡的下钻目标最自然。

## 页面结构

```
顶部标题行：  总览                              [以 管理层 ▾ 视角查看]   ← 全局切换
──────────────────────────────────────────────────────────────────
【全局共识区 · 人人相同（口径=自己有权限的项目）】
  · KPI 带：项目总数 / 进行中 / 高风险 / 延期率 / 逾期任务* / 阻塞任务*
            （*逾期任务、阻塞任务卡可点击下钻出任务清单）
  · 两栏：项目健康度 RAG（新增）  |  阶段分布图（复用现有）
  · 全部项目表（= 组合看板核心：可排序 / 筛选 / 下钻）
──────────────────────────────────────────────────────────────────
【千人千面区 · 默认按角色，可被顶部全局切换覆盖】
  · 管理层视角：风险分布 + 阶段延期分布 + 高风险项目下钻
  · PM 视角：我负责的项目
  · 我的视角：我的任务统计（逾期 / 3 天内 / 阻塞）+ 任务清单
──────────────────────────────────────────────────────────────────
【里程碑 / Gate 日历 · 新增】按周 / 月，仅里程碑级事件
```

## 数据流

全页统一以聚合端点为底座，**不再使用** `DashboardView` 现有的 `projects.list` 渲染路径。

- **共识区 KPI、全部项目表、RAG 健康度、管理层/PM 视角**：均源于 `trpc.projects.portfolio`（`getPortfolio` 返回的 `PortfolioRow[]`，已含 `taskTotal / taskDone / overdueTasks / blockedTasks / openIssues / risk / projectedEnd / targetDate / currentPhase / pmUserId` 等）。
- **我的视角**：复用 `trpc.tasks.myTasks` + `TaskListView`（与现状一致）。
- **逾期 / 阻塞下钻**：复用 `trpc.tasks.overdue` / `trpc.tasks.blocked`（保持其 admin/项目作用域语义），在点击 KPI 卡时按需加载并以清单/抽屉形式展示。
- **里程碑 / Gate 日历**：需要带日期的事件，现有 `portfolio` 不含阶段/Gate 日期，故**新增端点** `trpc.projects.calendar`（见下）。

### 新增端点：`projects.calendar`

服务端 `getCalendar(userId, fromDate, toDate)`，在时间窗内聚合三类里程碑级事件，作用域与 `getPortfolio` 一致（owned ∪ member）：

- **阶段截止**：`project_phases.endDate`（每个阶段的收口里程碑）。
- **Gate 评审**：`gate_reviews.reviewDate` 且 `reviewDate >= today`（已排期的未来评审）。
- **项目目标日**：`projects.targetDate`。

返回结构（每条事件）：`{ date, type: 'phase' | 'gate' | 'target', projectId, projectName, label }`。前端 `MilestoneCalendar` 按日期分桶渲染，点击事件下钻到对应项目。

## RAG 健康度判定

纯前端从 `PortfolioRow` 计算，无需新端点。每个项目产出 `'green' | 'amber' | 'red'`，规则按优先级从高到低短路：

- **红（red）**，满足任一：
  - `risk === 'high'`，或
  - 预计超期（`projectedEnd && targetDate && projectedEnd > targetDate`），或
  - `overdueTasks > 0`，或
  - `openIssues`（P0/P1 口径，见备注）严重。
- **黄（amber）**，满足任一（且未触发红）：
  - `risk === 'medium'`，或
  - `blockedTasks > 0`，或
  - `openIssues > 0`。
- **绿（green）**：以上均不满足。

RAG 面板上方给绿/黄/红三色计数，下方自动列出**红、黄项目**（点击下钻）。判定函数 `computeRag(row): 'green'|'amber'|'red'` 单独成纯函数并写单元测试。

> 备注：`PortfolioRow.openIssues` 目前是 open + in_progress 的总开放问题数，不区分 P0/P1。若需「严重问题」单独驱动红灯，需在 `getPortfolio` 的 `issueAgg` 增补一个按 `severity in ('P0','P1')` 的 filtered count 字段（`criticalIssues`）。实施计划中确认是否纳入；不纳入则红灯的问题维度退化为「开放问题数高于阈值」。

## 组件拆分

每个单元职责单一、可独立理解与测试。

- `OverviewPage`（新，容器）：持有 `lens` 状态（默认 `user.role` → exec/pm/mine，可由顶部切换覆盖），组合下列各区。
- 共识区：
  - `KpiStrip`（新）：6 张 KPI，逾期/阻塞两张可点击触发下钻。
  - `RagHealthPanel`（新）：三色计数 + 红黄项目列表。
  - `PhaseDistributionChart`（复用现有，改喂 portfolio 真实数据）。
  - `PortfolioTable`（重构：从 `PortfolioBoard` 抽出可复用的排序/筛选表）。
- 个性区：
  - `PerspectivePanel`（新）：内含 exec / pm / mine 三套渲染，逻辑搬自 `ReportsView`（含 `MyTasks`、`ProjectRows`、风险分布、阶段延期）。
- 新增：`MilestoneCalendar`。
- 下钻：`TaskDrillDownDrawer` 或就地展开，复用 `TaskListView`。

收敛与删除：

- `DashboardView.tsx`：删除；其有价值的部件（阶段分布、Gate、P0/P1 告警思路）迁入共识区/日历，但改用准确数据。
- `PortfolioBoard.tsx`：拆为 `PortfolioTable`（复用）后删除原文件。
- `ReportsView.tsx`：逻辑迁入 `PerspectivePanel` 后删除。
- `MyTasksView / OverdueTasksView / BlockedTasksView`：其展示能力分别由「我的视角」与 KPI 下钻承接；评估能否删除或保留为薄封装（实施计划中定）。

## 导航变化

`client/src/pages/Home.tsx`：

- `View` 联合类型与 `navItems` 移除 `portfolio / reports / my-tasks / overdue / blocked`，`dashboard` 改为 `overview`（标签「总览」）。
- 侧边栏 `taskBadges`（my-tasks/overdue/blocked 计数）移除；逾期/阻塞计数改由共识区 KPI 卡体现。
- 主内容区 `view === 'overview'` 渲染 `OverviewPage`；其余项目管理/产品库/需求池/SOP 入口与渲染不变。

合并后侧边栏：总览 / 项目管理 / 产品库 / 需求池 / SOP 流程库（+ 管理员的系统管理）。

## 错误处理与加载

- 各聚合查询沿用 tRPC + TanStack Query 的 `isLoading` 态，分区独立显示加载骨架（共识区、个性区、日历互不阻塞）。
- `projects.calendar` 失败时日历区降级为空态提示，不影响其余区块。
- 空数据：无项目 → 共识区与表显示空态；非 PM 切到 PM 视角 → 「你当前不是任何项目的 PM」。

## 测试

- `computeRag(row)`：纯函数，覆盖红/黄/绿各触发条件与优先级短路（单元测试）。
- `getCalendar`：时间窗与作用域过滤、三类事件聚合（服务端测试，含权限隔离）。
- `lens` 默认值：admin→exec、PM→pm、普通→mine 的分支。
- `PortfolioTable`：排序/筛选行为与原 `PortfolioBoard` 一致（回归）。
- 端到端抽查：登录后总览渲染、进度/问题为**真实非零**值（验证已脱离坏掉的 list 路径）、KPI 下钻、视角切换。

## 开放项（实施计划阶段确认）

1. `getPortfolio` 是否增补 `criticalIssues`（P0/P1 filtered count）以驱动 RAG 红灯的问题维度。
2. `MyTasksView / OverdueTasksView / BlockedTasksView` 三文件删除还是保留为薄封装。
3. 日历的默认时间窗（本周 / 本月）与周月切换交互。
