# Portfolio 度量 rollup — 设计文档

日期：2026-06-19（2026-06-21 按 code review 补严 4 处：范围/权限口径、加权逾期率精确化、UI 按 lens 挂载、fromISO 兜底顺序）
状态：已评审，待实现
范围：把已上线的单项目度量横向汇到组合层，做**项目对比表**（管理层比较项目效能/进度/评审质量，揪出落后项目）。backlog「portfolio 度量 rollup」。相关 memory `automation-feature-roadmap`。

## 目标

单项目度量（commit 40fb13b）只能逐个项目看。管理层需要一张**项目对比表**：每行一个项目，列出 Lead Time / 逾期率 / 近4周吞吐 / Gate 一次通过率，可排序揪落后项目，顶部配几个组合聚合 KPI。

## 现状（已有基础）

- `shared/metrics.ts` `computeProjectMetrics(input): ProjectMetrics`（已测）。`ProjectMetrics.efficiency` 有 `leadTimeDaysMedian/leadTimeDaysP85/throughputByWeek({weekKey,count}[])/overdueRatePct/completedCount/plannedCount`；`process.gateFirstPassRatePct`。
- `server/db.ts` `getProjectMetricsData(projectId, fromISO, toISO)` 拉单项目精简行。
- `server/routers/analytics.ts` `projectMetrics` query：窗口 `toISO=shanghaiTodayISO()`，`fromISO=project.startDate ?? 最早`，调 `computeProjectMetrics`。
- `server/db.ts` `getPortfolio(userId): PortfolioRow[]`：**实际返回全部未归档项目**（非用户可见子集——见 db.ts:568 注释「总览全员只读可见全部未归档项目」；`userId` 仅用于 pm 高亮等，不做范围过滤）。每行含 `id/name/category/ragLevel/startDate/targetDate/pmName/pmUserId` 等。
- `client/.../views/overview/`：OverviewPage、PortfolioTable、KpiStrip、RagHealthPanel 等组合视图。

缺口：无跨项目度量聚合、无对比表。

## 关键设计决策（已评审确认）

1. **对比表为主**（行=项目）+ 顶部几个组合聚合 KPI。
2. **列**：Lead Time 中位 / 逾期率% / 近4周吞吐 / Gate 一次通过率%。质量 DI 不入列（PortfolioTable 已有缺陷计数）。
3. **范围** = `getPortfolio(userId)` 口径 = **全部未归档项目**（getPortfolio 不按用户过滤，见上）。本功能是**管理层项目对比工具**（揪落后项目），全组合可见是预期，不是 bug。但因此：
   - **权限**：路由 `protectedProcedure` 仍是全员可调，故**前端只在 `exec` lens 下挂载并触发查询**（见决策 6 / D 节），不靠路由收范围。若后续要让 PM 也看，应在 db 层按 `pmUserId === userId` 过滤行（PM-scoped），而非沿用全量。
4. **计算** = 逐项目复用单项目度量 `getProjectMetricsData + computeProjectMetrics`（DRY、已测），取标量装行。N 项目=N 组查询，管理视图非热点、当前规模可接受（批量化留后续）。
5. **聚合 KPI 只取能精确算的**：项目数、RAG 分布、总近4周吞吐、**精确池化的组合逾期率**。**做法**：在 `computeProjectMetrics` 的 `efficiency` 增量暴露 `dueDatedCount`（有 dueDate 的任务数=现 `overdueRatePct` 的分母）与 `overdueCount`（现分子 `lateCompletedInWindow + currentOverdue`）两个标量，组合层用 `Σ overdueCount / Σ dueDatedCount` 精确池化——避免「plannedCount(总任务数) 加权」把大量未排期任务的项目权重放大的口径错配。这是对 metrics.ts 的**纯增量改动**（两个已在函数内算好的标量，无行为/破坏性变化），故放开「不改 metrics.ts」边界，仅限这两个字段。**仍不**做池化 Lead Time 中位/Gate 通过率——跨项目按 phaseId 合并 Gate 会错算，且 Lead Time 中位无法由各项目中位精确合成。
6. **UI 按 lens 挂载**：对比表/聚合条**仅 `activeLens === "exec"` 渲染**（与现有「仅 exec 出大盘、pm/mine 走工作台」一致，OverviewPage.tsx:46）；PM/个人视角不显示，查询也不发起。

## 设计

### A. 纯函数 `shared/portfolio-metrics.ts`（新增）

无 IO，对每项目的 `ProjectMetrics` 取标量 + 算聚合。便于单测。

```ts
import type { ProjectMetrics } from "./metrics";

export type PortfolioMetricRow = {
  projectId: string;
  name: string;
  ragLevel: string;
  leadTimeDaysMedian: number | null;
  overdueRatePct: number | null;
  recentThroughput: number;        // 近4周吞吐(throughputByWeek 末4周求和)
  gateFirstPassRatePct: number | null;
  plannedCount: number;            // = efficiency.plannedCount(总任务数)，仅展示用
  dueDatedCount: number;           // = efficiency.dueDatedCount，精确池化逾期率的分母
  overdueCount: number;            // = efficiency.overdueCount，精确池化逾期率的分子
};

export type PortfolioMetricAggregates = {
  projectCount: number;
  ragCounts: { red: number; amber: number; green: number };
  totalRecentThroughput: number;
  pooledOverdueRatePct: number | null;  // ΣoverdueCount / ΣdueDatedCount（精确池化）；ΣdueDatedCount=0→null
};

export type PortfolioMetricsRollup = {
  rows: PortfolioMetricRow[];
  aggregates: PortfolioMetricAggregates;
};

export function rollupPortfolioMetrics(
  input: { projectId: string; name: string; ragLevel: string; metrics: ProjectMetrics }[]
): PortfolioMetricsRollup;
```

口径：
- `recentThroughput`：`metrics.efficiency.throughputByWeek` 按 `weekKey` 升序后取**末 4 项** count 求和（不足 4 周则全取）。
- 行标量直接取 `efficiency.leadTimeDaysMedian/overdueRatePct/plannedCount/dueDatedCount/overdueCount`、`process.gateFirstPassRatePct`。
- `ragCounts`：按 `ragLevel ∈ {red,amber,green}` 计数（其他值忽略）。
- `totalRecentThroughput = Σ recentThroughput`。
- `pooledOverdueRatePct`：`Σ overdueCount / Σ dueDatedCount × 100`，四舍五入到整数；`Σ dueDatedCount === 0` → null。**精确池化**，不再用 plannedCount 加权（避免未排期任务多的项目权重虚高）。
- 行默认排序：`overdueRatePct` 降序（null 末尾），laggard 置顶。

### B. db `getPortfolioMetricsData(userId)`（`server/db.ts` 新增）

```ts
export async function getPortfolioMetricsData(userId: number): Promise<PortfolioMetricsRollup>;
```
- `const projects = await getPortfolio(userId)`（全部未归档；范围语义见决策 3）。
- `const todayISO = ...`（Asia/Shanghai 今天；复用 analytics 已有 `shanghaiTodayISO` 口径——抽为共用 helper 或在此内置同口径）。
- 逐项目，**严格按 analytics.projectMetrics 的顺序**（避免 fromISO↔raw 的循环依赖）：
  1. `raw = await getProjectMetricsData(p.id, "", todayISO)` —— 先拉 raw（该 helper 现忽略 from/to 参数，见 db.ts:1297 `_fromISO/_toISO`；但**不依赖这个巧合**，故传空窗，逻辑上「先取全量再定窗」）。
  2. `fromISO = defaultFromISO(p.startDate, raw, todayISO)` —— `startDate` 优先，空则取 raw 里最早 task.createdAt/issue.foundDate/phase.startDate 兜底。
  3. `metrics = computeProjectMetrics({ ...raw, window: { fromISO, toISO: todayISO } })`。
  - **复用**：把 analytics.ts 现有的私有 `defaultFromISO`（analytics.ts:30）提取为共用 helper（如 `server/metrics-window.ts` 或 db.ts 导出），analytics 与本 rollup 同源，不复制实现。
- 装 `{ projectId, name, ragLevel, metrics }[]` → `rollupPortfolioMetrics(...)` 返回。

### C. 路由 `analytics.portfolioMetrics`（`server/routers/analytics.ts` 新增）

```ts
  portfolioMetrics: protectedProcedure
    .query(async ({ ctx }) => {
      return getPortfolioMetricsData(ctx.user.id);
    }),
```
鉴权：`protectedProcedure`（登录即可调用）。**注意**：`getPortfolio` 返回全部未归档项目，本端点不做项目范围过滤——这是有意的（管理层对比工具）。范围控制在**前端只于 exec lens 发起查询**（见 D 节）。若将来要做 PM-scoped，应在 `getPortfolioMetricsData` 内按 `pmUserId` 过滤行，而非依赖此端点收范围。

### D. UI（`client/.../views/overview/` 新增「项目度量对比」）

- 新增 `PortfolioMetricsTable.tsx`，**仅在 `activeLens === "exec"` 时挂载**（OverviewPage 的 `isWorkbench`/lens 分流处，line 46 附近）；pm/mine 工作台视角不渲染、不发起查询。
- 顶部聚合条：项目数 · 红/黄/绿计数 · 总近4周吞吐 · 池化逾期率（精确）。
- 表格列：项目名(+RAG 点) | Lead Time 中位 | 逾期率% | 近4周吞吐 | Gate 通过率% ；可点列头排序；null 显示「—」；逾期率高/RAG 红的行轻微高亮。
- `trpc.analytics.portfolioMetrics.useQuery(undefined, { enabled: activeLens === "exec" })`，避免非 exec 视角白发请求。空组合显示「暂无项目」。

### 数据流

```
OverviewPage → trpc.analytics.portfolioMetrics
  → getPortfolioMetricsData(userId)
      → getPortfolio(userId) 项目列表
      → 逐项目 getProjectMetricsData + computeProjectMetrics(窗口=startDate~今天)
      → rollupPortfolioMetrics → {rows, aggregates}
  → PortfolioMetricsTable 渲染（聚合条 + 可排序表）
```

## 模块边界

- `shared/metrics.ts`：**纯增量**——`efficiency` 增 `dueDatedCount` / `overdueCount` 两标量（值已在函数内算好：`dueDatedTasks.length`、`lateCompletedInWindow + currentOverdue`）。无行为变化；现有 `projectMetrics` 端点与 MetricsView 不受影响（多两个字段不消费即可）。
- `shared/portfolio-metrics.ts`（新增）：纯取标量 + 聚合。依赖 `ProjectMetrics` 类型。
- `server/db.ts`：新增 `getPortfolioMetricsData`（编排，复用 getPortfolio/getProjectMetricsData/computeProjectMetrics）。
- `server/metrics-window.ts`（新增或就近）：从 analytics.ts 提取共用 `defaultFromISO`，analytics 与 rollup 同源。
- `server/routers/analytics.ts`：新增 `portfolioMetrics` query；改为 import 共用 `defaultFromISO`。
- `client/.../overview/PortfolioMetricsTable.tsx`（新增）+ OverviewPage 挂载（仅 exec lens）。
- **不改** 单项目 `projectMetrics` 端点对外契约（除新增字段）、PortfolioTable。

## 测试

- `shared/portfolio-metrics.test.ts`（纯函数）：
  - recentThroughput：>4 周只取末4周求和；<4 周全取。
  - 行标量映射正确（leadTime/overdue/gate/plannedCount/dueDatedCount/overdueCount）。
  - ragCounts 计数；totalRecentThroughput 求和。
  - `pooledOverdueRatePct`：池化口径正确 `ΣoverdueCount/ΣdueDatedCount`；**关键用例**——一个含大量未排期任务（plannedCount≫dueDatedCount）的项目，验证池化结果不被其 plannedCount 放大（与旧 plannedCount 加权法对比应不同）。
  - `pooledOverdueRatePct`：`ΣdueDatedCount===0`（无任一项目有 dueDate 任务）→ null；空组合 → null。
  - 默认按 overdueRatePct 降序、null 末尾。
  - 空输入 → rows=[]、aggregates 零值/null。
- `shared/metrics.test.ts`：补 `dueDatedCount`/`overdueCount` 两字段的断言（值=现 overdueRatePct 的分母/分子）。
- 集成（`server/` DB）：`getPortfolioMetricsData` 对一个含 2~3 项目的用户，返回行数=组合项目数，且某行标量与单独跑 `computeProjectMetrics` 一致；startDate 为空的项目走 `defaultFromISO` 兜底不报错。

## 明确排除（YAGNI）

- 燃尽/趋势的组合叠加（时间序列不可比，仅标量列）。
- 质量 DI 列（缺陷计数 PortfolioTable 已有）。
- 池化 Lead Time 中位 / Gate 通过率聚合（需暴露原始计数，且 Gate 跨项目合并会错算）。
- 跨项目钻取联动、批量化查询优化、时间窗自定义（先固定 startDate~今天 + 近4周吞吐）。
