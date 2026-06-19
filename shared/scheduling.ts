// 自动排期纯函数（工作日、正向拓扑、改一项下游联动）。无副作用、不读时钟，便于单测。

export type SchedTask = {
  id: string;
  durationDays?: number; // 缺省 1，按工作日计算
  dependsOn?: string[];  // finish-to-start 前置
  lagDays?: number;      // start 前额外缓冲（缺省 0，按工作日计算）
};
export type Schedule = Record<string, { start: string; due: string }>;
export type ForecastTaskState = {
  id: string;
  startDate?: string | null;
  dueDate?: string | null;
  completed?: boolean | null;
  status?: string | null;
  completedAtISO?: string | null;
};

/** 严格 ISO 日期(YYYY-MM-DD)，不接受 2026-13-99 这类会被 Date 自动归一化的值 */
export function isISODate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(y, month - 1, day));
  return dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day;
}

/** ISO 日期(YYYY-MM-DD)加 n 个日历日 */
export function addDays(iso: string, n: number): string {
  if (!isISODate(iso)) throw new Error(`Invalid ISO date: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 全局日历例外（YYYY-MM-DD 集合）。holidays=法定假(休)，makeupWorkdays=调休上班(工)。 */
export type CalendarExceptions = {
  holidays: Set<string>;
  makeupWorkdays: Set<string>;
};

/**
 * 工厂工作日历：周一至周六为工作日，周日休息。
 * 可选 cal 叠加法定假/调休；不传则仅按周末口径（与历史一致）。
 * 优先级：调休上班 > 法定假 > 周一~六默认。
 */
export function isWorkingDay(iso: string, cal?: CalendarExceptions): boolean {
  if (!isISODate(iso)) return false;
  if (cal?.makeupWorkdays.has(iso)) return true;
  if (cal?.holidays.has(iso)) return false;
  return new Date(`${iso}T00:00:00Z`).getUTCDay() !== 0;
}

export function nextWorkingDay(iso: string, cal?: CalendarExceptions): string {
  if (!isISODate(iso)) throw new Error(`Invalid ISO date: ${iso}`);
  let out = iso;
  while (!isWorkingDay(out, cal)) out = addDays(out, 1);
  return out;
}

/** ISO 日期加 n 个工厂工作日；起点若落在休息日，先顺延到下一个工作日。 */
export function addWorkingDays(iso: string, n: number, cal?: CalendarExceptions): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid working day delta: ${n}`);
  let out = nextWorkingDay(iso, cal);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(n));
  while (remaining > 0) {
    out = addDays(out, step);
    if (isWorkingDay(out, cal)) remaining -= 1;
  }
  return out;
}

/** 半开区间 [fromISO, toISO) 内的工作日数；与 addWorkingDays「起点不计增量」互逆。from>=to → 0。 */
export function workingDaysBetween(fromISO: string, toISO: string, cal?: CalendarExceptions): number {
  if (!isISODate(fromISO) || !isISODate(toISO)) return 0;
  if (fromISO >= toISO) return 0;
  let count = 0;
  let cur = fromISO;
  while (cur < toISO) {
    if (isWorkingDay(cur, cal)) count += 1;
    cur = addDays(cur, 1);
  }
  return count;
}

/** 拓扑序；有环返回 null */
function topoOrder(tasks: SchedTask[]): string[] | null {
  const ids = new Set(tasks.map((t) => t.id));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>(); // dep -> 依赖它的任务
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

function computeStart(t: SchedTask, sched: Schedule, startDate: string, idsInScope: Set<string>): string {
  const deps = (t.dependsOn ?? []).filter((d) => idsInScope.has(d));
  const dues = deps.map((d) => sched[d]?.due).filter((x): x is string => !!x);
  let start = dues.length ? dues.reduce((a, b) => (b > a ? b : a)) : startDate; // ISO 字典序=时间序
  return addWorkingDays(start, t.lagDays ?? 0);
}

/** 从 startDate 正向生成整套任务起止日 */
export function generateSchedule(tasks: SchedTask[], startDate: string): Schedule {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ids = new Set(tasks.map((t) => t.id));
  const order = topoOrder(tasks) ?? tasks.map((t) => t.id); // 有环则按给定序尽力而为
  const sched: Schedule = {};
  for (const id of order) {
    const t = byId.get(id)!;
    const start = computeStart(t, sched, startDate, ids);
    sched[id] = { start, due: addWorkingDays(start, Math.max(0, t.durationDays ?? 1)) };
  }
  return sched;
}

/** 锚定被改任务的新起止，只向后重算其传递后继；上游与无关分支不动 */
export function rescheduleFrom(
  tasks: SchedTask[],
  current: Schedule,
  changedTaskId: string,
  newDates: { start: string; due: string }
): Schedule {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ids = new Set(tasks.map((t) => t.id));
  const sched: Schedule = { ...current, [changedTaskId]: { ...newDates } };

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

  const order = (topoOrder(tasks) ?? tasks.map((t) => t.id)).filter((id) => affected.has(id));
  for (const id of order) {
    const t = byId.get(id)!;
    const start = computeStart(t, sched, newDates.start, ids);
    sched[id] = { start, due: addWorkingDays(start, Math.max(0, t.durationDays ?? 1)) };
  }
  return sched;
}

function maxISO(values: Array<string | null | undefined>): string | null {
  let out: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const iso = value.slice(0, 10);
    if (!isISODate(iso)) continue;
    if (!out || iso > out) out = iso;
  }
  return out;
}

function isTaskDone(state: ForecastTaskState | undefined): boolean {
  return !!state && (
    !!state.completed ||
    state.status === "done" ||
    state.status === "skipped"
  );
}

/**
 * 基于实绩预测排期。计划 start/due 保留为基线；这里仅 on-read 推导预测日期。
 * 已完成任务用 completedAt 锚定；未完成任务从 today / 计划开始 / 前置预测完成的较晚者继续顺推。
 */
export function forecastSchedule(
  tasks: SchedTask[],
  states: ForecastTaskState[],
  todayISO: string,
  projectStartDate?: string | null
): Schedule {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const stateById = new Map(states.map((s) => [s.id, s]));
  const ids = new Set(tasks.map((t) => t.id));
  const order = topoOrder(tasks) ?? tasks.map((t) => t.id);
  const anchor = maxISO([projectStartDate, todayISO]) ?? todayISO;
  const sched: Schedule = {};

  for (const id of order) {
    const t = byId.get(id)!;
    const state = stateById.get(id);
    const completedAt = maxISO([state?.completedAtISO]);
    const doneAt = completedAt ?? (isTaskDone(state) ? maxISO([state?.dueDate]) : null);
    if (isTaskDone(state) && doneAt) {
      sched[id] = { start: doneAt, due: doneAt };
      continue;
    }

    const deps = (t.dependsOn ?? []).filter((d) => ids.has(d));
    const depDue = maxISO(deps.map((d) => sched[d]?.due));
    const base = maxISO([anchor, state?.startDate, depDue]) ?? anchor;
    const start = addWorkingDays(base, t.lagDays ?? 0);
    sched[id] = { start, due: addWorkingDays(start, Math.max(0, t.durationDays ?? 1)) };
  }

  return sched;
}

export function projectedEndFromSchedule(schedule: Schedule): string | null {
  return maxISO(Object.values(schedule).map((item) => item.due));
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
