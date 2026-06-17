# PM 项目层工作台（千人千面 P0 三卡）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `OverviewPage` 的 `pm` 视角重构成一个真正的 PM 工作台，落地千人千面规格中 PM 的 P0 三张卡：TODAY（今天要做）、待我协调/拍板项、我负责的项目（带阶段标签）。

**Architecture:** 纯前端方案。卡片的取数/排序逻辑抽到框架无关的纯函数模块 `shared/pm-workbench.ts`（结构化输入类型、输出普通数据、不含 React/图标），由 vitest 单测覆盖。`PerspectivePanel` 的 `PmCockpit` 重构为三卡布局并调用这些纯函数，复用已在组件内调用的 `trpc.workbench.mine` 与父级传入的 `projects.portfolio` 数据。`OverviewPage` 在 `pm` 视角下隐藏组合层大盘。零服务端 / 零 schema 改动。

**Tech Stack:** TypeScript、React、tRPC、vitest。测试运行器：vitest（config 已 include `shared/**/*.test.ts`）。

> 注：spec 中纯函数模块原写在 `client/src/components/views/overview/pmWorkbench.ts`；因 `vitest.config.ts` 的 `include` 只覆盖 `server/**` 与 `shared/**`（client 测试不会被执行），且本仓库既有把纯逻辑放 `shared/` 并测试的惯例（`health.ts` / `gate-readiness.ts` / `effective-process.ts`），故落到 `shared/pm-workbench.ts`。这是与现有约定一致的位置调整，行为不变。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `shared/pm-workbench.ts`（新增） | 纯函数：`selectMyProjects` / `buildTodayItems` / `buildCoordinationQueue` / `projectHeadlineMetric` 及输入/输出类型。无 React 依赖。 |
| `shared/pm-workbench.test.ts`（新增） | 上述纯函数单测。 |
| `client/src/components/views/overview/PerspectivePanel.tsx`（改） | `PmCockpit` 重构为三卡；新增 kind→图标映射；调用 `@shared/pm-workbench`。 |
| `client/src/components/views/overview/OverviewPage.tsx`（改） | `pm` 视角隐藏 `PortfolioDashboard` 与"需要处理"标题，标题改"我的项目工作台"。 |

测试命令（纯单测，免 docker）：`./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
类型检查：`npm run check`
全量测试（含 DB，CI 口径）：`node scripts/test.mjs`

---

## Task 1: 纯函数模块骨架与类型 + `selectMyProjects`

**Files:**
- Create: `shared/pm-workbench.ts`
- Test: `shared/pm-workbench.test.ts`

- [ ] **Step 1: Write the failing test**

Create `shared/pm-workbench.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectMyProjects, type PmProjectRow } from "./pm-workbench";

function row(over: Partial<PmProjectRow>): PmProjectRow {
  return {
    id: "p1", name: "项目A", currentPhase: "design", ragLevel: "green",
    pmUserId: 1, gateDone: false, gateName: null, gateDueDate: null,
    projectedEnd: null, targetDate: null, overdueTasks: 0, blockedTasks: 0,
    criticalIssues: 0, openIssues: 0, unassignedTasks: 0, deliverableGap: 0,
    gateBlockers: 0, ...over,
  };
}

describe("selectMyProjects", () => {
  it("只保留 pmUserId 等于当前用户的项目", () => {
    const rows = [row({ id: "a", pmUserId: 1 }), row({ id: "b", pmUserId: 2 }), row({ id: "c", pmUserId: 1 })];
    expect(selectMyProjects(rows, 1).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("userId 为 undefined 时返回空数组", () => {
    expect(selectMyProjects([row({ pmUserId: 1 })], undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
Expected: FAIL — 找不到模块 `./pm-workbench` 或导出 `selectMyProjects`。

- [ ] **Step 3: Write minimal implementation**

Create `shared/pm-workbench.ts`:

```ts
import { isProjectedOverdue, type RagLevel } from "./health";

export type Tone = "rose" | "amber" | "emerald" | "stone";

/** 组合层 portfolio 行中 PM 工作台用到的字段子集（PortfolioTableRow 结构兼容）。 */
export interface PmProjectRow {
  id: string;
  name: string;
  currentPhase: string;
  ragLevel: RagLevel;
  pmUserId: number | null;
  gateDone: boolean;
  gateName: string | null;
  gateDueDate: string | null;
  projectedEnd: string | null;
  targetDate: string | null;
  overdueTasks: number;
  blockedTasks: number;
  criticalIssues: number;
  openIssues: number;
  unassignedTasks: number;
  deliverableGap: number;
  gateBlockers: number;
}

/** workbench.mine 任务行子集（MyTaskApiRow 结构兼容）。 */
export interface PmTask {
  id: number;
  projectId: string;
  taskId: string;
  projectName: string;
  dueDate: string | null;
  priority: string | null;
  status: string;
}

/** workbench.mine 待审交付物行子集（WorkbenchReview 结构兼容）。 */
export interface PmReview {
  id: number;
  projectId: string;
  deliverableName: string;
  projectName: string;
}

export function selectMyProjects(rows: PmProjectRow[], userId: number | null | undefined): PmProjectRow[] {
  if (userId == null) return [];
  return rows.filter((r) => r.pmUserId === userId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
Expected: PASS（2 个用例通过）。

- [ ] **Step 5: Commit**

```bash
git add shared/pm-workbench.ts shared/pm-workbench.test.ts
git commit -m "feat(pm-workbench): 纯函数模块骨架 + selectMyProjects"
```

---

## Task 2: `buildTodayItems`（TODAY 卡）

**Files:**
- Modify: `shared/pm-workbench.ts`
- Test: `shared/pm-workbench.test.ts`

TODAY 合并三类来源，按 `priority` 降序、同级按日期升序：个人到期任务（逾期 > 今日到期）、本周 Gate（今天起 7 天内）、风险项目（red 或预计晚于目标）。

- [ ] **Step 1: Write the failing test**

在 `shared/pm-workbench.test.ts` 末尾追加（保留文件顶部已有的 import 与 `row` 工厂；新增 import 见下）：

```ts
import { buildTodayItems, type PmTask } from "./pm-workbench";

function task(over: Partial<PmTask>): PmTask {
  return { id: 1, projectId: "p1", taskId: "原理图修改", projectName: "项目A", dueDate: null, priority: "medium", status: "todo", ...over };
}

describe("buildTodayItems", () => {
  const today = "2026-06-18";

  it("纳入逾期与今日到期的个人任务，排除未来任务", () => {
    const tasks = [
      task({ id: 1, dueDate: "2026-06-10" }), // 逾期
      task({ id: 2, dueDate: "2026-06-18" }), // 今日
      task({ id: 3, dueDate: "2026-06-25" }), // 未来，排除
    ];
    const items = buildTodayItems(tasks, [], today);
    expect(items.map((i) => i.key)).toEqual(["task-1", "task-2"]);
  });

  it("逾期任务排在今日到期之前", () => {
    const tasks = [task({ id: 2, dueDate: "2026-06-18" }), task({ id: 1, dueDate: "2026-06-10" })];
    const items = buildTodayItems(tasks, [], today);
    expect(items[0].key).toBe("task-1");
  });

  it("纳入今天起 7 天内未完成的 Gate，排除已完成或超窗的", () => {
    const rows = [
      row({ id: "a", gateName: "EVT Gate", gateDueDate: "2026-06-20", gateDone: false }),
      row({ id: "b", gateName: "DVT Gate", gateDueDate: "2026-06-20", gateDone: true }), // 已完成，排除
      row({ id: "c", gateName: "PVT Gate", gateDueDate: "2026-06-30", gateDone: false }), // 超 7 天，排除
    ];
    const items = buildTodayItems([], rows, today);
    expect(items.map((i) => i.key)).toEqual(["gate-a"]);
  });

  it("纳入 red 或预计晚于目标的风险项目", () => {
    const rows = [
      row({ id: "a", ragLevel: "red" }),
      row({ id: "b", projectedEnd: "2026-09-01", targetDate: "2026-08-01" }), // 预计晚于目标
      row({ id: "c", ragLevel: "green", projectedEnd: "2026-07-01", targetDate: "2026-08-01" }), // 健康，排除
    ];
    const items = buildTodayItems([], rows, today);
    expect(items.map((i) => i.key).sort()).toEqual(["risk-a", "risk-b"]);
  });

  it("空输入返回空数组", () => {
    expect(buildTodayItems([], [], today)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
Expected: FAIL — 找不到导出 `buildTodayItems`。

- [ ] **Step 3: Write minimal implementation**

在 `shared/pm-workbench.ts` 追加：

```ts
export type TodayKind = "task" | "gate" | "risk";
export interface TodayItem {
  key: string;
  projectId: string;
  kind: TodayKind;
  title: string;
  detail: string;
  tag: string;
  tone: Tone;
  /** 越大越紧急；用于降序排序。 */
  priority: number;
  /** 同级排序用的日期（升序）；无则置末。 */
  sortDate: string;
}

function priorityScore(priority: string | null): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

/** date 字符串加 n 天，返回 YYYY-MM-DD。 */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function buildTodayItems(tasks: PmTask[], myRows: PmProjectRow[], today: string): TodayItem[] {
  const items: TodayItem[] = [];

  for (const t of tasks) {
    if (!t.dueDate || t.dueDate > today) continue;
    const overdue = t.dueDate < today;
    items.push({
      key: `task-${t.id}`,
      projectId: t.projectId,
      kind: "task",
      title: t.taskId,
      detail: `${t.projectName} · ${overdue ? `逾期 ${t.dueDate}` : "今日到期"}`,
      tag: overdue ? "逾期任务" : "今日任务",
      tone: overdue ? "rose" : "amber",
      priority: (overdue ? 100 : 80) + priorityScore(t.priority),
      sortDate: t.dueDate,
    });
  }

  const weekEnd = addDays(today, 7);
  for (const r of myRows) {
    if (!r.gateDone && r.gateDueDate && r.gateDueDate >= today && r.gateDueDate <= weekEnd) {
      items.push({
        key: `gate-${r.id}`,
        projectId: r.id,
        kind: "gate",
        title: r.gateName ?? "Gate 评审",
        detail: `${r.name} · 截止 ${r.gateDueDate}`,
        tag: "本周 Gate",
        tone: "amber",
        priority: 60,
        sortDate: r.gateDueDate,
      });
    }
  }

  for (const r of myRows) {
    if (r.ragLevel === "red" || isProjectedOverdue(r.projectedEnd, r.targetDate)) {
      items.push({
        key: `risk-${r.id}`,
        projectId: r.id,
        kind: "risk",
        title: r.name,
        detail: r.ragLevel === "red" ? "健康度红灯，需处理" : `预计完成 ${r.projectedEnd ?? "未排期"}，晚于目标`,
        tag: "风险",
        tone: "rose",
        priority: 40,
        sortDate: r.targetDate ?? "9999-99-99",
      });
    }
  }

  return items.sort((a, b) => (b.priority - a.priority) || a.sortDate.localeCompare(b.sortDate));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
Expected: PASS（含 Task 1 共 7 个用例通过）。

- [ ] **Step 5: Commit**

```bash
git add shared/pm-workbench.ts shared/pm-workbench.test.ts
git commit -m "feat(pm-workbench): buildTodayItems（个人任务+本周Gate+风险项目）"
```

---

## Task 3: `buildCoordinationQueue`（待我协调/拍板卡）

**Files:**
- Modify: `shared/pm-workbench.ts`
- Test: `shared/pm-workbench.test.ts`

合并待我审批的交付物 + 我项目里需 PM 决策的卡点（重大问题、未分配、Gate 交付物缺口、Gate 未就绪、阻塞），按 `priority` 降序。

- [ ] **Step 1: Write the failing test**

在 `shared/pm-workbench.test.ts` 末尾追加：

```ts
import { buildCoordinationQueue, type PmReview } from "./pm-workbench";

function review(over: Partial<PmReview>): PmReview {
  return { id: 1, projectId: "p1", deliverableName: "BOM", projectName: "项目A", ...over };
}

describe("buildCoordinationQueue", () => {
  it("待审交付物排在最前", () => {
    const items = buildCoordinationQueue([review({ id: 9 })], [row({ criticalIssues: 3 })]);
    expect(items[0].key).toBe("review-9");
    expect(items[0].kind).toBe("review");
  });

  it("按 重大问题>未分配>交付物缺口>Gate未就绪>阻塞 排序", () => {
    const r = row({ id: "a", criticalIssues: 1, unassignedTasks: 1, deliverableGap: 1, gateBlockers: 1, blockedTasks: 1 });
    const kinds = buildCoordinationQueue([], [r]).map((i) => i.kind);
    expect(kinds).toEqual(["issue", "unassigned", "deliverable", "gateBlocker", "blocked"]);
  });

  it("计数为 0 的卡点不产出条目", () => {
    expect(buildCoordinationQueue([], [row({})])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
Expected: FAIL — 找不到导出 `buildCoordinationQueue`。

- [ ] **Step 3: Write minimal implementation**

在 `shared/pm-workbench.ts` 追加：

```ts
export type CoordKind = "review" | "issue" | "unassigned" | "deliverable" | "gateBlocker" | "blocked";
export interface CoordItem {
  key: string;
  projectId: string;
  kind: CoordKind;
  title: string;
  detail: string;
  tag: string;
  tone: Tone;
  priority: number;
}

export function buildCoordinationQueue(reviews: PmReview[], myRows: PmProjectRow[]): CoordItem[] {
  const items: CoordItem[] = [];

  for (const rv of reviews) {
    items.push({
      key: `review-${rv.id}`,
      projectId: rv.projectId,
      kind: "review",
      title: rv.deliverableName,
      detail: `${rv.projectName} · 交付物待审核`,
      tag: "待我审批",
      tone: "amber",
      priority: 90,
    });
  }

  for (const r of myRows) {
    if (r.criticalIssues > 0) {
      items.push({ key: `issue-${r.id}`, projectId: r.id, kind: "issue", title: "重大问题未关闭",
        detail: `${r.name} · ${r.criticalIssues} 个 P0/P1，协调责任人与关闭路径`, tag: "拍板", tone: "rose", priority: 85 });
    }
    if (r.unassignedTasks > 0) {
      items.push({ key: `unassigned-${r.id}`, projectId: r.id, kind: "unassigned", title: "任务未分配",
        detail: `${r.name} · ${r.unassignedTasks} 个任务未分配到人`, tag: "协调", tone: "rose", priority: 70 });
    }
    if (r.deliverableGap > 0) {
      items.push({ key: `deliverable-${r.id}`, projectId: r.id, kind: "deliverable", title: "Gate 交付物未齐",
        detail: `${r.name} · ${r.gateName ?? "Gate"} 缺 ${r.deliverableGap} 项交付物`, tag: "协调", tone: "amber", priority: 65 });
    }
    if (r.gateBlockers > 0) {
      items.push({ key: `gateBlocker-${r.id}`, projectId: r.id, kind: "gateBlocker", title: "Gate 未就绪",
        detail: `${r.name} · ${r.gateName ?? "Gate"} 还有 ${r.gateBlockers} 项缺口`, tag: "协调", tone: "amber", priority: 60 });
    }
    if (r.blockedTasks > 0) {
      items.push({ key: `blocked-${r.id}`, projectId: r.id, kind: "blocked", title: "项目存在阻塞",
        detail: `${r.name} · ${r.blockedTasks} 个任务被阻塞，需协调跨角色依赖`, tag: "协调", tone: "amber", priority: 55 });
    }
  }

  return items.sort((a, b) => b.priority - a.priority);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
Expected: PASS（含前序共 10 个用例通过）。

- [ ] **Step 5: Commit**

```bash
git add shared/pm-workbench.ts shared/pm-workbench.test.ts
git commit -m "feat(pm-workbench): buildCoordinationQueue（待审交付物+决策卡点）"
```

---

## Task 4: `projectHeadlineMetric`（卡 3 次要指标）

**Files:**
- Modify: `shared/pm-workbench.ts`
- Test: `shared/pm-workbench.test.ts`

为"我负责的项目"列表每行取一个最高优先级的次要指标：P0/P1问题 > 逾期 > 阻塞，否则无。

- [ ] **Step 1: Write the failing test**

在 `shared/pm-workbench.test.ts` 末尾追加：

```ts
import { projectHeadlineMetric } from "./pm-workbench";

describe("projectHeadlineMetric", () => {
  it("有重大问题时优先展示 P0/P1", () => {
    expect(projectHeadlineMetric(row({ criticalIssues: 2, overdueTasks: 5, blockedTasks: 1 })))
      .toEqual({ label: "P0/P1 2", tone: "rose" });
  });
  it("无重大问题但有逾期时展示逾期", () => {
    expect(projectHeadlineMetric(row({ overdueTasks: 3, blockedTasks: 1 })))
      .toEqual({ label: "逾期 3", tone: "rose" });
  });
  it("仅有阻塞时展示阻塞", () => {
    expect(projectHeadlineMetric(row({ blockedTasks: 4 })))
      .toEqual({ label: "阻塞 4", tone: "amber" });
  });
  it("均为 0 时返回 null", () => {
    expect(projectHeadlineMetric(row({}))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
Expected: FAIL — 找不到导出 `projectHeadlineMetric`。

- [ ] **Step 3: Write minimal implementation**

在 `shared/pm-workbench.ts` 追加：

```ts
export interface HeadlineMetric {
  label: string;
  tone: Tone;
}

export function projectHeadlineMetric(row: PmProjectRow): HeadlineMetric | null {
  if (row.criticalIssues > 0) return { label: `P0/P1 ${row.criticalIssues}`, tone: "rose" };
  if (row.overdueTasks > 0) return { label: `逾期 ${row.overdueTasks}`, tone: "rose" };
  if (row.blockedTasks > 0) return { label: `阻塞 ${row.blockedTasks}`, tone: "amber" };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
Expected: PASS（含前序共 14 个用例通过）。

- [ ] **Step 5: Commit**

```bash
git add shared/pm-workbench.ts shared/pm-workbench.test.ts
git commit -m "feat(pm-workbench): projectHeadlineMetric（卡3次要指标）"
```

---

## Task 5: `PerspectivePanel` 重构 `PmCockpit` 为三卡

**Files:**
- Modify: `client/src/components/views/overview/PerspectivePanel.tsx`

复用现有 `Panel` / `Tag` / `HealthDot` 与 `@/lib/data` 的 `PHASE_MAP`。纯函数从 `@shared/pm-workbench` 引入。本任务无单测（纯展示），用 `npm run check` 验证类型，UI 在 Task 6 后统一用 preview 验证。

- [ ] **Step 1: 增加 import**

在 `PerspectivePanel.tsx` 顶部 import 区追加（与现有 import 风格一致）：

```ts
import { PHASE_MAP } from "@/lib/data";
import {
  selectMyProjects, buildTodayItems, buildCoordinationQueue, projectHeadlineMetric,
  type TodayItem, type CoordItem,
} from "@shared/pm-workbench";
```

> `PHASE_MAP` 若文件中已 import，则不要重复（第 5 行已有 `import { PHASE_MAP } from "@/lib/data";`——确认后跳过此行）。

- [ ] **Step 2: 改 pm 分支传参**

把现有：

```tsx
  if (lens === "pm") {
    return <PmCockpit rows={myProjects} onSelectProject={onSelectProject} />;
  }
```

替换为：

```tsx
  if (lens === "pm") {
    return (
      <PmCockpit
        myRows={myProjects}
        tasks={workbench?.tasks ?? []}
        reviews={workbench?.reviews ?? []}
        onSelectProject={onSelectProject}
      />
    );
  }
```

- [ ] **Step 3: 用三卡实现替换整个 `PmCockpit` 与 `buildPmActions`**

删除现有 `PmCockpit` 函数（约 139-184 行）和 `buildPmActions` 函数（约 186-233 行）以及不再使用的 `SuggestedAction`/`ActionTone` 类型（约 18-26 行），替换为：

```tsx
const TODAY_ICON: Record<TodayItem["kind"], React.ReactNode> = {
  task: <ListChecks size={14} />,
  gate: <Flag size={14} />,
  risk: <AlertTriangle size={14} />,
};
const COORD_ICON: Record<CoordItem["kind"], React.ReactNode> = {
  review: <FileCheck size={14} />,
  issue: <Bug size={14} />,
  unassigned: <UserMinus size={14} />,
  deliverable: <ClipboardCheck size={14} />,
  gateBlocker: <Flag size={14} />,
  blocked: <Ban size={14} />,
};

function PmCockpit({ myRows, tasks, reviews, onSelectProject }: {
  myRows: PortfolioTableRow[];
  tasks: MyTaskApiRow[];
  reviews: WorkbenchReview[];
  onSelectProject: (id: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const todayItems = useMemo(() => buildTodayItems(tasks, myRows, today), [tasks, myRows, today]);
  const coordItems = useMemo(() => buildCoordinationQueue(reviews, myRows), [reviews, myRows]);
  const projects = useMemo(() => myRows, [myRows]);

  if (myRows.length === 0) {
    return (
      <Panel title="我的项目工作台" icon={<ListChecks size={15} />}>
        <div className="text-sm text-stone-400">你当前不是任何项目的 PM。</div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel title="TODAY · 今天要做" icon={<CalendarClock size={15} />}>
        {todayItems.length === 0 ? (
          <div className="text-sm text-stone-400">今天没有紧急事项。</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {todayItems.slice(0, 10).map((item) => (
              <ActionRow key={item.key} icon={TODAY_ICON[item.kind]} title={item.title} detail={item.detail}
                tag={item.tag} tone={item.tone} onClick={() => onSelectProject(item.projectId)} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="待我协调 / 拍板" icon={<Inbox size={15} />}>
          {coordItems.length === 0 ? (
            <div className="text-sm text-stone-400">暂无待你协调或拍板的事项。</div>
          ) : (
            <div className="divide-y divide-stone-100">
              {coordItems.slice(0, 10).map((item) => (
                <ActionRow key={item.key} icon={COORD_ICON[item.kind]} title={item.title} detail={item.detail}
                  tag={item.tag} tone={item.tone} onClick={() => onSelectProject(item.projectId)} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="我负责的项目" icon={<ListChecks size={15} />}>
          <div className="divide-y divide-stone-100">
            {projects.map((r) => {
              const metric = projectHeadlineMetric(r);
              return (
                <button key={r.id} onClick={() => onSelectProject(r.id)}
                  className="w-full text-left py-2.5 hover:bg-stone-50/70 -mx-2 px-2 transition-colors">
                  <div className="flex items-center gap-3">
                    <HealthDot row={r} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-stone-800 truncate">{r.name}</div>
                      <div className="text-[10px] font-mono text-stone-400 truncate">
                        {PHASE_MAP[r.currentPhase]?.name ?? r.currentPhase}
                      </div>
                    </div>
                    {metric && <Tag tone={metric.tone}>{metric.label}</Tag>}
                    <ChevronRight size={13} className="text-stone-300 shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ActionRow({ icon, title, detail, tag, tone, onClick }: {
  icon: React.ReactNode; title: string; detail: string; tag: string;
  tone: "rose" | "amber" | "emerald" | "stone"; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="w-full text-left py-2.5 hover:bg-stone-50/70 -mx-2 px-2 transition-colors">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 ${tone === "rose" ? "text-rose-500" : tone === "amber" ? "text-amber-500" : "text-stone-400"}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-stone-800 truncate">{title}</span>
            <Tag tone={tone}>{tag}</Tag>
          </div>
          <div className="text-[11px] text-stone-500 mt-0.5 truncate">{detail}</div>
        </div>
        <ChevronRight size={13} className="mt-1 text-stone-300 shrink-0" />
      </div>
    </button>
  );
}
```

> 说明：`MyTaskApiRow` 与 `WorkbenchReview` 类型已在本文件定义（约 235-249 行），结构兼容 `@shared/pm-workbench` 的 `PmTask` / `PmReview`，直接作为入参传入纯函数即可。`PortfolioTableRow` 结构兼容 `PmProjectRow`。删除 `buildPmActions` 后，确认其用到的图标 import（`CalendarClock`、`Flag`、`UserMinus`、`Users`、`Ban` 等）仍被新代码使用；`Users` 若不再被引用则从 import 中移除以免 `npm run check`（noUnusedLocals 视配置）或 lint 报错。

- [ ] **Step 4: 类型检查**

Run: `npm run check`
Expected: 通过，无类型错误。若报 `Users`/`Rocket` 等未使用，按提示从 lucide-react import 中删除未再使用的图标名。

- [ ] **Step 5: Commit**

```bash
git add client/src/components/views/overview/PerspectivePanel.tsx
git commit -m "feat(pm-workbench): PmCockpit 重构为 TODAY/待协调拍板/我负责的项目 三卡"
```

---

## Task 6: `OverviewPage` 在 pm 视角隐藏大盘、改标题

**Files:**
- Modify: `client/src/components/views/overview/OverviewPage.tsx`

`pm` 与 `mine` 一样按"工作台"渲染（不出大盘、不出"需要处理"标题）；`exec` 不变。

- [ ] **Step 1: 引入 isWorkbench 并改标题/范围**

把现有（约 44-49 行）：

```tsx
  const scopeLabel = activeLens === "pm" ? "我负责的项目" : activeLens === "exec" ? "全部项目组合" : "可见项目组合";
  const isPersonalLens = activeLens === "mine";
  const pageTitle = isPersonalLens ? "我的工作台" : "项目总览";
  const pageDesc = isPersonalLens
    ? "只聚合与你有关的待办、审核、质量复测和在手任务。"
    : "按项目维度查看健康、阶段、Gate、交付物、发布与延期风险。";
```

替换为：

```tsx
  const scopeLabel = activeLens === "exec" ? "全部项目组合" : "可见项目组合";
  // pm/mine 都按「工作台」渲染（行动导向，不出组合层大盘）；仅 exec 出大盘。
  const isWorkbench = activeLens === "mine" || activeLens === "pm";
  const pageTitle = activeLens === "mine" ? "我的工作台" : activeLens === "pm" ? "我的项目工作台" : "项目总览";
  const pageDesc =
    activeLens === "mine" ? "只聚合与你有关的待办、审核、质量复测和在手任务。" :
    activeLens === "pm" ? "聚焦我负责的项目：今天要推动什么、待我协调拍板、各项目阶段与健康。" :
    "按项目维度查看健康、阶段、Gate、交付物、发布与延期风险。";
```

- [ ] **Step 2: 用 isWorkbench 收口大盘与标题渲染**

把现有（约 74-83 行）两处 `!isPersonalLens` 改为 `!isWorkbench`：

```tsx
      {!isWorkbench && (
        <PortfolioDashboard rows={dashboardRows} scopeLabel={scopeLabel} onSelectProject={onSelectProject} onDrill={setDrill} />
      )}

      {!isWorkbench && (
        <div className="flex items-center justify-between pt-2">
          <h2 className="text-[11px] font-mono uppercase tracking-widest text-stone-400">需要处理</h2>
          <span className="text-[11px] text-stone-400">{LENS_LABEL[activeLens]}视角</span>
        </div>
      )}
```

> `dashboardRows`（约 41-43 行）现仅 exec 用到（pm 不再渲染大盘），保留其定义不变即可——逻辑无害；如 `npm run check` 报 `dashboardRows` 未使用再删。实际仍被 exec 分支引用，不会未使用。

- [ ] **Step 3: 类型检查**

Run: `npm run check`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add client/src/components/views/overview/OverviewPage.tsx
git commit -m "feat(pm-workbench): pm 视角按工作台渲染（隐藏大盘、标题改我的项目工作台）"
```

---

## Task 7: 端到端验证（preview）

**Files:** 无改动，仅验证。

- [ ] **Step 1: 起 dev server 并打开总览**

用 preview 工具：`preview_start`（项目 dev：`npm run dev`），登录后进入总览页。

- [ ] **Step 2: 切到 PM 视角，核对三卡**

以一个「是某项目 PM」的账号，视角下拉选「PM视角」。预期：
- 页标题为「我的项目工作台」，**无** `PortfolioDashboard` 大盘、无「需要处理」小标题。
- 出现三块：`TODAY · 今天要做`、`待我协调 / 拍板`、`我负责的项目`（后两者并排）。
- 「我负责的项目」每行有阶段名 + 健康度圆点；有问题/逾期/阻塞的项目右侧出指标标签。
- 点任一行能下钻到对应项目详情。

用 `preview_snapshot` 确认结构，`preview_console_logs` 确认无报错，`preview_screenshot` 留证。

- [ ] **Step 3: 回归 exec / mine 视角**

切「管理层视角」：大盘与「需要处理」面板照常显示。切「我的视角」：仍是「我的工作台」原行为。确认未受影响。

- [ ] **Step 4: 全量测试与类型检查**

Run: `npm run check`
Expected: 通过。

Run: `./node_modules/.bin/vitest run shared/pm-workbench.test.ts`
Expected: PASS（14 用例）。

- [ ] **Step 5: 收尾**

无新增改动则无需提交；如验证中有微调，按所改文件分别 `git add` 后提交（仅 stage 本功能涉及文件）。

---

## Self-Review

**Spec coverage:**
- 卡 1 TODAY（个人任务+本周Gate+风险）→ Task 2 + Task 5 ✅
- 卡 2 待我协调/拍板（待审交付物+决策卡点）→ Task 3 + Task 5 ✅
- 卡 3 我负责的项目（阶段标签+健康度+次要指标）→ Task 4 + Task 5 ✅
- PM 视角去大盘、改标题 → Task 6 ✅
- 纯函数 + 单测 → Task 1-4 ✅
- exec/mine 不受影响 → Task 6 收口 + Task 7 回归 ✅
- 零服务端/零 schema 改动 → 全程未触 server/drizzle ✅

**Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整代码与命令。

**Type consistency:** `PmProjectRow`/`PmTask`/`PmReview`/`TodayItem`/`CoordItem`/`HeadlineMetric`/`Tone` 在 Task 1-4 定义，Task 5 import 使用，命名一致；`CoordKind` 值（review/issue/unassigned/deliverable/gateBlocker/blocked）与 Task 5 的 `COORD_ICON` 键一一对应；`TodayKind`（task/gate/risk）与 `TODAY_ICON` 键一一对应。客户端 `MyTaskApiRow`/`WorkbenchReview`/`PortfolioTableRow` 结构兼容纯函数入参类型。
