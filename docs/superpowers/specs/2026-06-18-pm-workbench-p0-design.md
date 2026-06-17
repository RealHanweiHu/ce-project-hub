# PM 项目层工作台（千人千面 · P0 三卡）设计

日期：2026-06-18
状态：设计已确认，待写实施计划

## 背景与目标

源自《Ce_hub 千人千面 · 工作台规格》：同一个 URL，不同角色打开看到不同的「信息流」。规格定义三个海拔——组合层(CEO) → 项目层(PM) → 任务对象层。本次先做**项目层(PM)** 这一轴。

现状：`OverviewPage` 已有 3 视角架构（`exec` / `pm` / `mine`），其中 `pm` 视角（`PerspectivePanel` 里的 `PmCockpit`）目前很薄——只有一个"下一步建议"行动列表，上方挂一个范围限"我的项目"的 `PortfolioDashboard` 大盘。这离规格里 PM 工作台的卡片集还差很远。

本次把 `pm` 视角重构为一个真正的 **PM 工作台**，落地规格中 PM 的 **P0 三张卡**：TODAY（今天要做）、待我协调/拍板项、我负责的项目（带阶段标签）。

## 关键决策（已确认）

1. **方案 A（纯前端）**：在现有 `pm` 视角内重构，复用已在 `PerspectivePanel` 内调用的 `trpc.workbench.mine` 与 `projects.portfolio` 两个查询，以及现有 `Panel`/`QueueRows`/`Tag`/`HealthDot` 样式。**零服务端改动、零 schema 改动。** 不做服务端 `workbench.pm` 端点（待将来推广到 8 个角色时再做），不做卡片模板/注册框架（YAGNI）。
2. **范围只做 P0 三张卡**：TODAY、待我协调/拍板、我负责的项目（带阶段标签）。
3. **PM 视角去掉 `PortfolioDashboard` 大盘**：大盘是组合层(exec)的聚合视图；PM 海拔重行动、轻聚合，卡 3「我负责的项目」承接其项目列表职能。`exec`/`mine` 视角完全不动。
4. **卡 1「TODAY」包含 PM 个人被指派的任务**（不只是项目级事件）——PM 本人也有任务要推。
5. **数据范围**：项目级卡片（卡 2 的协调项、卡 3 的项目列表、卡 1 的 Gate/风险事件）按 `pmUserId === 我` 过滤；卡 1 的个人任务来自 `workbench.tasks`（= 指派给我的、未完成任务），不限项目。

非目标（本次不做）：P1 卡（关键路径/下一个卡点、Gate 准入清单、问题看板）；P2 团队负载；卡片折叠/用户自定义；服务端 PM 端点；导航层面把"工作台"与"项目总览"拆成独立入口。

## 架构与改动文件

| 文件 | 改动 |
|---|---|
| `client/src/components/views/overview/OverviewPage.tsx` | `activeLens === "pm"` 时：不渲染 `PortfolioDashboard` 与"需要处理"小标题；页标题改"我的项目工作台"。`exec`/`mine` 分支不变。 |
| `client/src/components/views/overview/PerspectivePanel.tsx` | `PmCockpit` 从单卡重构为三卡布局；渲染逻辑调用新纯函数模块。 |
| `client/src/components/views/overview/pmWorkbench.ts`（新增） | 卡片取数/排序纯函数。 |
| `client/src/components/views/overview/pmWorkbench.test.ts`（新增） | 纯函数单测。 |

## 三张卡

### 卡 1 · TODAY（今天要做）— P0，置顶、整宽
PM 今天要推动/拍板的事，混合个人任务与项目事件，按紧急度排序：
- **我的逾期 / 今日到期任务**：`workbench.tasks` 中 `dueDate <= 今天`（`getMyTasks` 已限 `assigneeUserId=我` 且非 done/skipped）。逾期 > 今日到期。
- **本周 Gate 评审**：我负责项目中 `gateDone=false` 且 `gateDueDate` 在 `[今天, 今天+7天]` 内。
- **需我处理的延期/风险**：我负责项目中 `ragLevel==="red"` 或 `isProjectedOverdue(projectedEnd, targetDate)`。
点击：任务 → 项目详情；Gate/风险 → 项目详情。空态："今天没有紧急事项。"

### 卡 2 · 待我协调 / 拍板项 — P0
- **待我审批的交付物**：`workbench.reviews`（已限 `reviewerUserId=我`、`status=pending`）。
- **等 PM 决策的卡点**：复用现有 `buildPmActions` 中"需协调/决策"子集——阻塞任务、未分配任务、Gate 交付物缺口、未关 P0/P1 问题，范围限我负责的项目。
取代当前"下一步建议"。点击 → 项目详情。空态："暂无待你协调或拍板的事项。"

### 卡 3 · 我负责的项目（带阶段标签）— P0
- `portfolio` 中 `pmUserId=我` 的项目，每行：项目名 + 阶段标签（`PHASE_MAP[currentPhase]`）+ 健康度圆点（`ragLevel`）+ 一个次要指标（优先级：P0/P1问题数 > 逾期任务数 > 阻塞任务数，取最高者展示）。
点击 → 项目详情。空态：复用现有"你当前不是任何项目的 PM。"

**布局**：卡 1 整宽置顶；卡 2、卡 3 下方 `grid-cols-1 xl:grid-cols-2`，沿用 exec 面板栅格风格与 `Panel` 外壳。

## 纯函数与测试

`pmWorkbench.ts` 导出（输入普通数据数组、输出排序后数组，无副作用）：
- `selectMyProjects(rows: PortfolioTableRow[], userId): PortfolioTableRow[]`
- `buildTodayItems(tasks, myRows, today: string): TodayItem[]` — 合并个人到期任务 + 本周 Gate + 红/延期项目，按紧急度排序
- `buildCoordinationQueue(reviews, myRows): QueueItem[]` — 合并待审交付物 + 决策卡点，按优先级排序
- `projectHeadlineMetric(row): { label: string; tone } | null` — 卡 3 次要指标取最高项

`pmWorkbench.test.ts` 覆盖：今日/本周 7 天边界、逾期优先于今日、空数组、各卡排序顺序、卡 3 指标优先级选择。卡片组件只负责渲染，不含取数逻辑。

## 验收

- PM 用户进入 `pm` 视角，看到"我的项目工作台"标题 + 三张 P0 卡，无大盘。
- 三卡数据范围正确（项目级限我负责的项目，个人任务为指派给我的）。
- 各卡点击下钻到正确项目/任务。
- `exec` / `mine` 视角行为不变。
- `pmWorkbench.test.ts` 全绿；类型检查通过。
