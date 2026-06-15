# 总览页合并 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把仪表盘 + 组合看板 + 报表 + 我的任务/逾期/阻塞 合并为单一「总览」页，全页改用准确的聚合数据源，并新增 RAG 健康度与里程碑日历。

**Architecture:** 上下分层单页：顶部「全局共识区」（KPI + RAG + 阶段分布 + 全部项目表，人人一致）+ 下方「千人千面区」（管理层/PM/我的，默认按角色、可经顶部切换）+ 里程碑日历。共识与个性数据统一源自 `trpc.projects.portfolio` 与 `trpc.tasks.*`；新增 `trpc.projects.calendar` 提供里程碑级事件。纯判定逻辑（RAG）下沉到 `shared/` 便于单元测试。

**Tech Stack:** React + wouter + tRPC + TanStack Query（client）；Express + tRPC + Drizzle ORM + Postgres（server）；Vitest（`node scripts/test.mjs`，DB-backed）；TypeScript 严格模式（`npm run check`）。

参考规格：`docs/superpowers/specs/2026-06-15-merge-overview-dashboard-design.md`

---

## File Structure

**新建**
- `shared/health.ts` — `RagLevel` 类型、`RagInput` 类型、`computeRag()` 纯函数。
- `server/health.test.ts` — computeRag 单元测试（无 DB）。
- `server/calendar.test.ts` — getCalendar DB-backed 测试。
- `client/src/components/views/overview/OverviewPage.tsx` — 容器，持 lens 状态 + 顶部切换。
- `client/src/components/views/overview/KpiStrip.tsx` — 6 KPI，逾期/阻塞可下钻。
- `client/src/components/views/overview/RagHealthPanel.tsx` — 三色计数 + 红黄项目列表。
- `client/src/components/views/overview/PortfolioTable.tsx` — 从 PortfolioBoard 抽出的可复用表。
- `client/src/components/views/overview/PerspectivePanel.tsx` — 从 ReportsView 抽出的 exec/pm/mine。
- `client/src/components/views/overview/MilestoneCalendar.tsx` — 里程碑日历。

**修改**
- `server/db.ts` — getPortfolio 增 `criticalIssues` 字段；新增 `getCalendar()` + `CalendarEvent` 类型。
- `server/routers/projects.ts` — 新增 `calendar` procedure。
- `client/src/lib/data.ts` — 无需改（沿用 PHASE_MAP/RISK_CONFIG/CATEGORY_MAP）。
- `client/src/pages/Home.tsx` — 导航与路由收敛。

**删除**（最后一步，确认无引用后）
- `client/src/components/views/DashboardView.tsx`
- `client/src/components/views/PortfolioBoard.tsx`
- `client/src/components/views/ReportsView.tsx`
- `client/src/components/views/MyTasksView.tsx` / `OverdueTasksView.tsx` / `BlockedTasksView.tsx`（仅当无其它引用）

---

## Task 1: RAG 健康度纯函数

**Files:**
- Create: `shared/health.ts`
- Test: `server/health.test.ts`

- [ ] **Step 1: 写失败测试**

`server/health.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeRag, type RagInput } from "@shared/health";

const base: RagInput = {
  risk: "low", projectedEnd: null, targetDate: null,
  overdueTasks: 0, blockedTasks: 0, openIssues: 0, criticalIssues: 0,
};

describe("computeRag", () => {
  it("一切正常 → green", () => {
    expect(computeRag(base)).toBe("green");
  });
  it("high risk → red", () => {
    expect(computeRag({ ...base, risk: "high" })).toBe("red");
  });
  it("预计超期(projectedEnd > targetDate) → red", () => {
    expect(computeRag({ ...base, projectedEnd: "2026-09-01", targetDate: "2026-08-01" })).toBe("red");
  });
  it("有逾期任务 → red", () => {
    expect(computeRag({ ...base, overdueTasks: 2 })).toBe("red");
  });
  it("有 P0/P1 严重问题 → red", () => {
    expect(computeRag({ ...base, criticalIssues: 1 })).toBe("red");
  });
  it("medium risk 且无红灯条件 → amber", () => {
    expect(computeRag({ ...base, risk: "medium" })).toBe("amber");
  });
  it("有阻塞任务但无红灯 → amber", () => {
    expect(computeRag({ ...base, blockedTasks: 1 })).toBe("amber");
  });
  it("有开放问题(非严重)但无红灯 → amber", () => {
    expect(computeRag({ ...base, openIssues: 3 })).toBe("amber");
  });
  it("红灯优先于黄灯：high risk + blocked → red", () => {
    expect(computeRag({ ...base, risk: "high", blockedTasks: 5 })).toBe("red");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test.mjs server/health.test.ts`
Expected: FAIL（`@shared/health` 不存在 / 模块解析失败）

- [ ] **Step 3: 实现 computeRag**

`shared/health.ts`:
```ts
/** 项目健康度等级。绿=正常，黄=需关注，红=需介入。 */
export type RagLevel = "green" | "amber" | "red";

/** computeRag 的输入：均来自 PortfolioRow，避免依赖具体数据层类型。 */
export type RagInput = {
  risk: string;
  projectedEnd: string | null;
  targetDate: string | null;
  overdueTasks: number;
  blockedTasks: number;
  openIssues: number;
  /** P0/P1 未关闭问题数 */
  criticalIssues: number;
};

/** 预计完成晚于目标日 → 视为超期。两者均为 YYYY-MM-DD，字符串比较即可。 */
function isProjectedOverdue(projectedEnd: string | null, targetDate: string | null): boolean {
  return !!(projectedEnd && targetDate && projectedEnd > targetDate);
}

/**
 * 计算项目 RAG。优先级从高到低短路：先判红，再判黄，否则绿。
 */
export function computeRag(input: RagInput): RagLevel {
  if (
    input.risk === "high" ||
    isProjectedOverdue(input.projectedEnd, input.targetDate) ||
    input.overdueTasks > 0 ||
    input.criticalIssues > 0
  ) {
    return "red";
  }
  if (input.risk === "medium" || input.blockedTasks > 0 || input.openIssues > 0) {
    return "amber";
  }
  return "green";
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test.mjs server/health.test.ts`
Expected: PASS（9 passed）

- [ ] **Step 5: 提交**

```bash
git add shared/health.ts server/health.test.ts
git commit -m "feat: RAG 健康度纯函数 computeRag"
```

---

## Task 2: getPortfolio 增补 criticalIssues + 新增 getCalendar

**Files:**
- Modify: `server/db.ts`（PortfolioRow 类型与 getPortfolio 的 issueAgg；文件末尾新增 getCalendar）
- Test: `server/calendar.test.ts`

- [ ] **Step 1: 写失败测试**

`server/calendar.test.ts`:
```ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { getCalendar, getDb } from "./db";
import { projects, projectPhases, projectGateReviews } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const OWNER = 778001;
const PROJ = `cal-test-${Date.now()}`;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJ, name: "日历测试项目", projectNumber: "CAL-1", category: "npd",
    risk: "low", currentPhase: "concept", createdBy: OWNER, targetDate: "2026-07-20",
  });
  await db.insert(projectPhases).values({ projectId: PROJ, phaseId: "concept", endDate: "2026-07-05" });
  await db.insert(projectGateReviews).values({
    projectId: PROJ, phaseId: "concept", reviewDate: "2026-07-10", decision: "conditional",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("getCalendar", () => {
  it("聚合阶段截止/Gate评审/项目目标日三类里程碑事件", async () => {
    const events = await getCalendar(OWNER, "2026-07-01", "2026-07-31");
    const mine = events.filter((e) => e.projectId === PROJ);
    const types = mine.map((e) => e.type).sort();
    expect(types).toEqual(["gate", "phase", "target"]);
    const phase = mine.find((e) => e.type === "phase");
    expect(phase?.date).toBe("2026-07-05");
    const gate = mine.find((e) => e.type === "gate");
    expect(gate?.date).toBe("2026-07-10");
    const target = mine.find((e) => e.type === "target");
    expect(target?.date).toBe("2026-07-20");
  });

  it("时间窗外的事件被过滤", async () => {
    const events = await getCalendar(OWNER, "2026-08-01", "2026-08-31");
    expect(events.filter((e) => e.projectId === PROJ)).toHaveLength(0);
  });

  it("无权限用户看不到该项目事件", async () => {
    const events = await getCalendar(999999, "2026-07-01", "2026-07-31");
    expect(events.filter((e) => e.projectId === PROJ)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test.mjs server/calendar.test.ts`
Expected: FAIL（`getCalendar` 未导出）

- [ ] **Step 3: 改 PortfolioRow 与 getPortfolio 的 issueAgg**

在 `server/db.ts` 的 `PortfolioRow` 类型增加一行（在 `openIssues` 后）：
```ts
  openIssues: number; criticalIssues: number; projectedEnd: string | null;
```

在 `getPortfolio` 的 `issueAgg` 查询里增加 `critical` 聚合：
```ts
  const issueAgg = await db.select({
    projectId: projectIssues.projectId,
    open: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress'))::int`,
    critical: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress') and ${projectIssues.severity} in ('P0','P1'))::int`,
  }).from(projectIssues).where(inArray(projectIssues.projectId, ids)).groupBy(projectIssues.projectId);
```

在 `getPortfolio` 的 return map 里补 `criticalIssues`（在 `openIssues` 行附近）：
```ts
      openIssues: i?.open ?? 0, criticalIssues: i?.critical ?? 0, projectedEnd: t?.projectedEnd ?? null,
```

> 注：确认 `projectIssues` 有 `severity` 列（`drizzle/schema.ts` projectIssues 定义，值域 P0/P1/P2/P3）。若列名不同，以 schema 实际为准。

- [ ] **Step 4: 实现 getCalendar**

在 `server/db.ts` 末尾追加（紧邻 getPortfolio 之后或文件尾部）：
```ts
/** 里程碑日历事件：阶段截止 / Gate 评审 / 项目目标日。 */
export type CalendarEvent = {
  date: string;          // YYYY-MM-DD
  type: "phase" | "gate" | "target";
  projectId: string;
  projectName: string;
  label: string;
};

/**
 * 在 [fromDate, toDate] 时间窗内聚合用户可见项目(owned ∪ member)的里程碑级事件。
 * 仅里程碑：阶段截止日(projectPhases.endDate)、Gate评审(projectGateReviews.reviewDate)、项目目标日(projects.targetDate)。
 */
export async function getCalendar(userId: number, fromDate: string, toDate: string): Promise<CalendarEvent[]> {
  const db = await getDb();
  if (!db) return [];
  const [owned, member] = await Promise.all([getProjectsByUser(userId), getProjectsByMember(userId)]);
  const projById = new Map<string, ProjectRow>();
  for (const p of [...owned, ...member]) projById.set(p.id, p);
  const ids = Array.from(projById.keys());
  if (ids.length === 0) return [];

  const inWindow = (d: string | null): d is string => !!d && d >= fromDate && d <= toDate;
  const events: CalendarEvent[] = [];

  // 项目目标日
  for (const p of projById.values()) {
    if (inWindow(p.targetDate)) {
      events.push({ date: p.targetDate, type: "target", projectId: p.id, projectName: p.name, label: "目标交付" });
    }
  }

  // 阶段截止
  const phaseRows = await db.select({
    projectId: projectPhases.projectId, phaseId: projectPhases.phaseId, endDate: projectPhases.endDate,
  }).from(projectPhases).where(inArray(projectPhases.projectId, ids));
  for (const r of phaseRows) {
    if (inWindow(r.endDate)) {
      const p = projById.get(r.projectId);
      if (p) events.push({ date: r.endDate, type: "phase", projectId: p.id, projectName: p.name, label: `${r.phaseId} 阶段截止` });
    }
  }

  // Gate 评审
  const gateRows = await db.select({
    projectId: projectGateReviews.projectId, reviewDate: projectGateReviews.reviewDate, gateName: projectGateReviews.gateName,
  }).from(projectGateReviews).where(inArray(projectGateReviews.projectId, ids));
  for (const r of gateRows) {
    if (inWindow(r.reviewDate)) {
      const p = projById.get(r.projectId);
      if (p) events.push({ date: r.reviewDate, type: "gate", projectId: p.id, projectName: p.name, label: r.gateName || "Gate 评审" });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}
```

> 确认 `server/db.ts` 顶部已 import `projectPhases, projectGateReviews`（若无则加到 schema import 行）。`inArray`、`ProjectRow`、`getProjectsByUser/Member` 均已在本文件存在。

- [ ] **Step 5: 运行测试确认通过**

Run: `node scripts/test.mjs server/calendar.test.ts`
Expected: PASS（3 passed）

- [ ] **Step 6: 跑全量 server 测试确认无回归（getPortfolio 改动）**

Run: `node scripts/test.mjs server/relational-tables.test.ts server/health.test.ts server/calendar.test.ts`
Expected: PASS（若有引用 PortfolioRow 的测试，确认 criticalIssues 不破坏既有断言）

- [ ] **Step 7: 提交**

```bash
git add server/db.ts server/calendar.test.ts
git commit -m "feat: getPortfolio 增 criticalIssues + 新增 getCalendar 里程碑聚合"
```

---

## Task 3: projects.calendar tRPC 端点

**Files:**
- Modify: `server/routers/projects.ts`

- [ ] **Step 1: 在 portfolio procedure 之后新增 calendar**

在 `server/routers/projects.ts` 的 `portfolio` 块之后插入：
```ts
  /** 里程碑日历：时间窗内的阶段截止/Gate/目标日事件 */
  calendar: protectedProcedure
    .input(z.object({ fromDate: z.string(), toDate: z.string() }))
    .query(async ({ ctx, input }) => {
      const { getCalendar } = await import("../db");
      return getCalendar(ctx.user.id, input.fromDate, input.toDate);
    }),
```

> `z` 已在该文件 import；`protectedProcedure` 同 portfolio。

- [ ] **Step 2: tsc 校验**

Run: `npm run check`
Expected: 无 error（新 procedure 类型正确）

- [ ] **Step 3: 提交**

```bash
git add server/routers/projects.ts
git commit -m "feat: projects.calendar 端点"
```

---

## Task 4: PortfolioTable 复用组件（从 PortfolioBoard 抽取）

**Files:**
- Create: `client/src/components/views/overview/PortfolioTable.tsx`

**做法：** 把现有 `client/src/components/views/PortfolioBoard.tsx` 中的「筛选 + 表格 + 排序 + Stat/Cell 辅助」整体迁入新组件，但**去掉**它自带的 `trpc.projects.portfolio.useQuery()` 和顶部汇总卡（汇总卡改由 KpiStrip 承担），改为**接收 rows 作为 prop**。`Row` 类型在此文件追加 `criticalIssues: number`。

- [ ] **Step 1: 创建 PortfolioTable**

`client/src/components/views/overview/PortfolioTable.tsx`:
```tsx
// 全部项目表：可排序/筛选/下钻。rows 由父组件传入（源自 projects.portfolio）。
import { useMemo, useState } from "react";
import { RISK_CONFIG, PHASE_MAP } from "@/lib/data";
import { CATEGORY_MAP } from "@/lib/sop-templates";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { ChevronRight, ArrowUpDown } from "lucide-react";

export type PortfolioTableRow = {
  id: string; name: string; projectNumber: string; category: string; risk: string;
  currentPhase: string; startDate: string | null; targetDate: string | null; pmName: string | null;
  taskTotal: number; taskDone: number; overdueTasks: number; blockedTasks: number;
  openIssues: number; criticalIssues: number; projectedEnd: string | null;
};

const progressOf = (r: PortfolioTableRow) => (r.taskTotal > 0 ? Math.round((r.taskDone / r.taskTotal) * 100) : 0);
const isOverdue = (r: PortfolioTableRow) => !!(r.projectedEnd && r.targetDate && r.projectedEnd > r.targetDate);
const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
type SortKey = "name" | "progress" | "risk" | "overdueTasks" | "blockedTasks" | "openIssues" | "projectedEnd";

export function PortfolioTable({ rows, onSelectProject }: { rows: PortfolioTableRow[]; onSelectProject: (id: string) => void }) {
  const [riskFilter, setRiskFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    let r = rows.filter((x) => (!riskFilter || x.risk === riskFilter) && (!catFilter || x.category === catFilter));
    r = [...r].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "progress": cmp = progressOf(a) - progressOf(b); break;
        case "risk": cmp = (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9); break;
        case "projectedEnd": cmp = (a.projectedEnd ?? "9999").localeCompare(b.projectedEnd ?? "9999"); break;
        default: cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortAsc ? cmp : -cmp;
    });
    return r;
  }, [rows, riskFilter, catFilter, sortKey, sortAsc]);

  const sortBtn = (key: SortKey, label: string) => (
    <button onClick={() => { sortKey === key ? setSortAsc(!sortAsc) : (setSortKey(key), setSortAsc(true)); }}
      className={`flex items-center gap-1 hover:text-stone-700 ${sortKey === key ? "text-stone-900" : ""}`}>
      {label}<ArrowUpDown size={10} className="opacity-50" />
    </button>
  );

  return (
    <div className="ce-panel p-0">
      <div className="flex flex-wrap items-center gap-2 text-xs p-3 border-b border-stone-100">
        <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="ce-control border border-stone-300 bg-white px-2 py-1.5">
          <option value="">全部风险</option><option value="high">高风险</option><option value="medium">中风险</option><option value="low">低风险</option>
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="ce-control border border-stone-300 bg-white px-2 py-1.5">
          <option value="">全部类型</option><option value="npd">新产品开发</option><option value="eco">迭代升级</option><option value="idr">外观翻新</option>
        </select>
        <span className="text-stone-400">显示 {filtered.length} / {rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50 text-[10px] font-mono uppercase tracking-wider text-stone-400">
              <th className="text-left px-3 py-2.5">{sortBtn("name", "项目")}</th>
              <th className="text-left px-3 py-2.5">类型</th>
              <th className="text-left px-3 py-2.5">当前阶段</th>
              <th className="text-left px-3 py-2.5 w-40">{sortBtn("progress", "进度")}</th>
              <th className="text-center px-3 py-2.5">{sortBtn("risk", "风险")}</th>
              <th className="text-center px-3 py-2.5">{sortBtn("overdueTasks", "逾期")}</th>
              <th className="text-center px-3 py-2.5">{sortBtn("blockedTasks", "阻塞")}</th>
              <th className="text-center px-3 py-2.5">{sortBtn("openIssues", "开放问题")}</th>
              <th className="text-left px-3 py-2.5">{sortBtn("projectedEnd", "预计完成")}</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const cat = CATEGORY_MAP[r.category as keyof typeof CATEGORY_MAP];
              const risk = RISK_CONFIG[r.risk as keyof typeof RISK_CONFIG];
              const prog = progressOf(r);
              const overdue = isOverdue(r);
              return (
                <tr key={r.id} onClick={() => onSelectProject(r.id)} className="border-b border-stone-50 hover:bg-stone-50/60 cursor-pointer">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-stone-800">{r.name}</div>
                    <div className="text-[10px] font-mono text-stone-400">{r.projectNumber || "—"}{r.pmName ? ` · PM ${r.pmName}` : ""}</div>
                  </td>
                  <td className="px-3 py-2.5">{cat ? <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${cat.borderColor} ${cat.color} ${cat.textColor}`}>{cat.badge}</span> : r.category}</td>
                  <td className="px-3 py-2.5 text-xs text-stone-600">{PHASE_MAP[r.currentPhase]?.name ?? r.currentPhase}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2"><div className="flex-1 min-w-[60px]"><ProgressBar value={prog} color="bg-stone-800" height="h-1.5" /></div><span className="text-[11px] font-mono text-stone-500">{prog}%</span></div>
                    <div className="text-[10px] font-mono text-stone-300">{r.taskDone}/{r.taskTotal}</div>
                  </td>
                  <td className="px-3 py-2.5 text-center"><span className={`text-xs font-medium ${risk?.color}`}>{risk?.label ?? r.risk}</span></td>
                  <td className="px-3 py-2.5 text-center"><Cell n={r.overdueTasks} tone="rose" /></td>
                  <td className="px-3 py-2.5 text-center"><Cell n={r.blockedTasks} tone="amber" /></td>
                  <td className="px-3 py-2.5 text-center"><Cell n={r.openIssues} tone="rose" /></td>
                  <td className="px-3 py-2.5 text-xs font-mono">
                    <span className={overdue ? "text-rose-600" : "text-stone-600"}>{r.projectedEnd || "未排期"}</span>
                    {overdue && <span className="block text-[9px] text-rose-500">超目标 {r.targetDate}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-stone-300"><ChevronRight size={14} /></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={10} className="px-3 py-10 text-center text-stone-400 text-sm">暂无项目</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ n, tone }: { n: number; tone: "rose" | "amber" }) {
  if (!n) return <span className="text-stone-300">—</span>;
  const cls = tone === "rose" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-amber-50 text-amber-700 border-amber-200";
  return <span className={`text-[11px] font-mono px-1.5 py-0.5 border ${cls}`}>{n}</span>;
}
```

- [ ] **Step 2: tsc 校验**

Run: `npm run check`
Expected: 无 error

- [ ] **Step 3: 提交**

```bash
git add client/src/components/views/overview/PortfolioTable.tsx
git commit -m "feat: PortfolioTable 复用表组件（rows 由父传入）"
```

---

## Task 5: KpiStrip（含逾期/阻塞下钻）

**Files:**
- Create: `client/src/components/views/overview/KpiStrip.tsx`

**说明：** 6 张 KPI；逾期任务、阻塞任务两张可点击，点击回调由父组件打开下钻抽屉（Task 9 用 `trpc.tasks.overdue/blocked`）。延期率 = 预计超期项目数 / 项目总数。

- [ ] **Step 1: 创建 KpiStrip**

`client/src/components/views/overview/KpiStrip.tsx`:
```tsx
import type { PortfolioTableRow } from "./PortfolioTable";
import { Hash, Activity, AlertTriangle, TrendingUp, CalendarClock, Ban } from "lucide-react";

const isOverdue = (r: PortfolioTableRow) => !!(r.projectedEnd && r.targetDate && r.projectedEnd > r.targetDate);

export function KpiStrip({ rows, onDrill }: { rows: PortfolioTableRow[]; onDrill: (kind: "overdue" | "blocked") => void }) {
  const total = rows.length;
  const active = rows.filter((r) => r.currentPhase !== "mp").length;
  const highRisk = rows.filter((r) => r.risk === "high").length;
  const delayRate = total > 0 ? Math.round((rows.filter(isOverdue).length / total) * 100) : 0;
  const overdueTasks = rows.reduce((s, r) => s + r.overdueTasks, 0);
  const blockedTasks = rows.reduce((s, r) => s + r.blockedTasks, 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Kpi icon={<Hash size={15} />} label="项目总数" value={total} />
      <Kpi icon={<Activity size={15} />} label="进行中" value={active} />
      <Kpi icon={<AlertTriangle size={15} />} label="高风险" value={highRisk} accent={highRisk > 0 ? "text-rose-600" : undefined} />
      <Kpi icon={<TrendingUp size={15} />} label="延期率" value={`${delayRate}%`} accent={delayRate > 0 ? "text-amber-600" : undefined} />
      <Kpi icon={<CalendarClock size={15} />} label="逾期任务" value={overdueTasks} accent={overdueTasks > 0 ? "text-rose-600" : undefined} onClick={() => onDrill("overdue")} />
      <Kpi icon={<Ban size={15} />} label="阻塞任务" value={blockedTasks} accent={blockedTasks > 0 ? "text-amber-600" : undefined} onClick={() => onDrill("blocked")} />
    </div>
  );
}

function Kpi({ icon, label, value, accent, onClick }: { icon: React.ReactNode; label: string; value: number | string; accent?: string; onClick?: () => void }) {
  const clickable = !!onClick;
  return (
    <button type="button" disabled={!clickable} onClick={onClick}
      className={`ce-card p-4 text-left ${clickable ? "cursor-pointer hover:border-stone-300 transition-colors" : "cursor-default"}`}>
      <div className="flex items-center gap-1.5 text-stone-400">{icon}<span className="text-[10px] font-mono uppercase tracking-wider">{label}</span>{clickable && <span className="ml-auto text-[9px] font-mono text-stone-300">下钻›</span>}</div>
      <div className={`mt-1.5 text-2xl font-serif font-semibold ${accent ?? "text-stone-900"}`}>{value}</div>
    </button>
  );
}
```

- [ ] **Step 2: tsc 校验**

Run: `npm run check`
Expected: 无 error

- [ ] **Step 3: 提交**

```bash
git add client/src/components/views/overview/KpiStrip.tsx
git commit -m "feat: KpiStrip（逾期/阻塞可下钻）"
```

---

## Task 6: RagHealthPanel

**Files:**
- Create: `client/src/components/views/overview/RagHealthPanel.tsx`

- [ ] **Step 1: 创建 RagHealthPanel**

`client/src/components/views/overview/RagHealthPanel.tsx`:
```tsx
import { useMemo } from "react";
import { computeRag, type RagLevel } from "@shared/health";
import type { PortfolioTableRow } from "./PortfolioTable";
import { PHASE_MAP } from "@/lib/data";
import { TrafficCone, ChevronRight } from "lucide-react";

const LABEL: Record<RagLevel, string> = { green: "绿", amber: "黄", red: "红" };

export function RagHealthPanel({ rows, onSelectProject }: { rows: PortfolioTableRow[]; onSelectProject: (id: string) => void }) {
  const scored = useMemo(() => rows.map((r) => ({ row: r, level: computeRag(r) })), [rows]);
  const counts = { green: 0, amber: 0, red: 0 } as Record<RagLevel, number>;
  for (const s of scored) counts[s.level]++;
  const attention = scored.filter((s) => s.level !== "green").sort((a, b) => (a.level === "red" ? -1 : 1) - (b.level === "red" ? -1 : 1));

  return (
    <div className="ce-panel p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-serif text-lg text-stone-900">项目健康度</h3>
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">PROJECT HEALTH · RAG</p>
        </div>
        <TrafficCone size={18} className="text-stone-300" />
      </div>
      <div className="flex gap-2 mb-4">
        <Pill level="green" n={counts.green} /><Pill level="amber" n={counts.amber} /><Pill level="red" n={counts.red} />
      </div>
      <div className="divide-y divide-stone-100">
        {attention.length === 0 && <div className="text-sm text-stone-400 py-2">全部项目健康（绿）</div>}
        {attention.map(({ row, level }) => (
          <div key={row.id} onClick={() => onSelectProject(row.id)} className="flex items-center gap-3 py-2 cursor-pointer hover:bg-stone-50/60 -mx-2 px-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${level === "red" ? "bg-rose-500" : "bg-amber-500"}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-stone-800 truncate">{row.name}</div>
              <div className="text-[10px] font-mono text-stone-400">{PHASE_MAP[row.currentPhase]?.name ?? row.currentPhase}</div>
            </div>
            <ChevronRight size={13} className="text-stone-300 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Pill({ level, n }: { level: RagLevel; n: number }) {
  const cls = level === "green" ? "bg-emerald-50 text-emerald-700" : level === "amber" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
  return <span className={`flex-1 text-center rounded py-2 text-sm font-medium ${cls}`}>{LABEL[level]} {n}</span>;
}
```

> 若 `TrafficCone` 图标在当前 lucide-react 版本不存在，改用 `Activity`。

- [ ] **Step 2: tsc 校验**

Run: `npm run check`
Expected: 无 error

- [ ] **Step 3: 提交**

```bash
git add client/src/components/views/overview/RagHealthPanel.tsx
git commit -m "feat: RagHealthPanel 三色计数 + 红黄项目下钻"
```

---

## Task 7: PerspectivePanel（从 ReportsView 抽取 exec/pm/mine）

**Files:**
- Create: `client/src/components/views/overview/PerspectivePanel.tsx`

**做法：** 把 `client/src/components/views/ReportsView.tsx` 的内容迁入，但**去掉**外层标题栏与它自己的 Tab 切换（视角由父组件经 `lens` prop 控制），并**去掉** `trpc.projects.portfolio.useQuery()` —— portfolio rows 由父传入。保留内部 `MyTasks`、`ProjectRows`、`Stat`、`Panel` 辅助组件与 `exec` 计算逻辑。`myTasks` 查询仍在本组件内（`trpc.tasks.myTasks.useQuery`）。

- [ ] **Step 1: 创建 PerspectivePanel**

`client/src/components/views/overview/PerspectivePanel.tsx`:
```tsx
// 千人千面面板：exec/pm/mine 三视角，视角由父组件控制。portfolio rows 由父传入。
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { RISK_CONFIG, PHASE_MAP } from "@/lib/data";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { TaskListView, type TaskRow } from "../TaskListView";
import type { TaskStatus, TaskPriority } from "@shared/const";
import { Bug, Ban, CalendarClock, ChevronRight, CheckCircle2 } from "lucide-react";
import type { PortfolioTableRow } from "./PortfolioTable";

export type Lens = "exec" | "pm" | "mine";
const prog = (r: PortfolioTableRow) => (r.taskTotal > 0 ? Math.round((r.taskDone / r.taskTotal) * 100) : 0);
const overdue = (r: PortfolioTableRow) => !!(r.projectedEnd && r.targetDate && r.projectedEnd > r.targetDate);

export function PerspectivePanel({ lens, rows, onSelectProject }: { lens: Lens; rows: PortfolioTableRow[]; onSelectProject: (id: string) => void }) {
  const { user } = useAuth();
  const { data: myTasks = [], isLoading: myLoading, refetch: refetchMine } = trpc.tasks.myTasks.useQuery();

  const exec = useMemo(() => {
    const total = rows.length || 1;
    const od = rows.filter(overdue).length;
    const risk = { high: rows.filter((r) => r.risk === "high").length, medium: rows.filter((r) => r.risk === "medium").length, low: rows.filter((r) => r.risk === "low").length };
    const byPhase = new Map<string, number>();
    for (const r of rows) byPhase.set(r.currentPhase, (byPhase.get(r.currentPhase) ?? 0) + r.overdueTasks);
    const phaseDelays = Array.from(byPhase.entries()).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    return { total: rows.length, delayRate: Math.round((od / total) * 100), risk, phaseDelays };
  }, [rows]);

  const myProjects = useMemo(() => rows.filter((r) => r.pmUserId === user?.id), [rows, user?.id]);

  if (lens === "exec") {
    return (
      <div className="space-y-5">
        <Panel title="风险分布">
          {(["high", "medium", "low"] as const).map((k) => {
            const n = exec.risk[k]; const pct = exec.total ? Math.round((n / exec.total) * 100) : 0;
            const rc = RISK_CONFIG[k];
            return (
              <div key={k} className="flex items-center gap-3 py-1.5">
                <span className={`w-12 text-xs ${rc.color}`}>{rc.label}</span>
                <div className="flex-1"><ProgressBar value={pct} color={k === "high" ? "bg-rose-500" : k === "medium" ? "bg-amber-500" : "bg-emerald-500"} height="h-2" /></div>
                <span className="text-[11px] font-mono text-stone-500 w-12 text-right">{n} ({pct}%)</span>
              </div>
            );
          })}
        </Panel>
        <Panel title="阶段延期分布（按当前阶段汇总逾期任务）">
          {exec.phaseDelays.length === 0 ? <div className="text-sm text-stone-400">暂无逾期任务</div> :
            exec.phaseDelays.map(([ph, n]) => (
              <div key={ph} className="flex items-center justify-between py-1 text-sm">
                <span className="text-stone-600">{PHASE_MAP[ph]?.name ?? ph}</span>
                <span className="text-[11px] font-mono text-rose-600">{n} 个逾期</span>
              </div>
            ))}
        </Panel>
        <Panel title="高风险项目">
          <ProjectRows rows={rows.filter((r) => r.risk === "high")} onSelectProject={onSelectProject} empty="暂无高风险项目" />
        </Panel>
      </div>
    );
  }

  if (lens === "pm") {
    return (
      <Panel title={`我负责的项目（${myProjects.length}）`}>
        <ProjectRows rows={myProjects} onSelectProject={onSelectProject} empty="你当前不是任何项目的 PM" />
      </Panel>
    );
  }

  return <MyTasks tasks={myTasks} isLoading={myLoading} onRefetch={() => refetchMine()} onSelectProject={onSelectProject} />;
}

type MyTaskApiRow = {
  id: number; projectId: string; phaseId: string; taskId: string;
  projectName: string; projectNumber: string; projectCategory: string;
  status: string; priority: string | null; dueDate: string | null;
  assigneeUserId: number | null; completed: boolean;
};

function MyTasks({ tasks, isLoading, onRefetch, onSelectProject }: {
  tasks: MyTaskApiRow[]; isLoading: boolean; onRefetch: () => void; onSelectProject: (id: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const od = tasks.filter((t) => t.dueDate && t.dueDate < today).length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const soon = tasks.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)).length;
  const rows: TaskRow[] = tasks.map((t) => ({
    id: t.id, projectId: t.projectId, phaseId: t.phaseId, taskId: t.taskId,
    projectName: t.projectName, projectNumber: t.projectNumber, projectCategory: t.projectCategory,
    status: t.status as TaskStatus, priority: t.priority as TaskPriority,
    dueDate: t.dueDate ? String(t.dueDate) : null, assigneeUserId: t.assigneeUserId ?? null, completed: t.completed,
  }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="待办任务" value={tasks.length} />
        <Stat label="已逾期" value={od} accent={od > 0 ? "text-rose-600" : undefined} />
        <Stat label="3天内到期" value={soon} accent={soon > 0 ? "text-amber-600" : undefined} />
        <Stat label="被阻塞" value={blocked} accent={blocked > 0 ? "text-amber-600" : undefined} />
      </div>
      <div className="ce-table-shell">
        <TaskListView tasks={rows} isLoading={isLoading} emptyIcon={<CheckCircle2 size={24} />}
          emptyTitle="没有待办任务 🎉" emptyDesc="当前没有指派给您的未完成任务。"
          onRefetch={onRefetch} onNavigateToProject={onSelectProject} showOverdueBadge />
      </div>
    </div>
  );
}

function ProjectRows({ rows, onSelectProject, empty }: { rows: PortfolioTableRow[]; onSelectProject: (id: string) => void; empty: string }) {
  if (rows.length === 0) return <div className="text-sm text-stone-400">{empty}</div>;
  return (
    <div className="divide-y divide-stone-100">
      {rows.map((r) => (
        <div key={r.id} onClick={() => onSelectProject(r.id)} className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-stone-50/60 -mx-2 px-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-stone-800 truncate">{r.name}</div>
            <div className="text-[10px] font-mono text-stone-400">{PHASE_MAP[r.currentPhase]?.name ?? r.currentPhase}</div>
          </div>
          <div className="w-24"><ProgressBar value={prog(r)} color="bg-stone-800" height="h-1.5" /></div>
          {r.overdueTasks > 0 && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-0.5"><CalendarClock size={9} />{r.overdueTasks}</span>}
          {r.blockedTasks > 0 && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-0.5"><Ban size={9} />{r.blockedTasks}</span>}
          {r.openIssues > 0 && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-0.5"><Bug size={9} />{r.openIssues}</span>}
          {overdue(r) && <span className="text-[10px] font-mono text-rose-600">超期</span>}
          <ChevronRight size={13} className="text-stone-300" />
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="ce-card p-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{label}</div>
      <div className={`mt-1.5 text-2xl font-serif font-semibold ${accent ?? "text-stone-900"}`}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ce-panel p-4">
      <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: tsc 校验**

Run: `npm run check`
Expected: 无 error。若 `user?.id` 类型为 undefined 报错，确认 `useAuth` 的 user 类型含 `id: number`（既有 ReportsView 同写法，应一致）。

- [ ] **Step 3: 提交**

```bash
git add client/src/components/views/overview/PerspectivePanel.tsx
git commit -m "feat: PerspectivePanel exec/pm/mine（视角受控、rows 由父传入）"
```

---

## Task 8: MilestoneCalendar

**Files:**
- Create: `client/src/components/views/overview/MilestoneCalendar.tsx`

**说明：** 默认显示当前月，可上/下月切换。从 `trpc.projects.calendar` 拉取该月 [月初, 月末] 的事件，按日分桶渲染 7 列网格。事件点击下钻到项目。

- [ ] **Step 1: 创建 MilestoneCalendar**

`client/src/components/views/overview/MilestoneCalendar.tsx`:
```tsx
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Calendar, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

const TYPE_CLS: Record<string, string> = {
  phase: "bg-blue-50 text-blue-700 border-blue-200",
  gate: "bg-amber-50 text-amber-700 border-amber-200",
  target: "bg-rose-50 text-rose-700 border-rose-200",
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function MilestoneCalendar({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() }); // month 0-11
  const first = new Date(ym.year, ym.month, 1);
  const daysInMonth = new Date(ym.year, ym.month + 1, 0).getDate();
  const fromDate = ymd(ym.year, ym.month, 1);
  const toDate = ymd(ym.year, ym.month, daysInMonth);

  const { data: events = [], isLoading } = trpc.projects.calendar.useQuery({ fromDate, toDate });

  const byDay = useMemo(() => {
    const m = new Map<string, typeof events>();
    for (const e of events) {
      const arr = m.get(e.date) ?? [];
      arr.push(e); m.set(e.date, arr);
    }
    return m;
  }, [events]);

  const leadingBlanks = first.getDay(); // 0=周日
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const shift = (delta: number) => setYm(({ year, month }) => {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  return (
    <div className="ce-panel p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-amber-500" />
          <h3 className="font-serif text-lg text-stone-900">里程碑 / Gate 日历</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="text-stone-400 hover:text-stone-700"><ChevronLeft size={16} /></button>
          <span className="text-sm font-mono text-stone-600">{ym.year}-{pad(ym.month + 1)}</span>
          <button onClick={() => shift(1)} className="text-stone-400 hover:text-stone-700"><ChevronRight size={16} /></button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-stone-400 py-8 justify-center"><Loader2 size={16} className="animate-spin" />加载日历…</div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 mb-1 text-[10px] font-mono text-stone-400 text-center">
            {["日", "一", "二", "三", "四", "五", "六"].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`b${i}`} />;
              const key = ymd(ym.year, ym.month, day);
              const dayEvents = byDay.get(key) ?? [];
              return (
                <div key={key} className="min-h-[68px] border border-stone-100 rounded p-1">
                  <div className="text-[10px] font-mono text-stone-400">{day}</div>
                  <div className="space-y-0.5 mt-0.5">
                    {dayEvents.map((e, j) => (
                      <button key={j} onClick={() => onSelectProject(e.projectId)} title={`${e.projectName} · ${e.label}`}
                        className={`block w-full text-left truncate text-[9px] px-1 py-0.5 border rounded ${TYPE_CLS[e.type]}`}>
                        {e.projectName}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc 校验**

Run: `npm run check`
Expected: 无 error（`trpc.projects.calendar.useQuery` 类型来自 Task 3）

- [ ] **Step 3: 提交**

```bash
git add client/src/components/views/overview/MilestoneCalendar.tsx
git commit -m "feat: MilestoneCalendar 月历视图"
```

---

## Task 9: OverviewPage 容器（lens 状态 + 顶部切换 + 下钻抽屉 + 阶段分布）

**Files:**
- Create: `client/src/components/views/overview/OverviewPage.tsx`

**说明：** 拉 `trpc.projects.portfolio`，组合 KpiStrip / RagHealthPanel / 阶段分布 / PortfolioTable（共识区）+ 顶部 lens 切换 + PerspectivePanel（个性区）+ MilestoneCalendar。lens 默认按 `user.role`（admin→exec，否则 mine；PM 判定：用户是任一项目的 pmUserId 则默认 pm，否则 mine）。逾期/阻塞下钻用就地展开的 `TaskListView`。

- [ ] **Step 1: 创建 OverviewPage**

`client/src/components/views/overview/OverviewPage.tsx`:
```tsx
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { PHASE_MAP, getProjectPhases, type Project } from "@/lib/data";
import { Suspense, lazy } from "react";
import { Loader2, X } from "lucide-react";
import { KpiStrip } from "./KpiStrip";
import { RagHealthPanel } from "./RagHealthPanel";
import { PortfolioTable, type PortfolioTableRow } from "./PortfolioTable";
import { PerspectivePanel, type Lens } from "./PerspectivePanel";
import { MilestoneCalendar } from "./MilestoneCalendar";
import { TaskListView, type TaskRow } from "../TaskListView";
import type { TaskStatus, TaskPriority } from "@shared/const";

const PhaseDistributionChart = lazy(() =>
  import("../PhaseDistributionChart").then((m) => ({ default: m.PhaseDistributionChart }))
);

const PHASE_CODE_COLORS: Record<string, string> = {
  P1: "#78716c", P2: "#a16207", P3: "#0369a1", P4: "#7c3aed", P5: "#0f766e", P6: "#b45309", P7: "#166534",
};
const LENS_LABEL: Record<Lens, string> = { exec: "管理层", pm: "PM", mine: "我的" };

type DrillTask = {
  id: number; projectId: string; phaseId: string; taskId: string;
  projectName: string; projectNumber: string; projectCategory: string;
  status: string; priority: string | null; dueDate: string | null;
  assigneeUserId: number | null; completed: boolean;
};

export function OverviewPage({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const { user } = useAuth();
  const { data: rows = [], isLoading } = trpc.projects.portfolio.useQuery();
  const portfolio = rows as PortfolioTableRow[];

  const defaultLens: Lens = useMemo(() => {
    if ((user as { role?: string } | null)?.role === "admin") return "exec";
    if (portfolio.some((r) => r.pmUserId === user?.id)) return "pm";
    return "mine";
  }, [user, portfolio]);
  const [lens, setLens] = useState<Lens | null>(null);
  const activeLens = lens ?? defaultLens;

  const [drill, setDrill] = useState<"overdue" | "blocked" | null>(null);

  // 阶段分布：按 currentPhase 计数，借 PHASE_MAP 取 code/color/name
  const phaseDistribution = useMemo(() => {
    const m = new Map<string, { count: number; name: string; color: string }>();
    for (const r of portfolio) {
      const ph = PHASE_MAP[r.currentPhase];
      const code = ph?.code ?? r.currentPhase;
      const cur = m.get(code) ?? { count: 0, name: ph?.name ?? r.currentPhase, color: PHASE_CODE_COLORS[code] ?? "#78716c" };
      cur.count++; m.set(code, cur);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))
      .map(([code, v]) => ({ name: code, fullName: v.name, count: v.count, color: v.color, label: code }));
  }, [portfolio]);

  if (isLoading) {
    return <div className="flex items-center gap-2 text-stone-400 py-12 justify-center"><Loader2 size={16} className="animate-spin" />加载总览…</div>;
  }

  return (
    <div className="ce-page">
      {/* 标题行 + 顶部视角切换 */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-xl text-stone-900">总览</h1>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-stone-400">以</span>
          <select value={activeLens} onChange={(e) => setLens(e.target.value as Lens)}
            className="ce-control border border-stone-300 bg-white px-2 py-1.5 text-sm">
            {(["exec", "pm", "mine"] as Lens[]).map((l) => <option key={l} value={l}>{LENS_LABEL[l]}视角</option>)}
          </select>
          <span className="text-[11px] font-mono text-stone-400">查看</span>
        </div>
      </div>

      {/* 全局共识区 */}
      <KpiStrip rows={portfolio} onDrill={setDrill} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RagHealthPanel rows={portfolio} onSelectProject={onSelectProject} />
        <div className="ce-panel p-5">
          <h3 className="font-serif text-lg text-stone-900 mb-4">阶段分布</h3>
          <Suspense fallback={<div className="h-[220px]" />}>
            <PhaseDistributionChart data={phaseDistribution} />
          </Suspense>
        </div>
      </div>
      <PortfolioTable rows={portfolio} onSelectProject={onSelectProject} />

      {/* 千人千面区 */}
      <div className="pt-2">
        <PerspectivePanel lens={activeLens} rows={portfolio} onSelectProject={onSelectProject} />
      </div>

      {/* 里程碑日历 */}
      <MilestoneCalendar onSelectProject={onSelectProject} />

      {/* 逾期/阻塞下钻抽屉 */}
      {drill && <DrillDown kind={drill} onClose={() => setDrill(null)} onSelectProject={onSelectProject} />}
    </div>
  );
}

function DrillDown({ kind, onClose, onSelectProject }: { kind: "overdue" | "blocked"; onClose: () => void; onSelectProject: (id: string) => void }) {
  const overdueQ = trpc.tasks.overdue.useQuery(undefined, { enabled: kind === "overdue" });
  const blockedQ = trpc.tasks.blocked.useQuery(undefined, { enabled: kind === "blocked" });
  const q = kind === "overdue" ? overdueQ : blockedQ;
  const tasks = (q.data ?? []) as DrillTask[];
  const rows: TaskRow[] = tasks.map((t) => ({
    id: t.id, projectId: t.projectId, phaseId: t.phaseId, taskId: t.taskId,
    projectName: t.projectName, projectNumber: t.projectNumber, projectCategory: t.projectCategory,
    status: t.status as TaskStatus, priority: t.priority as TaskPriority,
    dueDate: t.dueDate ? String(t.dueDate) : null, assigneeUserId: t.assigneeUserId ?? null, completed: t.completed,
  }));
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-stone-900/40" onClick={onClose}>
      <div className="w-full max-w-xl h-full bg-white shadow-xl overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-lg text-stone-900">{kind === "overdue" ? "逾期任务" : "阻塞任务"}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
        </div>
        <div className="ce-table-shell">
          <TaskListView tasks={rows} isLoading={q.isLoading}
            emptyIcon={null} emptyTitle={kind === "overdue" ? "无逾期任务" : "无阻塞任务"} emptyDesc=""
            onRefetch={() => q.refetch()} onNavigateToProject={(id) => { onSelectProject(id); onClose(); }} showOverdueBadge />
        </div>
      </div>
    </div>
  );
}
```

> 确认 `TaskListView` 的 `emptyIcon` 接受 `null`（ReportsView/MyTasks 传的是 ReactNode；若 prop 必填 ReactNode 不可 null，则传 `<span />`）。`Project` 在 import 中若未使用可删除——以 tsc 报错为准清理未用 import。

- [ ] **Step 2: tsc 校验**

Run: `npm run check`
Expected: 无 error（清理任何未用 import，如 `getProjectPhases`/`Project` 若未用则删除该 import 行）

- [ ] **Step 3: 提交**

```bash
git add client/src/components/views/overview/OverviewPage.tsx
git commit -m "feat: OverviewPage 容器（共识区+千人千面+日历+下钻）"
```

---

## Task 10: Home.tsx 导航收敛 + 接入 OverviewPage

**Files:**
- Modify: `client/src/pages/Home.tsx`

- [ ] **Step 1: 改 View 类型、lazy 引入、navItems、路由**

在 `client/src/pages/Home.tsx`：

1) `View` 类型改为：
```ts
type View = 'overview' | 'projects' | 'products' | 'requirements' | 'sop';
```

2) 删除 `DashboardView / PortfolioBoard / ReportsView / MyTasksView / OverdueTasksView / BlockedTasksView` 的 `lazy(...)` 定义，新增：
```ts
const OverviewPage = lazy(() =>
  import('@/components/views/overview/OverviewPage').then((module) => ({ default: module.OverviewPage }))
);
```

3) `useState<View>('dashboard')` → `useState<View>('overview')`。

4) 删除 `taskBadges` 相关三个 query（`myTasks`/`overdue`/`blocked` 的 useQuery）与 `taskBadges` 对象（这些仅用于侧边栏徽标）。

5) `navItems` 改为：
```ts
  const navItems = [
    { id: 'overview' as View, label: '总览', labelEn: 'Overview', icon: LayoutDashboard },
    { id: 'projects' as View, label: '项目管理', labelEn: 'Projects', icon: FolderKanban },
    { id: 'products' as View, label: '产品库', labelEn: 'Products', icon: Package },
    { id: 'requirements' as View, label: '需求池', labelEn: 'Requirements', icon: Inbox },
    { id: 'sop' as View, label: 'SOP 流程库', labelEn: 'SOP Library', icon: BookOpen },
  ];
```

6) 侧边栏渲染里删除 `const badge = taskBadges[id] ?? 0;` 及 badge 渲染块（改动后 `taskBadges` 不存在）。

7) `viewLabels` 改为：
```ts
  const viewLabels: Record<View, string> = {
    overview: 'Overview',
    projects: 'Projects',
    products: 'Products',
    requirements: 'Requirements',
    sop: 'SOP Library',
  };
```

8) 主内容区路由：删除 `view === 'dashboard' | 'portfolio' | 'reports' | 'my-tasks' | 'overdue' | 'blocked'` 六个分支，替换为：
```tsx
              {view === 'overview' && (
                <OverviewPage onSelectProject={handleSelectProject} />
              )}
```
保留 `projects / products / requirements / sop` 分支不变。

9) 清理：移除因上述删除而未使用的 lucide import（如 `LayoutGrid, BarChart3, ListTodo, AlertTriangle, ShieldAlert`）——以 tsc 报错为准。

- [ ] **Step 2: tsc 校验**

Run: `npm run check`
Expected: 无 error。逐一清理未使用 import 直至通过。

- [ ] **Step 3: 提交**

```bash
git add client/src/pages/Home.tsx
git commit -m "feat: 导航收敛为总览，接入 OverviewPage"
```

---

## Task 11: 删除旧视图文件 + 全量校验

**Files:**
- Delete: 旧视图文件（确认无引用后）

- [ ] **Step 1: 检查引用**

```bash
cd ~/Desktop/ce-project-hub
grep -rn "DashboardView\|PortfolioBoard\|ReportsView\|MyTasksView\|OverdueTasksView\|BlockedTasksView" client/src --include=*.tsx --include=*.ts | grep -v "components/views/overview/"
```
Expected: 无输出（除将被删的文件自身定义行）。若某文件仍被 `GlobalSearch` 等引用，则**保留**该文件，仅删无引用者。

- [ ] **Step 2: 删除无引用的旧文件**

```bash
git rm client/src/components/views/DashboardView.tsx \
       client/src/components/views/PortfolioBoard.tsx \
       client/src/components/views/ReportsView.tsx \
       client/src/components/views/MyTasksView.tsx \
       client/src/components/views/OverdueTasksView.tsx \
       client/src/components/views/BlockedTasksView.tsx
```
> 若 Step 1 显示某文件仍有引用，从上面命令移除该文件路径。

- [ ] **Step 3: tsc + 全量 server 测试**

Run: `npm run check`
Expected: 无 error

Run: `node scripts/test.mjs`
Expected: 全绿（新增 health/calendar 通过；既有测试无回归。注：若仓库本就有先前失败的测试，确认与本次无关）

- [ ] **Step 4: 浏览器抽查（preview）**

启动 dev，登录后验证总览页：
- 共识区进度/问题为**真实非零**值（验证已脱离坏掉的 `projects.list`）。
- 顶部视角切换 exec/pm/mine 即时生效。
- 点击逾期/阻塞 KPI 弹出下钻清单。
- RAG 红黄项目点击下钻；日历可切月、事件点击下钻。
- 控制台无报错。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore: 删除被总览取代的旧视图文件"
```

---

## Self-Review 记录

- **Spec 覆盖：** 合并三视图(Task 4/7/10) ✓；上下分层+顶部切换(Task 9) ✓；弃用 projects.list 改用 portfolio(Task 9) ✓；RAG(Task 1/6) ✓；里程碑日历(Task 2/3/8) ✓；我的任务并入(Task 7) ✓；逾期/阻塞 KPI 下钻(Task 5/9) ✓；导航移除三任务入口(Task 10) ✓。
- **开放项落定：** ①getPortfolio 增 criticalIssues 驱动 RAG 红灯(Task 2) ✓；②旧任务视图文件删除带引用检查(Task 11) ✓；③日历默认本月+月切换(Task 8) ✓。
- **类型一致：** `PortfolioTableRow`（含 criticalIssues）贯穿 Task 4–9；`Lens` 定义于 Task 7、消费于 Task 9；`computeRag/RagInput` Task 1 定义、Task 6 消费；`CalendarEvent` Task 2 定义、Task 8 经 tRPC 消费。
- **占位符扫描：** 无 TBD/TODO；条件性删除(Task 11)已给明确判定命令与处理规则。
