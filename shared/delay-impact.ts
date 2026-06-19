import { rescheduleFrom, type SchedTask, type Schedule } from "./scheduling";
import { daysBetween } from "./health";

export type ShiftedTask = { taskId: string; oldDue: string; newDue: string; deltaDays: number };
export type GateImpact = ShiftedTask & { gateName: string | null };
export type TargetBreach = {
  oldProjectedEnd: string;
  newProjectedEnd: string;
  targetDate: string;
  slipDays: number;
  newlyBreaches: boolean;
};
export type DelayImpact = {
  changedTaskId: string;
  shifted: ShiftedTask[];
  gateImpacts: GateImpact[];
  targetBreach: TargetBreach | null;
  maxDeltaDays: number;
  hasImpact: boolean;
};

function maxDue(sched: Schedule): string | null {
  let m: string | null = null;
  for (const id of Object.keys(sched)) {
    const d = sched[id]?.due;
    if (d && (m === null || d > m)) m = d;
  }
  return m;
}

export function computeDelayImpact(input: {
  schedTasks: SchedTask[];
  current: Schedule;
  changedTaskId: string;
  newDates: { start: string; due: string };
  gateTaskIds: Set<string>;
  gateNames?: Record<string, string>;
  targetDate: string | null;
}): DelayImpact {
  const { schedTasks, current, changedTaskId, newDates, gateTaskIds, gateNames, targetDate } = input;
  const next = rescheduleFrom(schedTasks, current, changedTaskId, newDates);

  const shifted: ShiftedTask[] = [];
  for (const taskId of Object.keys(next)) {
    if (taskId === changedTaskId) continue;
    const oldDue = current[taskId]?.due;
    const newDue = next[taskId]?.due;
    if (!oldDue || !newDue || oldDue === newDue) continue;
    const delta = daysBetween(oldDue, newDue);
    if (delta === null || delta <= 0) continue;
    shifted.push({ taskId, oldDue, newDue, deltaDays: delta });
  }
  shifted.sort((a, b) =>
    a.newDue < b.newDue ? -1 : a.newDue > b.newDue ? 1 : a.taskId < b.taskId ? -1 : 1
  );

  const gateImpacts: GateImpact[] = shifted
    .filter((s) => gateTaskIds.has(s.taskId))
    .map((s) => ({ ...s, gateName: gateNames?.[s.taskId] ?? null }));

  const oldProjectedEnd = maxDue(current);
  const newProjectedEnd = maxDue(next);
  let targetBreach: TargetBreach | null = null;
  if (
    targetDate && oldProjectedEnd && newProjectedEnd &&
    newProjectedEnd > targetDate && newProjectedEnd > oldProjectedEnd
  ) {
    targetBreach = {
      oldProjectedEnd,
      newProjectedEnd,
      targetDate,
      slipDays: daysBetween(targetDate, newProjectedEnd) ?? 0,
      newlyBreaches: oldProjectedEnd <= targetDate,
    };
  }

  const maxDeltaDays = shifted.reduce((m, s) => Math.max(m, s.deltaDays), 0);
  const hasImpact = gateImpacts.length > 0 || targetBreach !== null;
  return { changedTaskId, shifted, gateImpacts, targetBreach, maxDeltaDays, hasImpact };
}
