import { addDays, addWorkingDays, isISODate, type SchedTask, type Schedule } from "./scheduling";

export type CurrentTaskDate = {
  taskId: string;
  startDate: string | null;
  dueDate: string | null;
};

export type WorkingCalendarMigrationPlan = {
  updates: Array<{
    taskId: string;
    from: { start: string | null; due: string | null };
    to: { start: string; due: string };
  }>;
  alreadyWorking: string[];
  missingSchedule: Array<{
    taskId: string;
    to: { start: string; due: string };
  }>;
  manualOrUnknown: Array<{
    taskId: string;
    current: { start: string | null; due: string | null };
    oldCalendar: { start: string; due: string } | null;
    workingCalendar: { start: string; due: string } | null;
  }>;
};

function topoOrder(tasks: SchedTask[]): string[] | null {
  const ids = new Set(tasks.map((t) => t.id));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) indeg.set(t.id, 0);
  for (const t of tasks) {
    for (const d of t.dependsOn ?? []) {
      if (!ids.has(d)) continue;
      indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
      (adj.get(d) ?? adj.set(d, []).get(d)!).push(t.id);
    }
  }
  const q = Array.from(indeg.entries()).filter(([, n]) => n === 0).map(([id]) => id);
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(id);
    for (const nx of adj.get(id) ?? []) {
      indeg.set(nx, indeg.get(nx)! - 1);
      if (indeg.get(nx) === 0) q.push(nx);
    }
  }
  return order.length === tasks.length ? order : null;
}

function computeStart(
  t: SchedTask,
  sched: Schedule,
  startDate: string,
  idsInScope: Set<string>,
  add: (iso: string, n: number) => string,
): string {
  const deps = (t.dependsOn ?? []).filter((d) => idsInScope.has(d));
  const dues = deps.map((d) => sched[d]?.due).filter((x): x is string => !!x);
  const start = dues.length ? dues.reduce((a, b) => (b > a ? b : a)) : startDate;
  return add(start, t.lagDays ?? 0);
}

export function generateCalendarSchedule(tasks: SchedTask[], startDate: string): Schedule {
  if (!isISODate(startDate)) throw new Error(`Invalid ISO date: ${startDate}`);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ids = new Set(tasks.map((t) => t.id));
  const order = topoOrder(tasks) ?? tasks.map((t) => t.id);
  const sched: Schedule = {};
  for (const id of order) {
    const t = byId.get(id)!;
    const start = computeStart(t, sched, startDate, ids, addDays);
    sched[id] = { start, due: addDays(start, Math.max(0, t.durationDays ?? 1)) };
  }
  return sched;
}

export function generateWorkingSchedule(tasks: SchedTask[], startDate: string): Schedule {
  if (!isISODate(startDate)) throw new Error(`Invalid ISO date: ${startDate}`);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ids = new Set(tasks.map((t) => t.id));
  const order = topoOrder(tasks) ?? tasks.map((t) => t.id);
  const sched: Schedule = {};
  for (const id of order) {
    const t = byId.get(id)!;
    const start = computeStart(t, sched, startDate, ids, addWorkingDays);
    sched[id] = { start, due: addWorkingDays(start, Math.max(0, t.durationDays ?? 1)) };
  }
  return sched;
}

function sameDatePair(a: { startDate: string | null; dueDate: string | null }, b: { start: string; due: string } | null): boolean {
  return !!b && a.startDate === b.start && a.dueDate === b.due;
}

export function planWorkingCalendarMigration(input: {
  tasks: SchedTask[];
  current: CurrentTaskDate[];
  startDate: string;
}): WorkingCalendarMigrationPlan {
  const oldCalendar = generateCalendarSchedule(input.tasks, input.startDate);
  const workingCalendar = generateWorkingSchedule(input.tasks, input.startDate);
  const taskIds = new Set(input.tasks.map((task) => task.id));
  const updates: WorkingCalendarMigrationPlan["updates"] = [];
  const alreadyWorking: string[] = [];
  const missingSchedule: WorkingCalendarMigrationPlan["missingSchedule"] = [];
  const manualOrUnknown: WorkingCalendarMigrationPlan["manualOrUnknown"] = [];

  for (const row of input.current) {
    if (!taskIds.has(row.taskId)) continue;
    const oldPlan = oldCalendar[row.taskId] ?? null;
    const workingPlan = workingCalendar[row.taskId] ?? null;
    if (sameDatePair(row, workingPlan)) {
      alreadyWorking.push(row.taskId);
      continue;
    }
    if (!row.startDate && !row.dueDate && workingPlan) {
      missingSchedule.push({ taskId: row.taskId, to: workingPlan });
      continue;
    }
    if (sameDatePair(row, oldPlan) && workingPlan) {
      updates.push({
        taskId: row.taskId,
        from: { start: row.startDate, due: row.dueDate },
        to: workingPlan,
      });
      continue;
    }
    manualOrUnknown.push({
      taskId: row.taskId,
      current: { start: row.startDate, due: row.dueDate },
      oldCalendar: oldPlan,
      workingCalendar: workingPlan,
    });
  }

  return { updates, alreadyWorking, missingSchedule, manualOrUnknown };
}
