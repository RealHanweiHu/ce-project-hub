# Portfolio 度量 rollup — 设计文档

日期：2026-06-19
状态：已评审，待实现
范围：把已上线的单项目度量横向汇到组合层，做**项目对比表**（管理层比较项目效能/进度/评审质量，揪出落后项目）。backlog「portfolio 度量 rollup」。相关 memory `automation-feature-roadmap`。

## 目标

单项目度量（commit 40fb13b）只能逐个项目看。管理层需要一张**项目对比表**：每行一个项目，列出 Lead Time / 逾期率 / 近4周吞吐 / Gate 一次通过率，可排序揪落后项目，顶部配几个组合聚合 KPI。

## 现状（已有基础）

- `shared/metrics.ts` `computeProjectMetrics(input): ProjectMetrics`（已测）。`ProjectMetrics.efficiency` 有 `leadTimeDaysMedian/leadTimeDaysP85/throughputByWeek({weekKey,count}[])/overdueRatePct/completedCount/plannedCount`；`process.gateFirstPassRatePct`。
- `server/db.ts` `getProjectMetricsData(projectId, fromISO, toISO)` 拉单项目精简行。
- `server/routers/analytics.ts` `projectMetrics` query：窗口 `toISO=shanghaiTodayISO()`，`fromISO=project.startDate ?? 最早`，调 `computeProjectMetrics`。
- `server/db.ts` `getPortfolio(userId): PortfolioRow[]`：用户可见未归档项目，每行含 `id/name/category/ragLevel/startDate/targetDate/pmName` 等。
- `client/.../views/overview/`：OverviewPage、PortfolioTable、KpiStrip、RagHealthPanel 等组合视图。

缺口：无跨项目度量聚合、无对比表。

## 关键设计决策（已评审确认）

1. **对比表为主**（行=项目）+ 顶部几个组合聚合 KPI。
2. **列**：Lead Time 中位 / 逾期率% / 近4周吞吐 / Gate 一次通过率%。质量 DI 不入列（PortfolioTable 已有缺陷计数）。
3. **范围** = `getPortfolio(userId)` 口径（用户可见、未归档）。
4. **计算** = 逐项目复用单项目度量 `getProjectMetricsData + computeProjectMetrics`（DRY、已测），取标量装行。N 项目=N 组查询，管理视图非热点、当前规模可接受（批量化留后续）。
5. **聚合 KPI 只取能精确算的**：项目数、RAG 分布、总近4周吞吐；外加一个**标注「加权」**的组合逾期率（plannedCount 加权平均）。**不**做池化 Lead Time 中位/Gate 通过率——单项目度量产出未暴露逾期/Gate 原始计数，精确池化做不到，且跨项目按 phaseId 合并 Gate 会错算；不为此改动已上线的 metrics 模块。

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
  plannedCount: number;            // = efficiency.plannedCount，供加权
};

export type PortfolioMetricAggregates = {
  projectCount: number;
  ragCounts: { red: number; amber: number; green: number };
  totalRecentThroughput: number;
  weightedOverdueRatePct: number | null;  // plannedCount 加权平均；无有效项→null
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
- 行标量直接取 `efficiency.leadTimeDaysMedian/overdueRatePct/plannedCount`、`process.gateFirstPassRatePct`。
- `ragCounts`：按 `ragLevel ∈ {red,amber,green}` 计数（其他值忽略）。
- `totalRecentThroughput = Σ recentThroughput`。
- `weightedOverdueRatePct`：仅对 `overdueRatePct != null` 的项目，`Σ(rate × plannedCount) / Σ plannedCount`；分母 0 或无有效项 → null。四舍五入到整数。
- 行默认排序：`overdueRatePct` 降序（null 末尾），laggard 置顶。

### B. db `getPortfolioMetricsData(userId)`（`server/db.ts` 新增）

```ts
export async function getPortfolioMetricsData(userId: number): Promise<PortfolioMetricsRollup>;
```
- `const projects = await getPortfolio(userId)`（未归档、用户可见）。
- `const todayISO = ...`（Asia/Shanghai 今天；复用 analytics 已有 `shanghaiTodayISO` 口径——若该函数未导出则在此内置同口径）。
- 逐项目：`fromISO = project.startDate ?? <最早 createdAt 兜底>`；`raw = await getProjectMetricsData(p.id, fromISO, todayISO)`；`metrics = computeProjectMetrics({ ...raw, window: { fromISO, toISO: todayISO } })`。
  - `fromISO` 兜底：若 `startDate` 为空，用 `raw` 里最早的 task.createdAt/issue.foundDate（与 analytics `defaultFromISO` 同口径；可抽共用 helper 或内置）。
- 装 `{ projectId, name, ragLevel, metrics }[]` → `rollupPortfolioMetrics(...)` 返回。

### C. 路由 `analytics.portfolioMetrics`（`server/routers/analytics.ts` 新增）

```ts
  portfolioMetrics: protectedProcedure
    .query(async ({ ctx }) => {
      return getPortfolioMetricsData(ctx.user.id);
    }),
```
鉴权：`protectedProcedure`（登录即可）；范围天然按 `getPortfolio(ctx.user.id)` 收敛到用户可见项目，无需额外校验。

### D. UI（`client/.../views/overview/` 新增「项目度量对比」）

- 新增 `PortfolioMetricsTable.tsx`，在 OverviewPage 增一段「项目度量对比」。
- 顶部聚合条：项目数 · 红/黄/绿计数 · 总近4周吞吐 · 加权逾期率。
- 表格列：项目名(+RAG 点) | Lead Time 中位 | 逾期率% | 近4周吞吐 | Gate 通过率% ；可点列头排序；null 显示「—」；逾期率高/RAG 红的行轻微高亮。
- 用 `trpc.analytics.portfolioMetrics.useQuery()`。空组合显示「暂无项目」。

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

- `shared/portfolio-metrics.ts`（新增）：纯取标量 + 聚合。依赖 `ProjectMetrics` 类型。
- `server/db.ts`：新增 `getPortfolioMetricsData`（编排，复用 getPortfolio/getProjectMetricsData/computeProjectMetrics）。
- `server/routers/analytics.ts`：新增 `portfolioMetrics` query。
- `client/.../overview/PortfolioMetricsTable.tsx`（新增）+ OverviewPage 挂载。
- **不改** `shared/metrics.ts`、单项目 `projectMetrics` 端点、PortfolioTable。

## 测试

- `shared/portfolio-metrics.test.ts`（纯函数）：
  - recentThroughput：>4 周只取末4周求和；<4 周全取。
  - 行标量映射正确（leadTime/overdue/gate/plannedCount）。
  - ragCounts 计数；totalRecentThroughput 求和。
  - weightedOverdueRatePct：加权口径正确（含某项目 rate=null 被排除）；全 null/空组合 → null。
  - 默认按 overdueRatePct 降序、null 末尾。
  - 空输入 → rows=[]、aggregates 零值/null。
- 集成（`server/` DB）：`getPortfolioMetricsData` 对一个含 2~3 项目的用户，返回行数=组合项目数，且某行标量与单独跑 `computeProjectMetrics` 一致。

## 明确排除（YAGNI）

- 燃尽/趋势的组合叠加（时间序列不可比，仅标量列）。
- 质量 DI 列（缺陷计数 PortfolioTable 已有）。
- 池化 Lead Time 中位 / Gate 通过率聚合（需暴露原始计数，且 Gate 跨项目合并会错算）。
- 跨项目钻取联动、批量化查询优化、时间窗自定义（先固定 startDate~今天 + 近4周吞吐）。
