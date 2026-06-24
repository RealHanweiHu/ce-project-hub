# 响应式适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让整个 app 适配手机/平板/桌面，桌面端零回归。

**Architecture:** 移动优先增量：在既有 JSX 上加 Tailwind 响应式前缀（base/`sm`/`md` 给小屏，`lg`/`xl` 保桌面现状）。无逻辑/数据改动，纯布局。逐屏推进，每屏三档验证。

**Tech Stack:** React + Tailwind v4。验证：`pnpm check` + `preview_resize`（mobile 375 / tablet 768 / desktop 1280）三档截图；**桌面 1280 与改前像素级一致是硬验收**。

**规格：** `docs/superpowers/specs/2026-06-24-responsive-design.md`。**分支：** `feat-responsive`。

**Tailwind 断点**：base <640 手机 · `sm`≥640/`md`≥768 平板 · `lg`≥1024/`xl`≥1280 桌面。外壳已用 `lg` 作图标栏收抽屉断点。

---

## 通用验证流程（每个 Task 的"验证"步骤都照此）

dev server "cehub-dev" 运行（`preview_start` name cehub-dev；登录 test_pm/Test123456 用 native-setter+`requestSubmit`）。每屏：
1. `pnpm check`（tsc）通过。
2. `preview_resize` 到该屏 URL，依次：
   - **桌面**：`preview_resize {preset:"desktop"}`（1280）→ 截图，与改前桌面截图比对 → **必须无变化（零回归）**。
   - **平板**：`preview_resize {preset:"tablet"}`（768）→ 截图 → 不破版、无意外横向滚动条、可读可点。
   - **手机**：`preview_resize {preset:"mobile"}`（375）→ 截图 → 同上；该堆叠的堆叠、该横滚的横滚。
3. `grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' <该屏文件>` = 0（不在响应式改动里引入旧类）。
> **零回归原则**：只加 base/`sm`/`md` 前缀类，或把"无前缀的桌面布局类"改写成"base 小屏 + `lg:` 桌面"且 `lg:` 等于原值。改完桌面档截图若与改前有任何差异，回退该处。

---

## Task 1: 总览 响应式

**Files:** `client/src/components/views/overview/PortfolioDashboard.tsx`、`overview/OverviewPage.tsx`、`overview/PortfolioMetricsTable.tsx`

- [ ] **Step 1: 改前先存桌面基线** —— `preview_resize desktop` 到 `/?view=overview`（admin 自动管理层大盘）截图留底，作为零回归比对基准。
- [ ] **Step 2: 6 KPI 网格自适应** —— 找到 6 张 KPI 卡的容器（现为 6 列 grid 或 flex）。改为 `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3`（手机 2 列、平板 3 列、桌面 6 列＝现状）。
- [ ] **Step 3: 今日聚焦 3 项** —— 容器改 `grid grid-cols-1 lg:grid-cols-3 gap-3`（手机 1 列、桌面 3 列）。
- [ ] **Step 4: 两栏区堆叠** —— 风险预警/组合进度 ｜ 即将Gate/阶段分布 的两栏容器：base `flex-col` / `lg:flex-row`（或 `grid-cols-1 lg:grid-cols-2`），保持 `lg:` 并排＝现状、等高。
- [ ] **Step 5: 度量表横滚** —— `PortfolioMetricsTable` 的 `<table>` 外层包/确认 `overflow-x-auto`，表加 `min-w-[720px]`（防表头挤）。
- [ ] **Step 6: 验证（通用流程）** —— 三档截图；桌面零回归；tsc；grep 0。
- [ ] **Step 7: 提交** `git add client/src/components/views/overview && git commit -m "feat(responsive): 总览 手机/平板自适应（桌面冻结）"`

---

## Task 2: 看板 响应式

**Files:** `client/src/components/views/ProjectListView.tsx`

- [ ] **Step 1: 桌面基线截图** —— `/?view=projects` 看板视图，`preview_resize desktop` 截图留底。
- [ ] **Step 2: 阶段列横滚** —— 看板列的外层容器加 `overflow-x-auto`（若已有则确认），每个阶段列定宽（如 `w-[260px] shrink-0`，沿用现宽），手机/平板横向滚动看 6 列。泳道分组时，每条泳道的阶段列行同样可横滚。
- [ ] **Step 3: 顶部工具行换行** —— 三视图段控 / 搜索框 / 分组 select / 筛选 chip 所在行加 `flex-wrap gap-2`，手机自动换行不溢出。
- [ ] **Step 4: 列表视图横滚** —— 列表表格外层 `overflow-x-auto`，表 `min-w`（保留全部列，手机横滚）。
- [ ] **Step 5: 详情弹窗手机近全宽** —— 详情 `DialogContent` 的 `max-w-[460px]` 改 `max-w-[min(460px,calc(100vw-1.5rem))]`（手机不顶边），`max-h-[85vh]` 保留。
- [ ] **Step 6: 验证 + 提交** —— 通用流程（看板/列表/弹窗三态各档看一眼）；`git commit -m "feat(responsive): 看板 手机/平板自适应（桌面冻结）"`

---

## Task 3: 我的任务 响应式

**Files:** `client/src/components/views/MyTasksView.tsx`、`TaskListView.tsx`

- [ ] **Step 1: 桌面基线截图** —— `/?view=mytasks`，`preview_resize desktop` 截图留底。
- [ ] **Step 2: 顶部控件换行** —— 列表/看板段控 + 状态筛选段控 + 搜索框行加 `flex-wrap gap-2`。
- [ ] **Step 3: 任务行小屏堆叠** —— 任务行内"优先级标签/优先级 pill ｜ 截止日期 ｜ 负责人头像"的右侧组：手机把日期/pill 换行或缩（如右侧组 base `flex-wrap justify-end`，文本 `truncate`）；桌面行布局（`lg:`）不变。复选框 + 标题始终单行可点。
- [ ] **Step 4: 验证 + 提交** —— 通用流程；`git commit -m "feat(responsive): 我的任务 手机/平板自适应（桌面冻结）"`

---

## Task 4: 日历 响应式

**Files:** `client/src/components/views/CalendarPage.tsx`

- [ ] **Step 1: 桌面基线截图** —— `/?view=calendar`，`preview_resize desktop` 截图留底。
- [ ] **Step 2: 5 stat 卡网格** —— stat 卡容器改 `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3`（手机 2、平板 3、桌面 5＝现状；注意现状是 5 张）。
- [ ] **Step 3: 顶部行换行** —— 日历/截止清单 tab + 只看我负责的 + 全部类型下拉 所在行 `flex-wrap`；月份导航 + 创建日程 区在 `PageHeader` actions 内也 `flex-wrap`。
- [ ] **Step 4: 窄屏默认切清单** —— `tab` 初值改为按视口：用一个 `useEffect` 在首次挂载时，若 `window.innerWidth < 640` 则 `setTab('milestones')`（仍可手动切回日历）。月历格子在手机：格高压缩、事件 chip `truncate`、`text-[10px]`。
- [ ] **Step 5: 月历最小宽 + 横滚兜底** —— 月历 7 列网格外层 `overflow-x-auto`，网格 `min-w-[640px]`（手机若用月历，横滚不挤；用清单则不触发）。
- [ ] **Step 6: 验证 + 提交** —— 通用流程（手机档确认默认是清单、可切回月历）；`git commit -m "feat(responsive): 日历 手机/平板自适应 + 窄屏默认清单（桌面冻结）"`

---

## Task 5: 项目详情 响应式

**Files:** `client/src/components/views/ProjectDetailView.tsx`

- [ ] **Step 1: 桌面基线截图** —— `/?view=projects&projectId=demo-001&tab=overview`，`preview_resize desktop` 截图留底（各 tab 抽查）。
- [ ] **Step 2: 头部堆叠** —— 头部"名称/类型/风险/负责人/进度/推进按钮"行：base `flex-col gap-3` / `lg:flex-row lg:items-center`（桌面横排＝现状）。推进按钮在手机占整行或右对齐。
- [ ] **Step 3: P1–P7 stepper 横滚** —— stepper 容器加 `overflow-x-auto`，内部 stepper `min-w` 或节点 `shrink-0`，手机横滚。
- [ ] **Step 4: 标签栏横滚** —— 多标签（概览/任务/度量/看板/需求池/问题/甘特/BOM/文件/变更）的 tab 容器加 `overflow-x-auto flex-nowrap`，tab `shrink-0`，手机横滚切换。
- [ ] **Step 5: tab 内容横滚兜底** —— 各 tab 内的宽表格/网格外层补 `overflow-x-auto`（抽查 任务/度量/BOM/变更 几个表）。
- [ ] **Step 6: 验证 + 提交** —— 通用流程（头部 + 几个 tab 三档看）；`git commit -m "feat(responsive): 项目详情 手机/平板自适应（桌面冻结）"`

---

## Task 6: 产品库 / 需求池 响应式补缺

**Files:** `client/src/components/views/ProductLibraryView.tsx`、`RequirementPoolPanel.tsx`、`RequirementsView.tsx`

- [ ] **Step 1: 桌面基线截图** —— `/?view=products` 与 `/?view=requirements`，`preview_resize desktop` 各截图留底。
- [ ] **Step 2: 产品卡网格** —— 产品卡 grid 改 `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`（手机 1、平板 2、桌面 4＝现状；按现状列数对齐 `lg:`）。
- [ ] **Step 3: 大弹窗手机近全宽** —— RevisionsDialog / 需求创建编辑 等大弹窗的 `max-w-*` 改 `max-w-[min(<原值>,calc(100vw-1.5rem))]`，内部 `max-h-[85vh] overflow-y-auto`。
- [ ] **Step 4: 内嵌表格/分组横滚** —— 客户版本表 / 需求看板列 / SKU 表 等外层补 `overflow-x-auto`。
- [ ] **Step 5: 顶部筛选行换行** —— 类别筛选 + 搜索 / 来源筛选 等行 `flex-wrap`。
- [ ] **Step 6: 验证 + 提交** —— 通用流程（两屏各档）；`git commit -m "feat(responsive): 产品库/需求池 手机/平板自适应补缺（桌面冻结）"`

---

## Task 7: 外壳小修补 + 全局三档走查

**Files:** `client/src/pages/Home.tsx` + 收尾

- [ ] **Step 1: 顶栏窄屏修补** —— 顶栏右侧（保存状态/搜索框/通知铃）在手机：保存状态已 `hidden sm:flex`（保留）；搜索框宽度自适应（`max-w-[220px] sm:w-[230px]`，手机收窄或变图标）；整行 `gap` 在手机收小。桌面不变。
- [ ] **Step 2: 全局弹层手机化兜底** —— 抽查 GlobalSearch / ChangePassword / Kickoff 等全局弹层在手机近全宽不溢出（`max-w-[calc(100vw-1.5rem)]`）。
- [ ] **Step 3: 全局三档走查** —— 逐页（总览/看板/我的任务/需求池/项目详情/产品库/日历/账户页）在 mobile/tablet/desktop 各扫一遍：
  - 手机/平板：无破版、无水平溢出（除有意横滚区）、可读可点。
  - **桌面 1280：每页与本计划开始前一致（零回归汇总确认）。**
- [ ] **Step 4: 收尾检查** —— `pnpm check` + `grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' client/src | grep -vE 'xlsx-host|docx-host'` = 0。
- [ ] **Step 5: 提交** `git commit -m "feat(responsive): 外壳窄屏修补 + 全局三档走查收尾"`

---

## Self-Review 备注（已核对规格覆盖）

- §5.1 外壳 → Task 7；§5.2 总览 → Task 1；§5.3 看板 → Task 2；§5.4 我的任务 → Task 3；§5.5 日历 → Task 4；§5.6 项目详情 → Task 5；§5.7 产品库/需求池 → Task 6。
- §2 桌面冻结/零回归 → 每 Task 的"桌面基线截图"+ 通用验证的桌面比对（硬验收）。
- §8 测试：每屏三档 preview_resize + tsc + grep；无单测（纯布局，按规格）。
- 一致性：断点用法全程一致（base/`sm`/`md` 给小屏、`lg:` 保桌面）；列数与桌面现状对齐（总览 6 KPI、产品库 4 列、日历 5 stat —— 实施时以该屏当前桌面列数为准，`lg:` 等于现值）。
- **注意**：实施每屏 Step 2+ 前，先读该屏当前对应容器的真实类名，把"无前缀的桌面布局"安全改写为"小屏 base + `lg:` 桌面（值＝原值）"，避免桌面回归。
