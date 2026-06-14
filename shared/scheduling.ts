// 自动排期纯函数（日历日、正向拓扑、改一项下游联动）。无副作用、不读时钟，便于单测。

export type SchedTask = {
  id: string;
  durationDays?: number; // 缺省 1
  dependsOn?: string[];  // finish-to-start 前置
  lagDays?: number;      // start 前额外缓冲（缺省 0）
};
export type Schedule = Record<string, { start: string; due: string }>;

/** ISO 日期(YYYY-MM-DD)加 n 个日历日 */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
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
  return addDays(start, t.lagDays ?? 0);
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
    sched[id] = { start, due: addDays(start, Math.max(0, t.durationDays ?? 1)) };
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
    sched[id] = { start, due: addDays(start, Math.max(0, t.durationDays ?? 1)) };
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
