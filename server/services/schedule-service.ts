import { and, eq } from "drizzle-orm";
import { projectTasks } from "../../drizzle/schema";
import { computeDelayImpact, type DelayImpact } from "../../shared/delay-impact";
import { buildSchedTasks } from "../../shared/schedule-graph";
import { getEffectivePhasesForProjectLike } from "../../shared/npd-v3";
import { generateSchedule, rescheduleFrom, type CalendarExceptions, type Schedule } from "../../shared/scheduling";
import { emitAutomationEvent } from "../automation/events";
import { createActivityLog, getCalendarExceptions, getDb, getProjectById, refreshProjectTaskStatuses } from "../db";
import { taskDisplayTitle } from "../task-title";

/** 按项目 category + 开始日重生成整套任务起止日，写回 project_tasks。返回写入任务数。 */
export async function applyProjectSchedule(projectId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const project = await getProjectById(projectId);
  if (!project?.startDate) return 0;
  const cal = await getCalendarExceptions();
  const schedule = generateSchedule(
    buildSchedTasks(getEffectivePhasesForProjectLike(project)),
    project.startDate,
    cal,
  );
  let n = 0;
  for (const [taskId, d] of Object.entries(schedule)) {
    await db.update(projectTasks)
      .set({ startDate: d.start, dueDate: d.due })
      .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.taskId, taskId)));
    n += 1;
  }
  if (n > 0) await refreshProjectTaskStatuses(projectId);
  return n;
}

type EffectiveScheduleContext = {
  schedTasks: ReturnType<typeof buildSchedTasks>;
  current: Schedule;
  effectiveIds: Set<string>;
  gateTaskIds: Set<string>;
  gateNames: Record<string, string>;
  taskTitles: Record<string, string>;
  projectCategory: string;
  targetDate: string | null;
  cal: CalendarExceptions;
};

async function loadEffectiveScheduleContext(projectId: string): Promise<EffectiveScheduleContext | null> {
  const db = await getDb();
  if (!db) return null;
  const project = await getProjectById(projectId);
  if (!project) return null;

  const rows = await db
    .select({
      phaseId: projectTasks.phaseId,
      taskId: projectTasks.taskId,
      instructions: projectTasks.instructions,
      startDate: projectTasks.startDate,
      dueDate: projectTasks.dueDate,
      status: projectTasks.status,
    })
    .from(projectTasks)
    .where(eq(projectTasks.projectId, projectId));

  const effectiveIds = new Set(rows.filter((r) => r.status !== "skipped").map((r) => r.taskId));
  const current: Schedule = {};
  for (const r of rows) {
    if (effectiveIds.has(r.taskId) && r.startDate && r.dueDate) {
      current[r.taskId] = { start: r.startDate, due: r.dueDate };
    }
  }

  const phases = getEffectivePhasesForProjectLike(project);
  const schedTasks = buildSchedTasks(phases).filter((t) => effectiveIds.has(t.id));
  const gateTaskIds = new Set(phases.map((p) => p.gateTaskId).filter((id) => effectiveIds.has(id)));
  const gateNames: Record<string, string> = {};
  for (const p of phases) if (effectiveIds.has(p.gateTaskId)) gateNames[p.gateTaskId] = p.gate;
  const taskTitles: Record<string, string> = {};
  for (const row of rows) {
    taskTitles[row.taskId] = taskDisplayTitle({
      taskId: row.taskId,
      phaseId: row.phaseId,
      projectCategory: project.category,
      instructions: row.instructions,
    });
  }

  return {
    schedTasks,
    current,
    effectiveIds,
    gateTaskIds,
    gateNames,
    taskTitles,
    projectCategory: project.category,
    targetDate: project.targetDate ?? null,
    cal: await getCalendarExceptions(),
  };
}

/** 改某任务起止后，只向后联动重排其传递后继；返回受影响并更新的任务数。 */
export async function rescheduleProjectFromTask(
  projectId: string, taskId: string, start: string, due: string,
  deps: { emit?: (e: any) => Promise<void>; actorId?: number | null } = {}
): Promise<{ count: number; impact: DelayImpact | null }> {
  const db = await getDb();
  if (!db) return { count: 0, impact: null };
  const ctx = await loadEffectiveScheduleContext(projectId);
  if (!ctx || !ctx.effectiveIds.has(taskId)) return { count: 0, impact: null };

  const impact = computeDelayImpact({
    schedTasks: ctx.schedTasks,
    current: ctx.current,
    changedTaskId: taskId,
    newDates: { start, due },
    gateTaskIds: ctx.gateTaskIds,
    gateNames: ctx.gateNames,
    targetDate: ctx.targetDate,
    cal: ctx.cal,
  });
  const next = rescheduleFrom(ctx.schedTasks, ctx.current, taskId, { start, due }, ctx.cal);
  let n = 0;
  for (const [id, d] of Object.entries(next)) {
    if (ctx.current[id]?.start === d.start && ctx.current[id]?.due === d.due) continue;
    await db.update(projectTasks)
      .set({ startDate: d.start, dueDate: d.due })
      .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.taskId, id)));
    n += 1;
  }
  if (n > 0) await refreshProjectTaskStatuses(projectId);

  if (impact?.hasImpact) {
    const after = {
      taskId,
      title: ctx.taskTitles[taskId] ?? taskDisplayTitle({ taskId, projectCategory: ctx.projectCategory }),
      projectCategory: ctx.projectCategory,
      startDate: start,
      dueDate: due,
    };
    if (deps.actorId != null) {
      await createActivityLog({
        projectId,
        userId: deps.actorId,
        action: "task.rescheduled",
        entityType: "task",
        entityId: taskId,
        meta: { startDate: start, dueDate: due, after, impact },
      });
    }
    const emit = deps.emit ?? emitAutomationEvent;
    await emit({
      action: "task.rescheduled",
      entityType: "task",
      entityId: taskId,
      projectId,
      after,
      impact,
    } as any);
  }
  return { count: n, impact };
}

export async function computeProjectDelayImpact(
  projectId: string, taskId: string, start: string, due: string
): Promise<DelayImpact | null> {
  const ctx = await loadEffectiveScheduleContext(projectId);
  if (!ctx || !ctx.effectiveIds.has(taskId)) return null;
  return computeDelayImpact({
    schedTasks: ctx.schedTasks,
    current: ctx.current,
    changedTaskId: taskId,
    newDates: { start, due },
    gateTaskIds: ctx.gateTaskIds,
    gateNames: ctx.gateNames,
    targetDate: ctx.targetDate,
    cal: ctx.cal,
  });
}
