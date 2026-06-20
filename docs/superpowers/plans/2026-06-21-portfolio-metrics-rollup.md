# Portfolio 度量 rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已上线的单项目度量横向汇成「项目对比表」+ 组合聚合 KPI，供管理层（exec lens）揪落后项目。

**Architecture:** 纯函数 `shared/portfolio-metrics.ts` 取标量 + 精确池化聚合；db `getPortfolioMetricsData` 逐项目复用 `getProjectMetricsData + computeProjectMetrics` 编排；route `analytics.portfolioMetrics` 暴露；前端 `PortfolioMetricsTable` 仅在 exec lens 挂载。逾期率用 `Σoverdue/ΣdueDated` 精确池化（需 metrics 增量暴露两个标量），范围控制在前端按 lens 收口。

**Tech Stack:** TypeScript、tRPC、drizzle(node-postgres)、vitest、React、recharts(本功能不用图)。

设计依据：`docs/superpowers/specs/2026-06-19-portfolio-metrics-rollup-design.md`（2026-06-21 已按 review 补严）。
约定：测试 `node scripts/test.mjs`；类型 `pnpm check`（tsc --noEmit）。多会话并行只 stage 自己改的文件。

---

### Task 1: metrics.ts 增量暴露 `dueDatedCount` / `overdueCount`

精确池化逾期率需要原始分子/分母。两值已在 `computeProjectMetrics` 内算好（`dueDatedTasks.length`、`lateCompletedInWindow + currentOverdue`），仅追加到 `efficiency` 输出。纯增量、无行为变化。

**Files:**
- Modify: `shared/metrics.ts`（type `ProjectMetrics.efficiency` 约 37-43；return `efficiency` 块约 159-168）
- Test: `shared/metrics.test.ts`（追加断言）

- [ ] **Step 1: 在现有测试里加失败断言**

在 `shared/metrics.test.ts` 第一个 `it("computes lead time median, P85, throughput, and overdue rate", ...)` 末尾（`expect(metrics.efficiency.overdueRatePct).toBe(40);` 之后）追加：

```typescript
    expect(metrics.efficiency.dueDatedCount).toBe(5);
    expect(metrics.efficiency.overdueCount).toBe(2);
```

（验算：6 个任务中 5 个有 dueDate→分母 5；late-completed 1（task1 06-02>06-01）+ current-overdue 1（task5 due 06-10、in_progress）=2；2/5=40% 与现有断言一致。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs shared/metrics.test.ts`
Expected: FAIL —`dueDatedCount` / `overdueCount` 为 undefined。

- [ ] **Step 3: 给类型加字段**

`shared/metrics.ts` 的 `ProjectMetrics.efficiency`，把：

```typescript
    overdueRatePct: number | null;
    completedCount: number;
    plannedCount: number;
```

改为：

```typescript
    overdueRatePct: number | null;
    overdueCount: number;
    dueDatedCount: number;
    completedCount: number;
    plannedCount: number;
```

- [ ] **Step 4: 给 return 加值**

`computeProjectMetrics` return 的 `efficiency` 块，把：

```typescript
      overdueRatePct: dueDatedTasks.length > 0
        ? Math.round(((lateCompletedInWindow + currentOverdue) / dueDatedTasks.length) * 100)
        : null,
      completedCount: completedInWindow.length,
      plannedCount: totalTaskCount,
```

改为：

```typescript
      overdueRatePct: dueDatedTasks.length > 0
        ? Math.round(((lateCompletedInWindow + currentOverdue) / dueDatedTasks.length) * 100)
        : null,
      overdueCount: lateCompletedInWindow + currentOverdue,
      dueDatedCount: dueDatedTasks.length,
      completedCount: completedInWindow.length,
      plannedCount: totalTaskCount,
```

- [ ] **Step 5: 跑测试 + 类型**

Run: `node scripts/test.mjs shared/metrics.test.ts && pnpm check`
Expected: PASS；tsc 零错。

- [ ] **Step 6: Commit**

```bash
git add shared/metrics.ts shared/metrics.test.ts
git commit -m "feat(度量): efficiency 增量暴露 dueDatedCount/overdueCount（供组合层精确池化）"
```

---

### Task 2: 纯函数 `shared/portfolio-metrics.ts`

无 IO，对每项目 `ProjectMetrics` 取标量 + 精确池化聚合。

**Files:**
- Create: `shared/portfolio-metrics.ts`
- Test: `shared/portfolio-metrics.test.ts`

- [ ] **Step 1: 写失败测试**

Create `shared/portfolio-metrics.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { rollupPortfolioMetrics } from "@shared/portfolio-metrics";
import type { ProjectMetrics } from "@shared/metrics";

function makeMetrics(over: {
  leadTimeDaysMedian?: number | null;
  overdueRatePct?: number | null;
  overdueCount?: number;
  dueDatedCount?: number;
  throughputByWeek?: { weekKey: string; count: number }[];
  plannedCount?: number;
  gateFirstPassRatePct?: number | null;
}): ProjectMetrics {
  return {
    efficiency: {
      leadTimeDaysMedian: over.leadTimeDaysMedian ?? null,
      leadTimeDaysP85: null,
      throughputByWeek: over.throughputByWeek ?? [],
      overdueRatePct: over.overdueRatePct ?? null,
      overdueCount: over.overdueCount ?? 0,
      dueDatedCount: over.dueDatedCount ?? 0,
      completedCount: 0,
      plannedCount: over.plannedCount ?? 0,
    },
    quality: { diValue: 0, openClose: [], bySeverity: [], byCategory: [] },
    burndown: { task: [], defect: [] },
    process: { gateFirstPassRatePct: over.gateFirstPassRatePct ?? null, phaseDurations: [] },
  };
}

describe("rollupPortfolioMetrics", () => {
  it("recentThroughput 只取末4周求和；不足4周全取", () => {
    const rollup = rollupPortfolioMetrics([
      { projectId: "a", name: "A", ragLevel: "green", metrics: makeMetrics({
        throughputByWeek: [
          { weekKey: "2026-W20", count: 5 },
          { weekKey: "2026-W21", count: 1 },
          { weekKey: "2026-W22", count: 2 },
          { weekKey: "2026-W23", count: 3 },
          { weekKey: "2026-W24", count: 4 },
        ],
      }) },
      { projectId: "b", name: "B", ragLevel: "green", metrics: makeMetrics({
        throughputByWeek: [{ weekKey: "2026-W23", count: 7 }],
      }) },
    ]);
    const a = rollup.rows.find((r) => r.projectId === "a")!;
    const b = rollup.rows.find((r) => r.projectId === "b")!;
    expect(a.recentThroughput).toBe(1 + 2 + 3 + 4); // 末4周，丢掉 W20 的 5
    expect(b.recentThroughput).toBe(7);
    expect(rollup.aggregates.totalRecentThroughput).toBe(10 + 7);
  });

  it("行标量映射 + ragCounts", () => {
    const rollup = rollupPortfolioMetrics([
      { projectId: "a", name: "A", ragLevel: "red", metrics: makeMetrics({
        leadTimeDaysMedian: 6, overdueRatePct: 40, dueDatedCount: 5, overdueCount: 2,
        plannedCount: 6, gateFirstPassRatePct: 50,
      }) },
      { projectId: "b", name: "B", ragLevel: "amber", metrics: makeMetrics({ overdueRatePct: 10 }) },
      { projectId: "c", name: "C", ragLevel: "green", metrics: makeMetrics({}) },
    ]);
    const a = rollup.rows.find((r) => r.projectId === "a")!;
    expect(a.leadTimeDaysMedian).toBe(6);
    expect(a.overdueRatePct).toBe(40);
    expect(a.gateFirstPassRatePct).toBe(50);
    expect(a.plannedCount).toBe(6);
    expect(a.dueDatedCount).toBe(5);
    expect(a.overdueCount).toBe(2);
    expect(rollup.aggregates.projectCount).toBe(3);
    expect(rollup.aggregates.ragCounts).toEqual({ red: 1, amber: 1, green: 1 });
  });

  it("pooledOverdueRatePct 精确池化，不被高 plannedCount 项目放大", () => {
    const rollup = rollupPortfolioMetrics([
      { projectId: "a", name: "A", ragLevel: "red", metrics: makeMetrics({
        overdueRatePct: 100, dueDatedCount: 2, overdueCount: 2, plannedCount: 2,
      }) },
      { projectId: "b", name: "B", ragLevel: "green", metrics: makeMetrics({
        overdueRatePct: 10, dueDatedCount: 10, overdueCount: 1, plannedCount: 100,
      }) },
    ]);
    // 池化 = (2+1)/(2+10) = 25%；旧 plannedCount 加权会被 B 的 100 拖到 ~12%
    expect(rollup.aggregates.pooledOverdueRatePct).toBe(25);
  });

  it("ΣdueDatedCount=0 或空组合 → pooledOverdueRatePct=null", () => {
    expect(rollupPortfolioMetrics([]).aggregates.pooledOverdueRatePct).toBeNull();
    expect(rollupPortfolioMetrics([]).rows).toEqual([]);
    const noDue = rollupPortfolioMetrics([
      { projectId: "a", name: "A", ragLevel: "green", metrics: makeMetrics({ dueDatedCount: 0, overdueCount: 0 }) },
    ]);
    expect(noDue.aggregates.pooledOverdueRatePct).toBeNull();
  });

  it("默认按 overdueRatePct 降序，null 末尾", () => {
    const rollup = rollupPortfolioMetrics([
      { projectId: "lo", name: "lo", ragLevel: "green", metrics: makeMetrics({ overdueRatePct: 10 }) },
      { projectId: "null", name: "null", ragLevel: "green", metrics: makeMetrics({ overdueRatePct: null }) },
      { projectId: "hi", name: "hi", ragLevel: "red", metrics: makeMetrics({ overdueRatePct: 90 }) },
    ]);
    expect(rollup.rows.map((r) => r.projectId)).toEqual(["hi", "lo", "null"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs shared/portfolio-metrics.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 写实现**

Create `shared/portfolio-metrics.ts`：

```typescript
import type { ProjectMetrics } from "./metrics";

export type PortfolioMetricRow = {
  projectId: string;
  name: string;
  ragLevel: string;
  leadTimeDaysMedian: number | null;
  overdueRatePct: number | null;
  recentThroughput: number;
  gateFirstPassRatePct: number | null;
  plannedCount: number;
  dueDatedCount: number;
  overdueCount: number;
};

export type PortfolioMetricAggregates = {
  projectCount: number;
  ragCounts: { red: number; amber: number; green: number };
  totalRecentThroughput: number;
  pooledOverdueRatePct: number | null;
};

export type PortfolioMetricsRollup = {
  rows: PortfolioMetricRow[];
  aggregates: PortfolioMetricAggregates;
};

export function rollupPortfolioMetrics(
  input: { projectId: string; name: string; ragLevel: string; metrics: ProjectMetrics }[],
): PortfolioMetricsRollup {
  const rows: PortfolioMetricRow[] = input.map((item) => {
    const eff = item.metrics.efficiency;
    const sorted = [...eff.throughputByWeek].sort((a, b) => a.weekKey.localeCompare(b.weekKey));
    const recentThroughput = sorted.slice(-4).reduce((sum, w) => sum + w.count, 0);
    return {
      projectId: item.projectId,
      name: item.name,
      ragLevel: item.ragLevel,
      leadTimeDaysMedian: eff.leadTimeDaysMedian,
      overdueRatePct: eff.overdueRatePct,
      recentThroughput,
      gateFirstPassRatePct: item.metrics.process.gateFirstPassRatePct,
      plannedCount: eff.plannedCount,
      dueDatedCount: eff.dueDatedCount,
      overdueCount: eff.overdueCount,
    };
  });

  rows.sort((a, b) => {
    if (a.overdueRatePct === null && b.overdueRatePct === null) return 0;
    if (a.overdueRatePct === null) return 1;
    if (b.overdueRatePct === null) return -1;
    return b.overdueRatePct - a.overdueRatePct;
  });

  const ragCounts = { red: 0, amber: 0, green: 0 };
  for (const row of rows) {
    if (row.ragLevel === "red" || row.ragLevel === "amber" || row.ragLevel === "green") {
      ragCounts[row.ragLevel] += 1;
    }
  }

  const totalRecentThroughput = rows.reduce((sum, r) => sum + r.recentThroughput, 0);
  const totalDueDated = rows.reduce((sum, r) => sum + r.dueDatedCount, 0);
  const totalOverdue = rows.reduce((sum, r) => sum + r.overdueCount, 0);
  const pooledOverdueRatePct = totalDueDated > 0
    ? Math.round((totalOverdue / totalDueDated) * 100)
    : null;

  return {
    rows,
    aggregates: { projectCount: rows.length, ragCounts, totalRecentThroughput, pooledOverdueRatePct },
  };
}
```

- [ ] **Step 4: 跑测试 + 类型**

Run: `node scripts/test.mjs shared/portfolio-metrics.test.ts && pnpm check`
Expected: PASS；tsc 零错。

- [ ] **Step 5: Commit**

```bash
git add shared/portfolio-metrics.ts shared/portfolio-metrics.test.ts
git commit -m "feat(度量): rollupPortfolioMetrics 纯函数（行标量+RAG分布+精确池化逾期率）"
```

---

### Task 3: 提取共用 `defaultFromISO` 到 `server/metrics-window.ts`

避免 `getPortfolioMetricsData` 复制 analytics 的 fromISO 兜底逻辑，并消除「先有 fromISO 才能拉 raw」的循环依赖。

**Files:**
- Create: `server/metrics-window.ts`
- Modify: `server/routers/analytics.ts`（删本地 helper，改 import）

- [ ] **Step 1: 建共用模块**

Create `server/metrics-window.ts`（实现从 analytics.ts 原样搬，raw 用结构化类型避免与 db.ts 循环 import）：

```typescript
export function shanghaiTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

type MetricsRaw = {
  tasks: { createdAt: string }[];
  issues: { foundDate: string | null; closedDate: string | null }[];
  phases: { startDate: string | null }[];
};

export function defaultFromISO(
  projectStartDate: string | null,
  raw: MetricsRaw,
  fallbackISO: string,
): string {
  const projectStart = toISODate(projectStartDate);
  if (projectStart) return projectStart;
  const earliest = minISO([
    ...raw.tasks.map((task) => task.createdAt),
    ...raw.issues.map((issue) => issue.foundDate),
    ...raw.issues.map((issue) => issue.closedDate),
    ...raw.phases.map((phase) => phase.startDate),
  ]);
  return earliest ?? fallbackISO;
}

function toISODate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function minISO(values: Array<string | null | undefined>) {
  const dates = values.map(toISODate).filter((value): value is string => !!value);
  return dates.length > 0 ? dates.sort()[0] : null;
}
```

- [ ] **Step 2: analytics.ts 改用共用 helper**

`server/routers/analytics.ts`：在 import 区加 `import { defaultFromISO, shanghaiTodayISO } from "../metrics-window";`，并**删除**文件内本地的 `shanghaiTodayISO`、`toISODate`、`minISO`、`defaultFromISO` 四个函数定义（约 30-67 行）。`projectMetrics` query 主体不变（仍调用同名 `shanghaiTodayISO`/`defaultFromISO`，现在来自 import）。

改完后 `analytics.ts` 顶部应是：

```typescript
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getProjectMetricsData } from "../db";
import { assertProjectAccess } from "../project-access";
import { computeProjectMetrics } from "../../shared/metrics";
import { defaultFromISO, shanghaiTodayISO } from "../metrics-window";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const analyticsRouter = router({
  projectMetrics: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      fromISO: isoDateSchema.optional(),
      toISO: isoDateSchema.optional(),
    }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      const todayISO = shanghaiTodayISO();
      const toISO = input.toISO ?? todayISO;
      const raw = await getProjectMetricsData(input.projectId, input.fromISO ?? "", toISO);
      const fromISO = input.fromISO ?? defaultFromISO(access.project.startDate, raw, toISO);
      return computeProjectMetrics({ ...raw, window: { fromISO, toISO } });
    }),
});
```

- [ ] **Step 3: 跑既有测试 + 类型确认无回归**

Run: `node scripts/test.mjs server/analytics.test.ts; pnpm check`
Expected: 现有 analytics 行为不变；tsc 零错。（若 analytics 无独立测试文件，则只跑 `pnpm check` 必须零错。）

- [ ] **Step 4: Commit**

```bash
git add server/metrics-window.ts server/routers/analytics.ts
git commit -m "refactor(度量): defaultFromISO/shanghaiTodayISO 提取到 metrics-window 共用"
```

---

### Task 4: db `getPortfolioMetricsData(userId)` 编排

逐项目复用 `getProjectMetricsData + defaultFromISO + computeProjectMetrics`，装行喂 `rollupPortfolioMetrics`。

**Files:**
- Modify: `server/db.ts`（新增函数 + import；放在 `getProjectMetricsData` 之后，约 1361 行后）
- Test: `server/portfolio-metrics-db.test.ts`

- [ ] **Step 1: 写失败的集成测试**

Create `server/portfolio-metrics-db.test.ts`（镜像 `server/portfolio-health.test.ts` 的建/删项目套路）：

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { getDb, getPortfolioMetricsData, getProjectMetricsData, upsertProjectTask } from "./db";
import { computeProjectMetrics } from "../shared/metrics";
import { defaultFromISO, shanghaiTodayISO } from "./metrics-window";
import { projects, projectTasks } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `pf-metrics-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("getPortfolioMetricsData", () => {
  it("行标量与单独 computeProjectMetrics 一致，startDate 为空走兜底不报错", async () => {
    const db = await getDb();
    if (!db) return; // 无 DB 环境跳过

    await db.insert(projects).values({
      id: PROJ, name: "组合度量测试", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "concept", archived: false, createdBy: 1,
      startDate: null,
    }).onConflictDoNothing();
    await upsertProjectTask(PROJ, "concept", "c1", { dueDate: "2026-06-10", status: "done" });
    await upsertProjectTask(PROJ, "concept", "c2", { dueDate: "2026-06-12", status: "in_progress" });

    const rollup = await getPortfolioMetricsData(1);
    const row = rollup.rows.find((r) => r.projectId === PROJ);
    expect(row).toBeDefined();

    // 用同一组建块独立重算，验证编排忠实接线
    const todayISO = shanghaiTodayISO();
    const raw = await getProjectMetricsData(PROJ, "", todayISO);
    const fromISO = defaultFromISO(null, raw, todayISO);
    const standalone = computeProjectMetrics({ ...raw, window: { fromISO, toISO: todayISO } });
    expect(row!.overdueRatePct).toBe(standalone.efficiency.overdueRatePct);
    expect(row!.dueDatedCount).toBe(standalone.efficiency.dueDatedCount);
    expect(row!.overdueCount).toBe(standalone.efficiency.overdueCount);
    expect(row!.gateFirstPassRatePct).toBe(standalone.process.gateFirstPassRatePct);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/portfolio-metrics-db.test.ts`
Expected: FAIL — `getPortfolioMetricsData` 未导出。

- [ ] **Step 3: 实现 + 补 import**

`server/db.ts` 顶部 import 区补（与现有 import 风格一致）：

```typescript
import { computeProjectMetrics, type ProjectMetrics } from "../shared/metrics";
import { rollupPortfolioMetrics, type PortfolioMetricsRollup } from "../shared/portfolio-metrics";
import { defaultFromISO } from "./metrics-window";
```

在 `getProjectMetricsData` 函数之后新增（`getPortfolio`/`getProjectMetricsData`/`todayInShanghaiISO` 均已在 db.ts 内）：

```typescript
/** 组合度量 rollup：逐项目复用单项目度量，装行 + 精确池化聚合。范围=getPortfolio（全部未归档，前端按 lens 收口）。 */
export async function getPortfolioMetricsData(userId: number): Promise<PortfolioMetricsRollup> {
  const portfolio = await getPortfolio(userId);
  const todayISO = todayInShanghaiISO();
  const input: { projectId: string; name: string; ragLevel: string; metrics: ProjectMetrics }[] = [];
  for (const p of portfolio) {
    const raw = await getProjectMetricsData(p.id, "", todayISO);
    const fromISO = defaultFromISO(p.startDate, raw, todayISO);
    const metrics = computeProjectMetrics({ ...raw, window: { fromISO, toISO: todayISO } });
    input.push({ projectId: p.id, name: p.name, ragLevel: p.ragLevel, metrics });
  }
  return rollupPortfolioMetrics(input);
}
```

> 注：若 db.ts 已 import 过 `computeProjectMetrics` 或 `todayInShanghaiISO`，勿重复 import；`todayInShanghaiISO` 是 db.ts 内既有 helper（getPortfolio 在用，约 574 行）。

- [ ] **Step 4: 跑测试 + 类型**

Run: `node scripts/test.mjs server/portfolio-metrics-db.test.ts && pnpm check`
Expected: PASS（或无 DB 环境时跳过）；tsc 零错。

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/portfolio-metrics-db.test.ts
git commit -m "feat(度量): getPortfolioMetricsData 编排（逐项目复用单项目度量+池化聚合）"
```

---

### Task 5: 路由 `analytics.portfolioMetrics`

**Files:**
- Modify: `server/routers/analytics.ts`

- [ ] **Step 1: 加 query**

`server/routers/analytics.ts`：import 区把 `import { getProjectMetricsData } from "../db";` 改为 `import { getProjectMetricsData, getPortfolioMetricsData } from "../db";`；在 `analyticsRouter` 内 `projectMetrics` 之后加：

```typescript
  portfolioMetrics: protectedProcedure
    .query(async ({ ctx }) => {
      return getPortfolioMetricsData(ctx.user.id);
    }),
```

> 鉴权说明（注释里写明，承接 spec 决策 3/C）：`getPortfolio` 返回全部未归档项目，本端点不做范围过滤——管理层对比工具，范围由前端只在 exec lens 发起查询收口（Task 6）。

- [ ] **Step 2: 类型 + 烟雾测试**

Run: `pnpm check && node scripts/test.mjs server/smoke.test.ts`
Expected: tsc 零错；router 装配不报错。

- [ ] **Step 3: Commit**

```bash
git add server/routers/analytics.ts
git commit -m "feat(度量): analytics.portfolioMetrics 路由"
```

---

### Task 6: 前端 `PortfolioMetricsTable` + OverviewPage 挂载（仅 exec）

**Files:**
- Create: `client/src/components/views/overview/PortfolioMetricsTable.tsx`
- Modify: `client/src/components/views/overview/OverviewPage.tsx`（约 76-88 渲染区）

- [ ] **Step 1: 建组件**

Create `client/src/components/views/overview/PortfolioMetricsTable.tsx`（trpc/样式按本目录其它组件惯例；列表只读、可点列头排序）：

```tsx
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

type SortKey = "overdueRatePct" | "leadTimeDaysMedian" | "recentThroughput" | "gateFirstPassRatePct";

const RAG_DOT: Record<string, string> = {
  red: "bg-red-500", amber: "bg-amber-500", green: "bg-emerald-500",
};

function fmt(value: number | null, suffix = ""): string {
  return value === null || value === undefined ? "—" : `${value}${suffix}`;
}

export function PortfolioMetricsTable() {
  const { data, isLoading } = trpc.analytics.portfolioMetrics.useQuery();
  const [sortKey, setSortKey] = useState<SortKey>("overdueRatePct");

  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av; // 降序
    });
  }, [data, sortKey]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-stone-400 py-6 justify-center">
        <Loader2 size={16} className="animate-spin" />加载项目度量对比…
      </div>
    );
  }

  const agg = data?.aggregates;
  if (!agg || rows.length === 0) {
    return <div className="py-6 text-center text-sm text-stone-400">暂无项目</div>;
  }

  const cols: { key: SortKey; label: string; suffix?: string }[] = [
    { key: "leadTimeDaysMedian", label: "Lead Time 中位", suffix: "d" },
    { key: "overdueRatePct", label: "逾期率", suffix: "%" },
    { key: "recentThroughput", label: "近4周吞吐" },
    { key: "gateFirstPassRatePct", label: "Gate 通过率", suffix: "%" },
  ];

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-stone-100 px-4 py-3 text-xs text-stone-500">
        <span className="font-mono uppercase tracking-widest text-stone-400">项目度量对比</span>
        <span>项目数 <b className="text-stone-800">{agg.projectCount}</b></span>
        <span>
          <span className="text-red-600">红 {agg.ragCounts.red}</span> ·
          <span className="text-amber-600"> 黄 {agg.ragCounts.amber}</span> ·
          <span className="text-emerald-600"> 绿 {agg.ragCounts.green}</span>
        </span>
        <span>总近4周吞吐 <b className="text-stone-800">{agg.totalRecentThroughput}</b></span>
        <span>池化逾期率 <b className="text-stone-800">{fmt(agg.pooledOverdueRatePct, "%")}</b></span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-mono uppercase tracking-wider text-stone-400">
            <th className="px-4 py-2">项目</th>
            {cols.map((c) => (
              <th key={c.key} className="px-4 py-2">
                <button
                  type="button"
                  onClick={() => setSortKey(c.key)}
                  className={`hover:text-stone-700 ${sortKey === c.key ? "text-stone-800" : ""}`}
                >
                  {c.label}{sortKey === c.key ? " ↓" : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.projectId} className={`border-t border-stone-100 ${r.ragLevel === "red" ? "bg-red-50/40" : ""}`}>
              <td className="px-4 py-2">
                <span className="inline-flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${RAG_DOT[r.ragLevel] ?? "bg-stone-300"}`} />
                  {r.name}
                </span>
              </td>
              <td className="px-4 py-2">{fmt(r.leadTimeDaysMedian, "d")}</td>
              <td className="px-4 py-2">{fmt(r.overdueRatePct, "%")}</td>
              <td className="px-4 py-2">{r.recentThroughput}</td>
              <td className="px-4 py-2">{fmt(r.gateFirstPassRatePct, "%")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

> 注：`trpc` import 路径与 `@/lib/trpc` 别名以本目录其它组件实际写法为准（打开 `OverviewPage.tsx` 看它怎么 import `trpc` 就照抄）。

- [ ] **Step 2: OverviewPage 挂载（仅 exec lens）**

`OverviewPage.tsx`：顶部 import 区加 `import { PortfolioMetricsTable } from "./PortfolioMetricsTable";`。在现有 `{!isWorkbench && (<PortfolioDashboard ... />)}` 块（约 76-78 行）之后、`{!isWorkbench && (<div ...需要处理...>)}` 之前插入：

```tsx
      {activeLens === "exec" && <PortfolioMetricsTable />}
```

（`activeLens === "exec"` 比 `!isWorkbench` 更严：exec 专属；组件仅在 exec 挂载，故 query 也只在 exec 发起，满足 spec 决策 6。）

- [ ] **Step 3: 类型 + 构建验证**

Run: `pnpm check`
Expected: tsc 零错。

- [ ] **Step 4: 预览验证（exec 账号）**

用 preview 工具：以 admin/exec 账号打开总览页，确认「项目度量对比」段出现、聚合条数值合理、点列头可改排序；切到 PM/个人视角确认该段**不出现**。截图留证。

- [ ] **Step 5: Commit**

```bash
git add client/src/components/views/overview/PortfolioMetricsTable.tsx client/src/components/views/overview/OverviewPage.tsx
git commit -m "feat(度量): 组合层项目度量对比表（仅 exec lens 挂载）"
```

---

## 自检（Self-Review）

- **Spec 覆盖**：决策 3 范围/lens 收口→Task 5 注释 + Task 6 挂载条件；决策 5 精确池化→Task 1+2；决策 6 UI lens→Task 6；A 纯函数→Task 2；B db 编排（含 fromISO 顺序/共用 helper）→Task 3+4；C 路由→Task 5；D UI→Task 6；测试矩阵→各 Task Step 1。✅
- **类型一致**：`PortfolioMetricsRollup/PortfolioMetricRow/PortfolioMetricAggregates`、`pooledOverdueRatePct`、`dueDatedCount/overdueCount`、`rollupPortfolioMetrics`、`getPortfolioMetricsData`、`defaultFromISO/shanghaiTodayISO` 全程同名一致。✅
- **无占位符**：所有代码步给出完整代码；唯二「以现状为准」标注（trpc import 别名、analytics 既有测试文件名）是有意让执行者对齐真实写法，非逻辑占位。✅
- **YAGNI**：不做燃尽叠加/DI 列/池化 LeadTime·Gate/批量化/PM-scoped（spec 明确排除）。✅
