// 自动排期纯函数（工作日、正向拓扑、改一项下游联动）。无副作用、不读时钟，便于单测。

export type SchedTask = {
  id: string;
  durationDays?: number; // 缺省 1
  dependsOn?: string[];  // finish-to-start 前置
  lagDays?: number;      // start 前额外缓冲（缺省 0）
};
export type Schedule = Record<string, { start: string; due: string }>;

export type ScheduleOptions = {
  /** 默认 true：按周一到周五推进；设为 false 时退回日历日。 */
  useWorkingDays?: boolean;
  /** 额外节假日表，格式 YYYY-MM-DD。 */
  holidays?: Iterable<string>;
  /** 可工作星期，使用 JS getUTCDay 口径：0=周日，1=周一，...，6=周六。默认周一到周五。 */
  workdays?: Iterable<number>;
};

type NormalizedCalendar = {
  useWorkingDays: boolean;
  holidays: Set<string>;
  workdays: Set<number>;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WORKDAYS = new Set([1, 2, 3, 4, 5]);

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

export function isScheduleError(error: unknown): error is ScheduleError {
  return error instanceof ScheduleError;
}

function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseISODate(iso: string, label = "date"): Date {
  if (!ISO_DATE_RE.test(iso)) {
    throw new ScheduleError(`${label} must be a YYYY-MM-DD date: ${iso}`);
  }
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatISODate(date) !== iso) {
    throw new ScheduleError(`${label} is not a valid calendar date: ${iso}`);
  }
  return date;
}

function requireInteger(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new ScheduleError(`${label} must be an integer`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, label: string): number {
  requireInteger(value, label);
  if (value < 0) {
    throw new ScheduleError(`${label} must be greater than or equal to 0`);
  }
  return value;
}

function normalizeCalendar(options: ScheduleOptions = {}): NormalizedCalendar {
  const holidays = new Set<string>();
  for (const holiday of Array.from(options.holidays ?? [])) {
    holidays.add(formatISODate(parseISODate(holiday, "holiday")));
  }

  const workdays = new Set<number>();
  for (const weekday of Array.from(options.workdays ?? DEFAULT_WORKDAYS)) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new ScheduleError(`workday must be an integer from 0 to 6: ${weekday}`);
    }
    workdays.add(weekday);
  }
  if (workdays.size === 0) {
    throw new ScheduleError("workdays must include at least one weekday");
  }

  return {
    useWorkingDays: options.useWorkingDays ?? true,
    holidays,
    workdays,
  };
}

function isWorkingDate(date: Date, calendar: NormalizedCalendar): boolean {
  return calendar.workdays.has(date.getUTCDay()) && !calendar.holidays.has(formatISODate(date));
}

function addCalendarDaysDate(date: Date, n: number): Date {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function addWorkingDaysDate(date: Date, n: number, calendar: NormalizedCalendar): Date {
  requireInteger(n, "working day offset");
  if (n === 0) return new Date(date);

  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let cursor = new Date(date);
  while (remaining > 0) {
    cursor = addCalendarDaysDate(cursor, step);
    if (isWorkingDate(cursor, calendar)) remaining -= 1;
  }
  return cursor;
}

function nextWorkingDateOnOrAfter(date: Date, calendar: NormalizedCalendar): Date {
  let cursor = new Date(date);
  while (!isWorkingDate(cursor, calendar)) {
    cursor = addCalendarDaysDate(cursor, 1);
  }
  return cursor;
}

function addScheduleDays(iso: string, n: number, calendar: NormalizedCalendar): string {
  const date = parseISODate(iso);
  const out = calendar.useWorkingDays
    ? addWorkingDaysDate(date, n, calendar)
    : addCalendarDaysDate(date, n);
  return formatISODate(out);
}

function normalizeStart(iso: string, calendar: NormalizedCalendar): string {
  const date = parseISODate(iso);
  return calendar.useWorkingDays ? formatISODate(nextWorkingDateOnOrAfter(date, calendar)) : iso;
}

function assertDateRange(dates: { start: string; due: string }, label: string) {
  const start = formatISODate(parseISODate(dates.start, `${label}.start`));
  const due = formatISODate(parseISODate(dates.due, `${label}.due`));
  if (due < start) {
    throw new ScheduleError(`${label}.due must be on or after ${label}.start`);
  }
  return { start, due };
}

/** ISO 日期(YYYY-MM-DD)加 n 个日历日 */
export function addDays(iso: string, n: number): string {
  requireInteger(n, "calendar day offset");
  return formatISODate(addCalendarDaysDate(parseISODate(iso), n));
}

/** ISO 日期(YYYY-MM-DD)加 n 个工作日；默认周一到周五，可传节假日表。 */
export function addWorkingDays(iso: string, n: number, options: ScheduleOptions = {}): string {
  const calendar = normalizeCalendar({ ...options, useWorkingDays: true });
  return formatISODate(addWorkingDaysDate(parseISODate(iso), n, calendar));
}

function findCycle(tasks: SchedTask[], ids: Set<string>): string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const dfs = (id: string): string[] | null => {
    visiting.add(id);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!ids.has(dep)) continue;
      if (visiting.has(dep)) {
        return [...stack.slice(stack.indexOf(dep)), dep];
      }
      if (!visited.has(dep)) {
        const cycle = dfs(dep);
        if (cycle) return cycle;
      }
    }
    visiting.delete(id);
    visited.add(id);
    stack.pop();
    return null;
  };

  for (const id of Array.from(ids)) {
    if (visited.has(id)) continue;
    const cycle = dfs(id);
    if (cycle) return cycle;
  }
  return null;
}

/** 拓扑序；成环、重名、缺依赖会抛出 ScheduleError。 */
export function resolveScheduleOrder(tasks: SchedTask[]): string[] {
  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) {
    throw new ScheduleError("task ids must be unique");
  }

  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>(); // dep -> 依赖它的任务
  for (const t of tasks) {
    if (!t.id) throw new ScheduleError("task id is required");
    indeg.set(t.id, 0);
  }
  for (const t of tasks) {
    for (const d of t.dependsOn ?? []) {
      if (!ids.has(d)) {
        throw new ScheduleError(`task "${t.id}" depends on missing task "${d}"`);
      }
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
  if (order.length !== tasks.length) {
    const cycle = findCycle(tasks, ids);
    throw new ScheduleError(`schedule dependency cycle detected${cycle ? `: ${cycle.join(" -> ")}` : ""}`);
  }
  return order;
}

function computeStart(t: SchedTask, sched: Schedule, startDate: string, calendar: NormalizedCalendar): string {
  const deps = t.dependsOn ?? [];
  let start = startDate; // ISO 字典序=时间序（入参已校验）
  for (const dep of deps) {
    const depSchedule = sched[dep];
    if (!depSchedule) {
      throw new ScheduleError(`task "${t.id}" cannot start because dependency "${dep}" has no schedule`);
    }
    const due = assertDateRange(depSchedule, `schedule.${dep}`).due;
    if (due > start) start = due;
  }
  const lag = requireNonNegativeInteger(t.lagDays ?? 0, `task "${t.id}" lagDays`);
  return normalizeStart(addScheduleDays(start, lag, calendar), calendar);
}

function taskDuration(t: SchedTask): number {
  return requireNonNegativeInteger(t.durationDays ?? 1, `task "${t.id}" durationDays`);
}

/** 从 startDate 正向生成整套任务起止日 */
export function generateSchedule(tasks: SchedTask[], startDate: string, options: ScheduleOptions = {}): Schedule {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const order = resolveScheduleOrder(tasks);
  const calendar = normalizeCalendar(options);
  const normalizedStart = normalizeStart(formatISODate(parseISODate(startDate, "startDate")), calendar);
  const sched: Schedule = {};
  for (const id of order) {
    const t = byId.get(id)!;
    const start = computeStart(t, sched, normalizedStart, calendar);
    sched[id] = { start, due: addScheduleDays(start, taskDuration(t), calendar) };
  }
  return sched;
}

/** 锚定被改任务的新起止，只向后重算其传递后继；上游与无关分支不动 */
export function rescheduleFrom(
  tasks: SchedTask[],
  current: Schedule,
  changedTaskId: string,
  newDates: { start: string; due: string },
  options: ScheduleOptions = {}
): Schedule {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const order = resolveScheduleOrder(tasks);
  if (!byId.has(changedTaskId)) {
    throw new ScheduleError(`changed task "${changedTaskId}" is not in the schedule task list`);
  }
  const calendar = normalizeCalendar(options);
  const ids = new Set(tasks.map((t) => t.id));
  const sched: Schedule = {};
  for (const id of Array.from(ids)) {
    if (current[id]) sched[id] = assertDateRange(current[id], `current.${id}`);
  }
  sched[changedTaskId] = assertDateRange(newDates, `newDates.${changedTaskId}`);

  // dep -> 依赖它的任务
  const dependents = new Map<string, string[]>();
  for (const t of tasks) for (const d of t.dependsOn ?? []) (dependents.get(d) ?? dependents.set(d, []).get(d)!).push(t.id);

  // 收集 changedTaskId 的传递后继
  const affected = new Set<string>();
  const stack = [...(dependents.get(changedTaskId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (affected.has(id)) continue;
    affected.add(id);
    for (const s of dependents.get(id) ?? []) stack.push(s);
  }

  const affectedOrder = order.filter((id) => affected.has(id));
  for (const id of affectedOrder) {
    const t = byId.get(id)!;
    const start = computeStart(t, sched, newDates.start, calendar);
    sched[id] = { start, due: addScheduleDays(start, taskDuration(t), calendar) };
  }
  return sched;
}

/** 把 SOP 阶段（按顺序）摊平成排期任务：阶段 bufferDays 作为入口任务的 lagDays */
export function flattenPhases(
  phases: Array<{ bufferDays?: number; tasks: Array<{ id: string; durationDays?: number; dependsOn?: string[] }> }>
): SchedTask[] {
  const out: SchedTask[] = [];
  for (const phase of phases) {
    const phaseIds = new Set(phase.tasks.map((t) => t.id));
    for (const t of phase.tasks) {
      const deps = t.dependsOn ?? [];
      const isEntry = deps.length === 0 || deps.every((d) => !phaseIds.has(d)); // 无本阶段内前置=入口
      out.push({ id: t.id, durationDays: t.durationDays, dependsOn: deps, lagDays: isEntry ? phase.bufferDays ?? 0 : 0 });
    }
  }
  return out;
}
