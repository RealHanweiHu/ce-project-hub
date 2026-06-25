# 项目详情改版（总览仪表盘 + 5 标签收口）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 项目详情：总览改三栏只读仪表盘（固定排版）+ tab 收口为 5 个（总览/任务/评审与风险/物料与文件/动态，复用现有面板），基础信息编辑收进设置抽屉。

**Architecture:** 纯前端。新建 `ProjectDashboard`（仪表盘）与 `ProjectSettingsDrawer`（包现有 `OverviewPanel` 编辑分区）；`ProjectDetailView` 把 `ProjectMainTab` 收口为 5 值 + 旧值深链映射，总览渲染仪表盘、任务/评审/物料 tab 用 `SegToggle` 子切换复用现有面板。不动后端、不重写被并面板内部。

**Tech Stack:** React + Tailwind + 现有基元（`LinearCard`/`SegToggle`/`StatusDot`/`LinearBar`）+ `useProjectData`。验证：`pnpm check` + preview 走查（含「增减内容排版不变」硬验收）。

**规格：** `docs/superpowers/specs/2026-06-25-project-detail-dashboard-design.md`。**分支：** feat-product-simplify。

**前置事实（已核对）：**
- `client/src/components/views/ProjectDetailView.tsx`：`type ProjectMainTab`（`:64`），tab 栏 `:2075+`，各 tab 内容渲染（overview→`OverviewPanel`；其余 metrics/kanban/gantt/issues/requirements/bom/files/changelog 各自面板）。角色隐藏逻辑 `:1679`。
- `OverviewPanel`（`client/src/components/views/OverviewPanel.tsx`）：侧导编辑分区（基础信息/风险生命周期/团队与分工/排期与周会/钉钉/自定义字段）。
- 复用面板：`TaskListView`/`KanbanBoard`/`TaskGanttView`/`MetricsView`/`IssueList`/`RisksPanel`/`RequirementsView`/`BomPanel`/`FilesPanel`/`ChangeLog`（均已在 ProjectDetailView 对应 tab 渲染——**实现时照搬当前那段的组件+props，勿臆造**）。
- 基元：`@/components/linear/primitives`（`LinearCard`/`SegToggle`/`StatusDot`/`LinearBar`/`Kicker`）。
- 数据：`useProjectData`、`computeOverallProgress`、`HEALTH_CONFIG`、`getProjectPhases`（`@/lib/data`）。
- **ProjectDetailView.tsx 是干净文件（不在并行会话脏文件集）**，但仍只 stage 自己改的文件，别 `git add -A`。

---

## Task 1: ProjectDashboard 三栏仪表盘 + 接到总览 tab

**Files:** Create `client/src/components/views/project-overview/ProjectDashboard.tsx`；Modify `client/src/components/views/ProjectDetailView.tsx`（总览 tab 渲染处）

- [ ] **Step 1: 建 ProjectDashboard** —— 读 ProjectDetailView 里总览相关数据来源（project 对象 + `useProjectData` 衍生：tasks/issues/changelog/phases/gate）。新组件 props：`{ project, onOpenSettings, onSelectTab }`（`onSelectTab(tab: ProjectMainTab)` 用于「查看全部」跳转）。结构（**固定排版**）：
  - 顶部 **警示横幅**：仅当 `project.risk !== 'green'` 或有高优风险/告警时显示（复用 `HEALTH_CONFIG`/RAG 原因首条）；无则不渲染（横幅独立，不影响下方网格高度）。
  - `grid grid-cols-1 lg:grid-cols-[1fr_1fr_360px] gap-4 items-start`：
    - 左栏：`待办任务` 卡（`LinearCard`，标题行含「查看全部 →」`onSelectTab('tasks')`，body `h-[248px] overflow-y-auto`，列出前若干 todo/in_progress 任务：名 + 状态·负责人 + 截止；空态「暂无待办」同高）+ `未关闭问题` 卡（body `h-[168px] overflow-y-auto`，open/in_progress 问题，Pn 徽标 + 类别·负责人，「查看全部 →」`onSelectTab('reviews')`）。
    - 中栏：`关键信息` 卡（标题行「设置 →」`onOpenSettings()`，2 列：项目编号/项目经理/产品线/当前阶段/开始/目标量产，固定不滚）+ `最近变更` 卡（body `h-[168px] overflow-y-auto`，近若干 changelog：类型徽标 + 标题 + 作者·时间，「查看全部 →」`onSelectTab('activity')`）。
    - 右栏：`进度` 卡（环或 `LinearBar` 显示 `computeOverallProgress(project)`% + 任务完成 X/Y + 未关闭问题 N + 风险等级 `HEALTH_CONFIG[project.risk].label`）+ `下一 GATE` 卡（主色块：未完成 gate 任务最近截止→`T-N 天后` + gate 名 + 日期·星期；无则「暂无即将 Gate」，卡同高）。
  - 全部用现有基元 + token 类；**禁止** stone-/amber-/font-serif/font-mono/ce- 类（风险/警示用 `var(--warning)` token）。卡固定高度，左右两栏总高对齐（待办248+gap+问题168 ≈ 关键信息+变更；右栏两卡按内容固定）。
- [ ] **Step 2: 接入总览 tab** —— ProjectDetailView 里 `mainTab === 'overview'` 的渲染从 `<OverviewPanel .../>` 换成 `<ProjectDashboard project={project} onOpenSettings={() => setSettingsOpen(true)} onSelectTab={setMainTab} />`（`settingsOpen` state 在 Task 2 加；本步先 `onOpenSettings={()=>{}}` 占位或加 state）。
- [ ] **Step 3: 验证** —— `pnpm check` 绿。preview（登录 test_pm，进一个项目→总览）：三栏仪表盘渲染、对齐 mockup；**增删一条待办/问题/变更（可在别处改数据或换项目），整体排版高度不变**（硬验收）。`grep -nE 'amber-|stone-|font-serif|font-mono|\bce-' client/src/components/views/project-overview/ProjectDashboard.tsx` = 0。截图。
- [ ] **Step 4: 提交** —— `git add client/src/components/views/project-overview/ProjectDashboard.tsx client/src/components/views/ProjectDetailView.tsx && git commit -m "feat(project-detail): 总览改三栏只读仪表盘（固定排版）"`

---

## Task 2: ProjectSettingsDrawer（设置抽屉，包 OverviewPanel 编辑分区）

**Files:** Create `client/src/components/views/project-overview/ProjectSettingsDrawer.tsx`；Modify `client/src/components/views/ProjectDetailView.tsx`

- [ ] **Step 1: 建抽屉** —— 用现有 Sheet/Dialog 基元（查 `@/components/ui/sheet` 或 `@/components/ui/dialog`，沿用项目里已有抽屉/对话框写法）。`ProjectSettingsDrawer({ open, onOpenChange, project, ...overviewPanelProps })` 内部渲染现有 `<OverviewPanel .../>`（把 ProjectDetailView 原来传给 OverviewPanel 的同一套 props 透传——照搬，勿改 props）。标题「项目设置」。
- [ ] **Step 2: 接线** —— ProjectDetailView 加 `const [settingsOpen, setSettingsOpen] = useState(false)`；头部 ⚙ 按钮 + 仪表盘「设置 →」都 `setSettingsOpen(true)`；渲染 `<ProjectSettingsDrawer open={settingsOpen} onOpenChange={setSettingsOpen} project={project} ...同OverviewPanel的props />`。Task 1 占位的 `onOpenSettings` 接到 `setSettingsOpen(true)`。
- [ ] **Step 3: 验证** —— `pnpm check` 绿。preview：点仪表盘「设置 →」/头部 ⚙ → 抽屉打开，含 基础信息/团队与分工/排期与周会/钉钉/自定义字段/风险生命周期 各分区，编辑（如改基础信息、配团队）仍可用、保存生效。Esc/点遮罩关闭。`grep` 旧类 = 0。
- [ ] **Step 4: 提交** —— `git add client/src/components/views/project-overview/ProjectSettingsDrawer.tsx client/src/components/views/ProjectDetailView.tsx && git commit -m "feat(project-detail): 基础信息编辑收进设置抽屉（复用 OverviewPanel）"`

---

## Task 3: Tab 收口 5 个 + 任务/评审/物料 子视图切换 + 旧深链映射

**Files:** Modify `client/src/components/views/ProjectDetailView.tsx`

- [ ] **Step 1: 枚举收口 + 深链映射** —— `type ProjectMainTab = 'overview'|'tasks'|'reviews'|'materials'|'activity'`。加映射函数把旧值/深链规整：`metrics|kanban|gantt → 'tasks'`、`requirements|issues → 'reviews'`、`bom|files → 'materials'`、`changelog → 'activity'`、`overview→'overview'`。`initialTab`/`defaultTabForRole`/所有 `setMainTab('issues'|'changelog'|...)` 调用点改成映射后的新值（如 `setMainTab('reviews')`/`setMainTab('activity')`）。`:1679` 的角色隐藏改成按 5 tab 维度（保持原权限语义：被隐藏的合并到对应新 tab 仍按原可见性）。
- [ ] **Step 2: 5 tab 栏** —— tab 栏（`:2075+`）改 5 个：总览 / 任务(任务数) / 评审与风险(未关闭问题数) / 物料与文件 / 动态。badge 数沿用现有计数来源。
- [ ] **Step 3: 任务 tab 子视图** —— `mainTab==='tasks'` 内加 `const [taskView, setTaskView] = useState<'list'|'kanban'|'gantt'|'metrics'>('list')` + `SegToggle`（列表/看板/甘特/度量）；各分支**照搬当前 tasks/kanban/gantt/metrics tab 渲染的组件+props**（`TaskListView`/`KanbanBoard`/`TaskGanttView`/`MetricsView`）。
- [ ] **Step 4: 评审与风险 / 物料与文件 子视图** —— `mainTab==='reviews'`：`SegToggle`（问题/风险/需求池/Gate），默认 问题，分支照搬现 issues/RisksPanel/requirements/Gate 渲染。`mainTab==='materials'`：`SegToggle`（BOM/文件），默认 BOM，照搬 bom/files 渲染。`mainTab==='activity'`：照搬 changelog（`ChangeLog`）渲染。
- [ ] **Step 5: 验证** —— `pnpm check` 绿。preview：5 tab 切换正常；任务 tab 列表/看板/甘特/度量 子切换内容正确；评审与风险 问题/风险/需求池/Gate、物料与文件 BOM/文件、动态 内容正常；旧深链（手动改 `?...` 或触发 `setMainTab('changelog')` 等路径）映射不报错。`grep` 旧类 = 0。
- [ ] **Step 6: 提交** —— `git add client/src/components/views/ProjectDetailView.tsx && git commit -m "feat(project-detail): tab 收口 5 个 + 任务/评审/物料 子视图切换 + 旧深链映射"`

---

## Task 4: 收尾验证 + 不回归（硬验收）

- [ ] **Step 1: 全量检查** —— `export $(grep -E '^DATABASE_URL=' .env | xargs) && pnpm check`（绿）。`grep -rnE 'amber-|stone-|font-serif|font-mono|\bce-' client/src/components/views/project-overview/ client/src/components/views/ProjectDetailView.tsx | grep -vE 'xlsx-host|docx-host'` = 0。（纯前端，无需 pnpm test；如跑则不回归。）
- [ ] **Step 2: 固定排版硬验收** —— preview：在总览仪表盘，切换不同项目（待办/问题/变更条目数不同）或增减数据，确认**三栏与各卡高度不变、不塌不撑**；空态卡同高。截图对比。
- [ ] **Step 3: 功能不丢验收** —— preview：设置抽屉里 团队/排期/钉钉/自定义字段/风险生命周期/立项向导 均可用；5 tab 下各复用面板（看板拖拽/甘特/度量/问题/风险/需求池/BOM/文件/变更）功能与改前一致。
- [ ] **Step 4: 提交（如有收尾）** —— `git commit -m "chore(project-detail): 仪表盘改版收尾验证"`

---

## Self-Review 备注（plan ↔ spec 覆盖）

- §4.1 5 tab + 子视图 → Task 3；§4.2 仪表盘 6 卡 + 固定排版 → Task 1（+ Task 4 硬验收）；§4.3 设置抽屉 → Task 2；§4.4 头部 ⚙/设置 → Task 1/2。
- §5 数据流（useProjectData/computeOverallProgress/HEALTH_CONFIG）→ Task 1。§7 验收（固定排版硬验收 + 功能不丢 + 0 残留类 + 旧深链）→ Task 1/3/4。
- §9 非目标：不动后端、不重写被并面板、不做子 tab 深链、不改权限 —— plan 全程「照搬现有组件+props」「按 5 tab 维度保持原权限」，符合。
- 一致性：`ProjectMainTab` 5 值 + 映射在 Task 3 自洽；`onSelectTab`/`onOpenSettings`/`settingsOpen` 命名贯穿 Task 1↔2；新目录 `project-overview/` 两文件命名一致。
- 注意：纯前端无单测，验证=tsc + preview（与本仓前端任务一致）；固定高度具体 px 实现时对齐左右栏微调。
