import { daysBetween } from "./health";

export const DI_WEIGHTS = { P0: 10, P1: 3, P2: 1, P3: 0.1 } as const;

export type MetricsWindow = { fromISO: string; toISO: string };

export type MetricTask = {
  phaseId?: string | null;
  createdAt: string;
  completedAt: string | null;
  dueDate: string | null;
  status: string;
};

export type MetricIssue = {
  foundDate: string | null;
  closedDate: string | null;
  severity: keyof typeof DI_WEIGHTS;
  status: string;
  category: string;
};

export type MetricGate = {
  phaseId?: string | null;
  decision: string;
  roundNumber: number;
};

export type MetricPhase = {
  phaseId: string;
  startDate: string | null;
  endDate: string | null;
};

export type ProjectMetrics = {
  efficiency: {
    leadTimeDaysMedian: number | null;
    leadTimeDaysP85: number | null;
    throughputByWeek: { weekKey: string; count: number }[];
    overdueRatePct: number | null;
    overdueCount: number;
    dueDatedCount: number;
    completedCount: number;
    plannedCount: number;
  };
  quality: {
    diValue: number;
    openClose: { weekKey: string; opened: number; closed: number; cumulativeOpen: number }[];
    bySeverity: { severity: string; count: number }[];
    byCategory: { category: string; count: number }[];
  };
  burndown: {
    task: { dateISO: string; remaining: number; ideal: number | null }[];
    defect: { dateISO: string; remaining: number }[];
  };
  process: {
    gateFirstPassRatePct: number | null;
    phaseDurations: { phaseId: string; plannedDays: number | null; actualDays: number | null }[];
  };
};

const OPEN_ISSUE_STATUSES = new Set(["open", "in_progress"]);
const CLOSED_TASK_STATUSES = new Set(["done", "skipped"]);
const SEVERITY_ORDER = ["P0", "P1", "P2", "P3"] as const;

export function computeProjectMetrics(input: {
  tasks: MetricTask[];
  issues: MetricIssue[];
  gates: MetricGate[];
  phases: MetricPhase[];
  window: MetricsWindow;
  totalTaskCount: number;
}): ProjectMetrics {
  const fromISO = toISODate(input.window.fromISO);
  const toISO = toISODate(input.window.toISO);
  const window = fromISO && toISO && fromISO <= toISO ? { fromISO, toISO } : null;
  const totalTaskCount = Number.isFinite(input.totalTaskCount)
    ? input.totalTaskCount
    : input.tasks.length;

  const normalizedTasks = input.tasks.map((task) => ({
    ...task,
    createdAt: toISODate(task.createdAt),
    completedAt: toISODate(task.completedAt),
    dueDate: toISODate(task.dueDate),
  }));
  const normalizedIssues = input.issues.map((issue) => ({
    ...issue,
    foundDate: toISODate(issue.foundDate),
    closedDate: toISODate(issue.closedDate),
  }));
  const normalizedPhases = input.phases.map((phase) => ({
    ...phase,
    startDate: toISODate(phase.startDate),
    endDate: toISODate(phase.endDate),
  }));

  const completedInWindow = window
    ? normalizedTasks.filter((task) => task.completedAt && task.completedAt >= window.fromISO && task.completedAt <= window.toISO)
    : [];
  const leadTimes = completedInWindow
    .map((task) => daysBetween(task.createdAt, task.completedAt))
    .filter((value): value is number => value !== null && value >= 0)
    .sort((a, b) => a - b);

  const dueDatedTasks = normalizedTasks.filter((task) => task.dueDate);
  const lateCompletedInWindow = completedInWindow.filter(
    (task) => task.dueDate && task.completedAt && task.completedAt > task.dueDate,
  ).length;
  const currentOverdue = window
    ? normalizedTasks.filter(
      (task) => task.dueDate && task.dueDate < window.toISO && !CLOSED_TASK_STATUSES.has(task.status),
    ).length
    : 0;

  const weekBuckets = window ? buildWeekBuckets(window.fromISO, window.toISO) : [];
  const throughputByWeek = weekBuckets.map((bucket) => ({
    weekKey: bucket.weekKey,
    count: completedInWindow.filter((task) => task.completedAt && task.completedAt >= bucket.startISO && task.completedAt <= bucket.endISO).length,
  }));

  const activeIssues = normalizedIssues.filter((issue) => OPEN_ISSUE_STATUSES.has(issue.status));
  const diValue = roundTo(activeIssues.reduce((sum, issue) => sum + (DI_WEIGHTS[issue.severity] ?? 0), 0), 1);
  const openClose = window ? weekBuckets.map((bucket) => {
    const bucketEnd = bucket.endISO < window.toISO ? bucket.endISO : window.toISO;
    return {
      weekKey: bucket.weekKey,
      opened: normalizedIssues.filter((issue) => issue.foundDate && issue.foundDate >= bucket.startISO && issue.foundDate <= bucketEnd).length,
      closed: normalizedIssues.filter((issue) => issue.closedDate && issue.closedDate >= bucket.startISO && issue.closedDate <= bucketEnd).length,
      cumulativeOpen: Math.max(0, normalizedIssues.filter((issue) => issue.foundDate && issue.foundDate <= bucketEnd).length
        - normalizedIssues.filter((issue) => issue.closedDate && issue.closedDate <= bucketEnd).length),
    };
  }) : [];

  const checkpoints = window ? buildCheckpoints(window.fromISO, window.toISO) : [];
  const maxDueDate = maxISO(normalizedTasks.map((task) => task.dueDate).filter((date): date is string => !!date));
  const plannedEndISO = window
    ? maxDueDate
      ? minISO([window.toISO, maxDueDate])
      : window.toISO
    : null;

  const taskBurndown = checkpoints.map((dateISO) => {
    const completedByDate = normalizedTasks.filter((task) => task.completedAt && task.completedAt <= dateISO).length;
    return {
      dateISO,
      remaining: Math.max(0, totalTaskCount - completedByDate),
      ideal: plannedEndISO && window ? idealRemaining(totalTaskCount, window.fromISO, plannedEndISO, dateISO) : null,
    };
  });

  const defectBurndown = checkpoints.map((dateISO) => ({
    dateISO,
    remaining: Math.max(0,
      normalizedIssues.filter((issue) => issue.foundDate && issue.foundDate <= dateISO).length
        - normalizedIssues.filter((issue) => issue.closedDate && issue.closedDate <= dateISO).length,
    ),
  }));

  return {
    efficiency: {
      leadTimeDaysMedian: median(leadTimes),
      leadTimeDaysP85: percentileNearestRank(leadTimes, 0.85),
      throughputByWeek,
      overdueRatePct: dueDatedTasks.length > 0
        ? Math.round(((lateCompletedInWindow + currentOverdue) / dueDatedTasks.length) * 100)
        : null,
      overdueCount: lateCompletedInWindow + currentOverdue,
      dueDatedCount: dueDatedTasks.length,
      completedCount: completedInWindow.length,
      plannedCount: totalTaskCount,
    },
    quality: {
      diValue,
      openClose,
      bySeverity: countBySeverity(activeIssues),
      byCategory: countBy(activeIssues, (issue) => issue.category, "category"),
    },
    burndown: {
      task: taskBurndown,
      defect: defectBurndown,
    },
    process: {
      gateFirstPassRatePct: gateFirstPassRate(input.gates),
      phaseDurations: phaseDurations(normalizedPhases, normalizedTasks),
    },
  };
}

function toISODate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[mid];
  return roundTo((values[mid - 1] + values[mid]) / 2, 1);
}

function percentileNearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const index = Math.max(0, Math.ceil(values.length * percentile) - 1);
  return values[Math.min(values.length - 1, index)];
}

function countBySeverity(issues: Array<{ severity: keyof typeof DI_WEIGHTS }>) {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.severity, (counts.get(issue.severity) ?? 0) + 1);
  return SEVERITY_ORDER
    .map((severity) => ({ severity, count: counts.get(severity) ?? 0 }))
    .filter((row) => row.count > 0);
}

function countBy<T>(items: T[], keyOf: (item: T) => string, label: "category") {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item) || "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ [label]: key, count })) as Array<{ category: string; count: number }>;
}

function gateFirstPassRate(gates: MetricGate[]): number | null {
  const byGate = new Map<string, MetricGate[]>();
  gates.forEach((gate, index) => {
    const key = gate.phaseId || `gate-${index}`;
    byGate.set(key, [...(byGate.get(key) ?? []), gate]);
  });
  if (byGate.size === 0) return null;

  let firstPass = 0;
  for (const reviews of Array.from(byGate.values())) {
    if (reviews.some((review) => review.decision === "approved" && review.roundNumber === 1)) {
      firstPass += 1;
    }
  }
  return Math.round((firstPass / byGate.size) * 100);
}

function phaseDurations(phases: Array<{
  phaseId: string;
  startDate: string | null;
  endDate: string | null;
}>, tasks: Array<{
  phaseId?: string | null;
  createdAt: string | null;
  completedAt: string | null;
}>) {
  return phases.map((phase) => {
    // plannedDays = 阶段计划日期（可编辑）；actualDays 始终从任务活动算，
    // 否则有 phase 日期时 actual 会等于 planned，计划/实际对比失去意义。
    const plannedDays = daysBetween(phase.startDate, phase.endDate);
    const phaseTasks = tasks.filter((task) => task.phaseId === phase.phaseId);
    const fallbackStart = minISO(phaseTasks.map((task) => task.createdAt).filter((date): date is string => !!date));
    const fallbackEnd = maxISO(phaseTasks.map((task) => task.completedAt).filter((date): date is string => !!date));
    const actualDays = daysBetween(fallbackStart, fallbackEnd);

    return {
      phaseId: phase.phaseId,
      plannedDays,
      actualDays,
    };
  });
}

function buildCheckpoints(fromISO: string, toISO: string): string[] {
  const spanDays = daysBetween(fromISO, toISO);
  if (spanDays === null || spanDays < 0) return [];
  const stepDays = spanDays <= 56 ? 1 : 7;
  const dates: string[] = [];
  let cursor = fromISO;
  while (cursor <= toISO) {
    dates.push(cursor);
    cursor = addDays(cursor, stepDays);
  }
  if (dates[dates.length - 1] !== toISO) dates.push(toISO);
  return dates;
}

function buildWeekBuckets(fromISO: string, toISO: string) {
  const buckets: { weekKey: string; startISO: string; endISO: string }[] = [];
  let cursor = startOfISOWeek(fromISO);
  while (cursor <= toISO) {
    const endISO = addDays(cursor, 6);
    buckets.push({ weekKey: isoWeekKey(cursor), startISO: cursor, endISO });
    cursor = addDays(cursor, 7);
  }
  return buckets;
}

function isoWeekKey(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function startOfISOWeek(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function idealRemaining(total: number, fromISO: string, plannedEndISO: string, dateISO: string): number {
  if (total <= 0) return 0;
  if (dateISO >= plannedEndISO) return 0;
  const duration = daysBetween(fromISO, plannedEndISO);
  const elapsed = daysBetween(fromISO, dateISO);
  if (duration === null || elapsed === null || duration <= 0) return total;
  return roundTo(Math.max(0, total * (1 - elapsed / duration)), 1);
}

function addDays(dateISO: string, days: number): string {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minISO(values: Array<string | null | undefined>): string | null {
  const flat = values.filter((value): value is string => !!value);
  if (flat.length === 0) return null;
  return flat.sort()[0];
}

function maxISO(values: Array<string | null | undefined>): string | null {
  const flat = values.filter((value): value is string => !!value);
  if (flat.length === 0) return null;
  return flat.sort()[flat.length - 1];
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
