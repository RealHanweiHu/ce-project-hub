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
        sortDate: r.targetDate ?? "9999-12-31",
      });
    }
  }

  return items.sort((a, b) => (b.priority - a.priority) || a.sortDate.localeCompare(b.sortDate));
}

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
