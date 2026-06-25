# 项目详情改版（总览仪表盘 + 5 标签收口）设计规格

> 状态：已确认（用户批准设计 + 两点：需求池→评审与风险、编辑→设置抽屉）
> 分支：feat-product-simplify
> 日期：2026-06-25

## 1. 目标

把项目详情从「10 个平铺 tab + 侧导编辑式总览」改为：**总览=三栏只读仪表盘** + **tab 收口为 5 个**（总览/任务/评审与风险/物料与文件/动态），被并掉的视图复用现有面板。**纯前端、复用现有面板、不动后端**。核心约束：**排版固定，不随内容增减改变**。

## 2. 已确认决策

| 决策点 | 选择 |
|---|---|
| 范围 | 仪表盘 + 改 5 tab，**复用现有面板不重写内部** |
| 度量/看板/甘特 | 放「任务」tab 内做**视图切换**（列表/看板/甘特/度量） |
| 需求池 | 并到「评审与风险」tab |
| 基础信息编辑（团队/排期/钉钉/自定义字段/风险生命周期/立项向导） | 收进「关键信息卡 设置→ / 右上 ⚙」**设置抽屉** |
| 负责人对非编辑场景 | 仪表盘只读，编辑在各 tab/抽屉 |

## 3. 现状（已核对）

- `client/src/components/views/ProjectDetailView.tsx`：头部（标题/徽标/阶段步进器）+ `mainTab` 切换。`ProjectMainTab = 'overview'|'metrics'|'tasks'|'kanban'|'requirements'|'gantt'|'issues'|'changelog'|'bom'|'files'`（`:64`），tab 栏在 `:2075+`。
- 总览 = `OverviewPanel`（`client/src/components/views/OverviewPanel.tsx`）：侧导 5 分区（基础信息/风险生命周期/团队与分工/排期与周会/钉钉对接群/自定义字段）+ 基础信息内含 关键信息/立项信息/关键指标 + ProductDefinitionHandoffPanel。
- 复用面板均已存在：`TaskListView`/`KanbanBoard`/`TaskGanttView`(或 GanttView)/`MetricsView`/`IssueList`/`RisksPanel`/`RequirementsView`(需求池)/`BomPanel`/`FilesPanel`/`ChangeLog`。
- 数据：`useProjectData`（任务/问题/变更/风险/阶段/Gate/项目元信息）+ `computeOverallProgress`、`HEALTH_CONFIG`、`getProjectPhases`。Gate 截止：phase 的 gateDueDate/gate 任务。

## 4. 设计

### 4.1 Tab 结构（5 个主 tab）

`ProjectMainTab` 收口为 `'overview'|'tasks'|'reviews'|'materials'|'activity'`（保留旧值映射以兼容深链：metrics/kanban/gantt→tasks 子视图；requirements/issues→reviews；bom/files→materials；changelog→activity）。

| Tab | 内容 |
|---|---|
| **总览** overview | §4.2 仪表盘 |
| **任务**(N) tasks | 顶部视图切换 **列表/看板/甘特/度量**（`useState` 子 tab，复用 `TaskListView`/`KanbanBoard`/`TaskGanttView`/`MetricsView`），N=任务数 |
| **评审与风险**(N) reviews | 子切换（`SegToggle`）**问题(`IssueList`) / 风险(`RisksPanel`) / 需求池(`RequirementsView`) / Gate 评审**，默认 问题，N=未关闭问题数 |
| **物料与文件** materials | 子切换（`SegToggle`）**BOM(`BomPanel`) / 文件(`FilesPanel`)**，默认 BOM |
| **动态** activity | `ChangeLog`（变更记录/动态） |

- 子视图切换用轻量分段控件（复用 `SegToggle` 基元），状态 `useState`，不写 URL（保持简单；深链按主 tab）。
- 角色隐藏逻辑（现 `:1679` 对部分角色隐藏度量/看板等）：改为按 5 tab 维度（如执行角色仍可见 总览/任务/动态，评审与风险/物料与文件 视权限）。保留现有权限语义，不放权。

### 4.2 总览仪表盘（对齐 mockup，**固定排版**）

顶部 **警示横幅**（仅当项目 amber/red 或有高优风险/交期预警时显示）：复用现有 RAG 原因/风险首条；无则不显示（横幅有无不影响下方网格高度——下方网格独立）。

三栏响应式网格 `grid grid-cols-1 lg:grid-cols-[1fr_1fr_360px] gap-4 items-start`：
- **左栏**（两卡堆叠）：
  - 待办任务卡：前 3 条 todo/in_progress（按截止升序），每条 标题 + 状态·负责人 + 截止；「查看全部 →」跳 tasks。
  - 未关闭问题卡：前 2 条 open/in_progress（P0/P1 优先），每条 标题 + 类别·负责人 + Pn 徽标；「查看全部 →」跳 reviews。
- **中栏**（两卡堆叠）：
  - 关键信息卡：2 列网格（项目编号/项目经理/产品线/当前阶段/开始/目标量产）；右上「设置 →」开设置抽屉(§4.3)。
  - 最近变更卡：近 3 条 changelog（类型徽标 SCM/ECN/DEC… + 标题 + 作者·时间）；「查看全部 →」跳 activity。
- **右栏**（两卡堆叠，固定宽 ~360）：
  - 进度卡：环形 `进度%`（复用现有环/`LinearBar` 替代亦可）+ 任务完成 X/Y + 未关闭问题 N + 风险等级。
  - 下一 GATE 卡（主色块）：`T-N 天后` + gate 名（如 DVT Exit·设计验证准出）+ 日期·星期；无即将 Gate 则显示「暂无即将 Gate」。

**固定排版机制（硬约束）**：每张卡**固定高度**（如待办卡 `h-[300px]`、问题卡 `h-[220px]`、关键信息卡 `h-[300px]`、最近变更卡 `h-[220px]`、进度卡/下一GATE 卡按内容固定），卡 body `overflow-y-auto`/截断，外层 `items-start`；列与卡高度不随条目增减变化（沿用总览大盘 `h-[280px]+overflow` 那套，具体 px 实现时微调对齐左右两栏）。空态占位同高。

### 4.3 基础信息编辑 → 设置抽屉

「关键信息卡 设置→」与「右上 ⚙」打开**设置抽屉/弹窗**，内含现 `OverviewPanel` 的编辑分区：基础信息（关键信息/立项信息编辑）、团队与分工、排期与周会、钉钉对接群、自定义字段、风险生命周期、立项向导入口。**直接复用 OverviewPanel 的分区组件**（把它从「总览 tab 内容」改造为「设置抽屉内容」；总览 tab 改渲染仪表盘）。权限不变。

### 4.4 头部

保留 标题/类型徽标/风险徽标/副标题（产品名·编号·品类）/阶段步进器。右侧「推进到下一阶段」= 现有阶段推进/量产发布按钮（按当前阶段动态文案，如「推进到 PVT」）。⚙ = 设置抽屉。「编辑」= 现有标题/基础编辑入口（或并入设置抽屉）。最小改动。

## 5. 数据流

全部来自 `useProjectData` + 现有 selector：待办=tasks 过滤 todo/in_progress、问题=issues 过滤 open、变更=changelog、进度=`computeOverallProgress`+任务计数、风险=`HEALTH_CONFIG[project.risk]`、下一 Gate=未完成 gate 任务最近截止。**不新增查询、不动后端 mutation**。

## 6. 错误处理 / 边界

- 各卡空态：固定高度内显示「暂无…」，不塌高。
- 下一 Gate 无：显示占位文案，卡保持同高。
- 子 tab 切换：默认 列表 / 问题 / BOM。
- 设置抽屉沿用各分区现有 loading/empty/权限。

## 7. 测试 / 验收

- `pnpm check` 通过；现有测试不回归（纯前端）。
- preview 走查：总览三栏仪表盘对齐 mockup；**增减待办/问题/变更条目，整体排版高度不变**（硬验收）；5 tab 切换正常，任务 tab 列表/看板/甘特/度量切换可用，评审与风险/物料与文件/动态 内容正常；设置→/⚙ 打开抽屉，团队/排期/钉钉/自定义字段/风险/立项 编辑仍可用（功能不丢）。
- 旧深链（如 `?tab=kanban`）映射到新结构不报错。
- 改动文件 0 残留 `stone-`/`amber-` 类名/`font-serif`/`font-mono`/`ce-*`。

## 8. 单元 / 架构

- 新 `client/src/components/views/project-overview/`（或同目录）：`ProjectDashboard.tsx`（仪表盘 + 6 卡子组件）、`ProjectSettingsDrawer.tsx`（包 OverviewPanel 编辑分区）。
- `ProjectDetailView.tsx`：tab 枚举/栏改 5；总览渲染 `ProjectDashboard`；任务 tab 加视图子切换；reviews/materials 组合现有面板。
- `OverviewPanel.tsx`：编辑分区抽出供设置抽屉复用（总览不再用它）。

## 9. 非目标（YAGNI）

- 不改后端、不新增查询。
- 不重写被并面板内部（IssueList/RisksPanel/Bom/Files/ChangeLog/Metrics/Kanban/Gantt/Requirements 照用）。
- 不做子 tab 的 URL 深链（仅主 tab 深链兼容）。
- 不改权限语义（只是入口重组）。

## 10. 不回归

- 被并面板功能全保留，仅入口位置变。
- 基础信息/团队/排期/钉钉/自定义字段/风险/立项 编辑经设置抽屉仍可用。
- 旧 tab 深链兼容映射。
