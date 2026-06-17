# 单项目度量体系 — 设计文档

日期：2026-06-18
状态：已评审，待实现
范围：飞书项目(Lark Project) IHM 方案对标后扩展 backlog 中的 **P0「度量体系」**，本期只做**单项目深度**（组合/管理层度量后续独立成 spec）。相关 roadmap 见 memory `automation-feature-roadmap`。

## 目标

在项目详情页新增「度量」Tab，用项目自身已有数据算出四族指标，帮 PM 看清单个项目的**效能、质量、进度、流程**。我们当前只有 RAG 红黄绿（健康度），无任何效能/质量趋势——这是与飞书对标的最大短板，且数据已齐，补的是聚合 + 图表。

四族指标：
1. **任务效能** — Lead Time、吞吐、逾期率
2. **质量趋势** — 缺陷 DI 值、开闭趋势、严重度/分类分布
3. **进度燃尽** — 任务燃尽、缺陷燃尽
4. **流程/Gate** — Gate 一次通过率、阶段实际耗时

## 现状（已有基础）

- **数据齐备**：`projectTasks` 有 `createdAt/completedAt/startDate/dueDate/status/priority`；`projectIssues` 有 `createdAt/foundDate/targetDate/closedDate/severity/status/category`；`projectGateReviews` 有 `reviewDate/decision/roundNumber`；`projectPhases` 有 `startDate/endDate`。
- **聚合模式可复用**：`server/db.ts` `getPortfolioHealthForDigest(todayISO)` 已示范「先查项目→`count(*) filter (where ...)` 分维聚合→Map 化→展开」的跨表聚合写法。
- **图表库**：`recharts`，封装样式见 `client/.../views/PhaseDistributionChart.tsx`（`ResponsiveContainer + BarChart + 自定义 Tooltip/Cell`）。
- **纯计算分层先例**：`shared/health.ts`、`shared/scheduling.ts` 都是「无 IO 的纯函数 + 独立 vitest」，本设计沿用。
- **详情页 Tab 结构**：`ProjectDetailView` 已有甘特/看板/缺陷等并列 Tab，新增「度量」Tab 进同一处。

缺口：无任何指标聚合查询、无 analytics 路由、无度量视图。

## 关键设计决策（已评审确认）

1. **趋势用事件日期反推，零新表、零定时任务**。燃尽不需要日快照表：「截至 D 日剩余」= 总数 − `count(completedAt ≤ D)`，纯单调反推；缺陷趋势用 `foundDate`/`closedDate` 同理。代价：无法回看历史某天的 `blocked/in_progress`（可逆状态）分布——v1 不需要。
2. **cycle time 先用 Lead Time**（`completedAt − createdAt`），永远算得出。精确「活跃 cycle time」（`in_progress→done`）依赖 `activityLogs.meta` 的 `{from,to}` 完整性，实现时验证覆盖率再决定是否追加，**不阻塞 v1**。
3. **DI 权重 P0=10 / P1=3 / P2=1 / P3=0.1**，写成 `shared/metrics.ts` 顶部常量，随时可调。

## 设计

### A. 纯计算层 `shared/metrics.ts`（新增）

无 DB、无 IO，输入「已查出的原始记录数组 + 时间窗」，输出指标结构。所有指标都在此层算，便于单测。

```ts
export const DI_WEIGHTS = { P0: 10, P1: 3, P2: 1, P3: 0.1 } as const;

export type MetricsWindow = { fromISO: string; toISO: string }; // YYYY-MM-DD，闭区间

// 上层查好后传入的精简记录（只取计算所需字段）
export type MetricTask = {
  createdAt: string; completedAt: string | null;
  dueDate: string | null; status: string;
};
export type MetricIssue = {
  foundDate: string | null; closedDate: string | null;
  severity: "P0" | "P1" | "P2" | "P3"; status: string; category: string;
};
export type MetricGate = { decision: string; roundNumber: number };
export type MetricPhase = { phaseId: string; startDate: string | null; endDate: string | null };

export type ProjectMetrics = {
  efficiency: {
    leadTimeDaysMedian: number | null;   // 完成任务的 (completedAt-createdAt) 中位数
    leadTimeDaysP85: number | null;
    throughputByWeek: { weekKey: string; count: number }[]; // completedAt 落窗内按 ISO 周
    overdueRatePct: number | null;        // 见下口径
    completedCount: number; plannedCount: number;
  };
  quality: {
    diValue: number;                      // 当前未关闭缺陷加权和
    openClose: { weekKey: string; opened: number; closed: number; cumulativeOpen: number }[];
    bySeverity: { severity: string; count: number }[];
    byCategory: { category: string; count: number }[];
  };
  burndown: {
    task: { dateISO: string; remaining: number; ideal: number | null }[];
    defect: { dateISO: string; remaining: number }[];
  };
  process: {
    gateFirstPassRatePct: number | null;  // approved & roundNumber=1 占比
    phaseDurations: { phaseId: string; plannedDays: number | null; actualDays: number | null }[];
  };
};

export function computeProjectMetrics(input: {
  tasks: MetricTask[]; issues: MetricIssue[];
  gates: MetricGate[]; phases: MetricPhase[];
  window: MetricsWindow; totalTaskCount: number;
}): ProjectMetrics;
```

**各指标口径：**

*任务效能*
- `leadTimeDays = daysBetween(createdAt, completedAt)`，仅统计窗内完成（`completedAt` 落 `[from,to]`）的任务。中位数 + P85，不用均值（抗长尾）。无完成任务→`null`。
- `throughputByWeek`：完成任务按 `completedAt` 的 ISO 周（`YYYY-Www`）分桶计数。
- `overdueRatePct = (窗内完成且 completedAt>dueDate 的数 + 当前未完成且 dueDate<toISO 的数) / 有 dueDate 的任务数`。分母为 0 → `null`。

*质量趋势*
- `diValue = Σ DI_WEIGHTS[severity]`，对 `status ∈ {open,in_progress}` 的缺陷求和（当前未关闭缺陷的加权严重度）。
- `openClose`：按 ISO 周，`opened = count(foundDate ∈ 周)`，`closed = count(closedDate ∈ 周)`，`cumulativeOpen` = 截至该周末累计 found − 累计 closed。
- `bySeverity / byCategory`：未关闭缺陷分组计数。

*进度燃尽（事件反推）*
- `task[]`：对窗内每一天 D，`remaining = totalTaskCount − count(completedAt ≤ D)`。`ideal`（理想线，明确口径）：从 `fromISO` 的 `totalTaskCount` 直线降到 `plannedEndISO = min(toISO, max(task.dueDate))` 的 0，其后恒为 0；若无任何 `dueDate` 则在 `[fromISO, toISO]` 全程直线降到 0。粒度按窗长自适应（≤8 周按天，更长按周）。
- `defect[]`：`remaining = count(foundDate ≤ D) − count(closedDate ≤ D)`。

*流程/Gate*
- `gateFirstPassRatePct = count(decision=approved 且 roundNumber=1) / count(distinct gate)`。无 Gate→`null`。
- `phaseDurations`：`plannedDays = daysBetween(phase.startDate, phase.endDate)`；`actualDays` 优先用 phase 自身 start/end，缺失则用该阶段任务的 `min(createdAt)`→`max(completedAt)` 兜底。

> 复用 `shared/health.ts` 已有的 `daysBetween`（两个 `YYYY-MM-DD` 字符串相减，时区无关）；若签名不便复用则在 metrics 内置同口径小工具，避免引入时区依赖。

### B. 聚合查询 `server/db.ts`（新增 `getProjectMetricsData`）

不在 SQL 里算指标，只把**计算所需的精简行**按窗拉出来交给纯函数。复用 `getPortfolioHealthForDigest` 的查询风格：

```ts
export async function getProjectMetricsData(projectId: string, fromISO: string, toISO: string): Promise<{
  tasks: MetricTask[]; issues: MetricIssue[];
  gates: MetricGate[]; phases: MetricPhase[]; totalTaskCount: number;
}>;
```

- `tasks`：该项目全部任务（取 `createdAt/completedAt/dueDate/status`）。燃尽反推需要窗内任意时点的累计完成，故**任务全量拉取**（单项目量级小，无分页压力），由纯函数按窗切。
- `issues`：该项目全部缺陷（取上述字段）。
- `gates`：`projectGateReviews` 按 projectId。
- `phases`：`projectPhases` 按 projectId。
- `totalTaskCount`：= tasks.length，传给燃尽做基线。

> 单项目数据量天然有界（任务/缺陷数十到数百），无需 SQL 预聚合或分页；一次拉全 + 内存计算最简单且足够快。

### C. tRPC 路由 `server/routers/analytics.ts`（新增）

```ts
export const analyticsRouter = router({
  projectMetrics: <项目成员鉴权 procedure>  // 用 tasks/issues 路由现用的同一个，名称以现有为准
    .input(z.object({
      projectId: z.string(),
      fromISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      toISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const { fromISO, toISO } = resolveWindow(input);  // 默认: 项目开始~今天
      const raw = await getProjectMetricsData(input.projectId, fromISO, toISO);
      return computeProjectMetrics({ ...raw, window: { fromISO, toISO } });
    }),
});
```

- 在 `server/routers.ts` 挂载 `analytics`。
- 权限：用项目详情已有的成员权限中间件（与 tasks/issues 路由一致），非成员不可读。
- 窗口默认：`fromISO = project.startDate ?? 最早 createdAt`，`toISO = 今天`（Asia/Shanghai）。

### D. 前端 `client/.../views/MetricsView.tsx`（新增 Tab）

- `ProjectDetailView` Tab 列表加「度量」，渲染 `MetricsView`。
- 顶部时间窗切换：项目至今（默认）/ 近 4 周 / 自定义。
- 四个卡片区，每区一张主图 + 关键数字，沿用 `PhaseDistributionChart` 的 recharts 封装风格：
  - 任务效能：吞吐柱状图 + Lead Time 中位/P85 数字 + 逾期率
  - 质量趋势：开闭趋势折线（opened/closed/cumulativeOpen）+ DI 值数字 + 严重度分布
  - 进度燃尽：燃尽折线（实际 vs 理想）+ 缺陷燃尽
  - 流程/Gate：一次通过率数字 + 阶段实际/计划耗时对比柱状
- 用 `trpc.analytics.projectMetrics.useQuery({ projectId, fromISO, toISO })`。

### 数据流

```
MetricsView (选时间窗)
  → trpc.analytics.projectMetrics({projectId, fromISO?, toISO?})
  → resolveWindow(默认 项目开始~今天/Asia-Shanghai)
  → db.getProjectMetricsData(projectId, from, to)  // 全量拉精简行
  → shared/metrics.computeProjectMetrics(...)        // 纯函数算四族
  → 返回 {efficiency, quality, burndown, process}
  → recharts 渲染四卡片
```

## 日期/时区（统一口径）

- 窗口默认值的「今天」在 app 侧按 `Asia/Shanghai` 算 `YYYY-MM-DD`，与 `healthDigest` 同口径，不用 SQL `CURRENT_DATE`。
- 所有日期比较在纯函数层用 `YYYY-MM-DD` 字符串比较（时区无关）；`timestamp` 字段（createdAt/completedAt）先在 db 层 `::text` 截 `YYYY-MM-DD` 或在纯函数 `slice(0,10)`，保证与 `date`/`varchar` 日期字段同口径相减。

## 模块边界

- `shared/metrics.ts`（新增）：纯判定/聚合，无 IO。输入即决定输出。唯一外部依赖是日期相减工具（与 health 同口径）。
- `server/db.ts`：新增 `getProjectMetricsData`，只查不算。
- `server/routers/analytics.ts`（新增）：窗口解析 + 权限 + 调用，无业务逻辑。
- `client/.../MetricsView.tsx`（新增）：纯展示，所有数值来自后端。
- 不改动现有 health/scheduling/automation 任何模块。

## 测试

- `shared/metrics.test.ts`（新增，vitest）：
  - Lead Time：构造已知 createdAt/completedAt，验证中位数/P85；无完成任务→null。
  - 吞吐：跨两周的完成任务正确分桶。
  - 逾期率：完成超期 + 当前超期混合；分母为 0→null。
  - DI 值：P0/P1/P2/P3 混合 → 加权和正确；只算未关闭。
  - 开闭趋势：found/closed 跨周 → opened/closed/cumulativeOpen 正确。
  - 任务燃尽：给定完成时刻序列，验证逐日 remaining 单调反推正确；空任务→remaining 恒为 total。
  - 缺陷燃尽：found/closed 反推 remaining。
  - Gate 一次通过率：approved+round1 / 含复审 → 比例正确；无 Gate→null。
  - 阶段耗时：phase 有 start/end 用之；缺失走任务兜底。
  - 边界：空窗口、空数据全族返回 null/空数组而非 NaN/抛错。
- 前端空态：无足够数据时卡片显示「暂无足够数据」（不渲染空图）。

## 明确排除（YAGNI）

- 组合/管理层跨项目度量（独立 spec）。
- 日快照表与可逆状态（blocked/in_progress）历史分布趋势（事件反推已覆盖 v1 需求）。
- 精确「活跃 cycle time」（依赖 activityLogs.meta 覆盖率，实现时再评估追加）。
- DI 权重后台可配 UI（先写死常量）。
- 成员工作负荷、需求转化率、Scope Creep 等指标（v2 候选，本期不做）。
- 度量数据导出/定时报表推送（本期只做页内查看）。
