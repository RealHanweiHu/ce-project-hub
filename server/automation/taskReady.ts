import type { ActionItem, ProjectTask } from "../../drizzle/schema";
import { buildProjectActionPath } from "../../shared/action-links";
import {
  getEffectivePhasesForProjectLike,
  getTaskEvidenceLevel,
  type ProjectTemplateLike,
} from "../../shared/npd-v3";
import { buildOperationalProjectSchedTasks } from "../../shared/schedule-graph";
import type { SchedTask } from "../../shared/scheduling";
import {
  actionDedupeKey,
  closeActionItemsWithCards,
  notifyActionItem,
  taskActionEntityId,
  type ActionItemNotifyInput,
} from "../action-item-notify";
import { getProjectTasks, listActiveActionItemsForProjectKind } from "../db";
import type { NotifyPersonalDeps } from "../notification-gateway";
import type { AutomationEvent } from "./rules";

type TaskReadyProject = ProjectTemplateLike & {
  id: string;
  currentPhase: string;
};

type DispatchActionItem = (
  input: ActionItemNotifyInput,
  deps?: NotifyPersonalDeps,
) => Promise<{ dispatched: boolean; actionItemId: number | null }>;

export type TaskReadyDeps = NotifyPersonalDeps & {
  loadProjectTasks?: typeof getProjectTasks;
  dispatchActionItem?: DispatchActionItem;
  loadActiveReadyItems?: (projectId: string) => Promise<ActionItem[]>;
  closeReadyItem?: (item: ActionItem) => Promise<void>;
};

export type TaskReadyResult = {
  /** 满足依赖、仍待开始且已有负责人的后继任务数。 */
  eligible: number;
  /** 本次实际新派发的行动项数；已存在的 dedupeKey 不重复通知。 */
  dispatched: number;
};

function stringField(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function completedTaskId(event: AutomationEvent): string | null {
  const explicit = stringField(event.after, "taskId") ?? stringField(event.before, "taskId");
  if (explicit) return explicit;
  if (event.entityId == null) return null;
  const raw = String(event.entityId);
  const parts = raw.split(":");
  return parts.length >= 3 ? parts[parts.length - 1] : raw;
}

function isSatisfiedDependency(task: ProjectTask | undefined): boolean {
  return !!task && (task.completed || task.status === "done" || task.status === "skipped");
}

type EffectivePhase = ReturnType<typeof getEffectivePhasesForProjectLike>[number];

type DispatchReadyCandidateInput = {
  project: TaskReadyProject;
  phaseId: string;
  taskId: string;
  triggerTaskId?: string | null;
  sourceActivityLogId?: number | null;
  phases: EffectivePhase[];
  graphTask: SchedTask | undefined;
  rowByTaskId: Map<string, ProjectTask>;
  dispatchActionItem: DispatchActionItem;
  notifyDeps: NotifyPersonalDeps;
};

function eligibleReadyRow(input: Omit<DispatchReadyCandidateInput, "dispatchActionItem" | "notifyDeps">): ProjectTask | null {
  const phase = input.phases.find((candidate) => candidate.id === input.phaseId);
  const templateTask = phase?.tasks.find((candidate) => candidate.id === input.taskId);
  const phaseIndex = input.phases.findIndex((candidate) => candidate.id === input.phaseId);
  const currentPhaseIndex = input.phases.findIndex((candidate) => candidate.id === input.project.currentPhase);
  // Gate tasks close from Gate decisions; they never receive a “start” card.
  if (
    !phase ||
    !templateTask ||
    currentPhaseIndex < 0 ||
    phaseIndex > currentPhaseIndex ||
    phase.gateTaskId === input.taskId ||
    !input.graphTask
  ) {
    return null;
  }

  const row = input.rowByTaskId.get(input.taskId);
  if (
    !row ||
    row.phaseId !== input.phaseId ||
    row.status !== "todo" ||
    row.completed ||
    !row.assigneeUserId
  ) {
    return null;
  }
  const unresolved = (input.graphTask.dependsOn ?? []).some((dependencyId) =>
    !isSatisfiedDependency(input.rowByTaskId.get(dependencyId)),
  );
  if (unresolved) return null;
  return row;
}

/** Single implementation for event fan-out and reassignment re-evaluation. */
async function dispatchReadyCandidate(input: DispatchReadyCandidateInput): Promise<TaskReadyResult> {
  const row = eligibleReadyRow(input);
  if (!row) return { eligible: 0, dispatched: 0 };
  const recipientUserId = row.assigneeUserId;
  if (!recipientUserId) return { eligible: 0, dispatched: 0 };
  const phase = input.phases.find((candidate) => candidate.id === input.phaseId)!;
  const templateTask = phase.tasks.find((candidate) => candidate.id === input.taskId)!;

  const evidenceLevel = getTaskEvidenceLevel(input.project, input.phaseId, input.taskId);
  const entityId = taskActionEntityId(input.project.id, input.phaseId, input.taskId);
  const result = await input.dispatchActionItem({
    kind: "task_ready",
    projectId: input.project.id,
    entityType: "task",
    entityId,
    dedupeKey: actionDedupeKey({
      kind: "task_ready",
      projectId: input.project.id,
      entityId,
      recipientUserId,
    }),
    recipientUserId,
    title: `可以开始了：${templateTask.name}`,
    body: evidenceLevel === "heavy"
      ? "前置任务已完成。点击开始后，请在任务页上传正式证据再完成。"
      : "前置任务已完成。点击开始；完成时补充一句话结论即可。",
    actionPath: buildProjectActionPath({
      projectId: input.project.id,
      tab: "tasks",
      phaseId: input.phaseId,
      taskId: input.taskId,
    }),
    priority: row.priority === "critical" ? "critical" : "normal",
    sourceActivityLogId: input.sourceActivityLogId ?? null,
    metadata: {
      phaseId: input.phaseId,
      taskId: input.taskId,
      evidenceLevel,
      ...(input.triggerTaskId ? { predecessorTaskId: input.triggerTaskId } : {}),
    },
  }, input.notifyDeps);
  return { eligible: 1, dispatched: result.dispatched ? 1 : 0 };
}

/**
 * Re-evaluate one effective task after reassignment. State is never changed;
 * this only creates the same task-ready action item used by event fan-out.
 */
export async function notifyTaskReadyTask(
  project: TaskReadyProject,
  phaseId: string,
  taskId: string,
  deps: TaskReadyDeps = {},
): Promise<TaskReadyResult> {
  const phases = getEffectivePhasesForProjectLike(project);
  if (!phases.some((phase) => phase.id === phaseId && phase.tasks.some((task) => task.id === taskId))) {
    return { eligible: 0, dispatched: 0 };
  }
  const {
    loadProjectTasks = getProjectTasks,
    dispatchActionItem = notifyActionItem,
    loadActiveReadyItems: _loadActiveReadyItems,
    closeReadyItem: _closeReadyItem,
    ...notifyDeps
  } = deps;
  const rows = await loadProjectTasks(project.id);
  const graphTask = buildOperationalProjectSchedTasks(project, rows).find((task) => task.id === taskId);
  return dispatchReadyCandidate({
    project,
    phaseId,
    taskId,
    phases,
    graphTask,
    rowByTaskId: new Map(rows.map((task) => [task.taskId, task])),
    dispatchActionItem,
    notifyDeps,
  });
}

/**
 * Reconcile all currently ready tasks after the effective graph changes (for
 * example, an approved tailoring request removes an intermediate node).
 * Dedupe keys make re-checking already-ready tasks safe.
 */
export async function notifyAllReadyTasks(
  project: TaskReadyProject,
  deps: TaskReadyDeps = {},
): Promise<TaskReadyResult> {
  const phases = getEffectivePhasesForProjectLike(project);
  const phaseIdByTaskId = new Map(
    phases.flatMap((phase) => phase.tasks.map((task) => [task.id, phase.id] as const)),
  );
  const gateTaskIds = new Set(phases.map((phase) => phase.gateTaskId).filter(Boolean));
  const {
    loadProjectTasks = getProjectTasks,
    dispatchActionItem = notifyActionItem,
    loadActiveReadyItems: _loadActiveReadyItems,
    closeReadyItem: _closeReadyItem,
    ...notifyDeps
  } = deps;
  const rows = await loadProjectTasks(project.id);
  const graph = buildOperationalProjectSchedTasks(project, rows);
  const rowByTaskId = new Map(rows.map((task) => [task.taskId, task]));
  let eligible = 0;
  let dispatched = 0;

  for (const graphTask of graph) {
    if (gateTaskIds.has(graphTask.id)) continue;
    const phaseId = phaseIdByTaskId.get(graphTask.id);
    if (!phaseId) continue;
    const result = await dispatchReadyCandidate({
      project,
      phaseId,
      taskId: graphTask.id,
      phases,
      graphTask,
      rowByTaskId,
      dispatchActionItem,
      notifyDeps,
    });
    eligible += result.eligible;
    dispatched += result.dispatched;
  }
  return { eligible, dispatched };
}

/**
 * Full graph reconciliation for tailoring approve/revoke: close cards that are
 * no longer eligible, then upsert every currently eligible task with dedupe.
 */
export async function reconcileTaskReadyActionItems(
  project: TaskReadyProject,
  deps: TaskReadyDeps = {},
): Promise<TaskReadyResult> {
  const phases = getEffectivePhasesForProjectLike(project);
  const phaseIdByTaskId = new Map(
    phases.flatMap((phase) => phase.tasks.map((task) => [task.id, phase.id] as const)),
  );
  const {
    loadProjectTasks = getProjectTasks,
    dispatchActionItem = notifyActionItem,
    loadActiveReadyItems = (projectId: string) => listActiveActionItemsForProjectKind(projectId, "task_ready"),
    closeReadyItem = async (item: ActionItem) => {
      await closeActionItemsWithCards({ dedupeKey: item.dedupeKey }, {
        title: "任务前置条件已变化",
        message: "这条“可以开始”卡片已关闭；系统会在条件再次满足时重新通知。",
        actionPath: buildProjectActionPath({ projectId: project.id, tab: "tasks" }),
      });
    },
    ...notifyDeps
  } = deps;
  const rows = await loadProjectTasks(project.id);
  const graph = buildOperationalProjectSchedTasks(project, rows);
  const rowByTaskId = new Map(rows.map((task) => [task.taskId, task]));
  const candidates: Array<{
    phaseId: string;
    graphTask: SchedTask;
    row: ProjectTask;
  }> = [];
  const eligibleDedupeKeys = new Set<string>();

  for (const graphTask of graph) {
    const phaseId = phaseIdByTaskId.get(graphTask.id);
    if (!phaseId) continue;
    const base = {
      project,
      phaseId,
      taskId: graphTask.id,
      phases,
      graphTask,
      rowByTaskId,
    };
    const row = eligibleReadyRow(base);
    if (!row?.assigneeUserId) continue;
    const entityId = taskActionEntityId(project.id, phaseId, graphTask.id);
    eligibleDedupeKeys.add(actionDedupeKey({
      kind: "task_ready",
      projectId: project.id,
      entityId,
      recipientUserId: row.assigneeUserId,
    }));
    candidates.push({ phaseId, graphTask, row });
  }

  const existing = await loadActiveReadyItems(project.id);
  await Promise.all(
    existing
      .filter((item) => !eligibleDedupeKeys.has(item.dedupeKey))
      .map((item) => closeReadyItem(item)),
  );

  let eligible = 0;
  let dispatched = 0;
  for (const candidate of candidates) {
    const result = await dispatchReadyCandidate({
      project,
      phaseId: candidate.phaseId,
      taskId: candidate.graphTask.id,
      phases,
      graphTask: candidate.graphTask,
      rowByTaskId,
      dispatchActionItem,
      notifyDeps,
    });
    eligible += result.eligible;
    dispatched += result.dispatched;
  }
  return { eligible, dispatched };
}

/**
 * 规则 2/3：一个任务真正完成后，给所有依赖已齐套的普通后继任务负责人
 * 创建“可以开始”行动项。这里绝不写后继状态；开始仍必须由负责人显式点击。
 */
export async function notifyTaskReadyActionItems(
  event: AutomationEvent,
  project: TaskReadyProject,
  deps: TaskReadyDeps = {},
): Promise<TaskReadyResult> {
  if (
    event.action !== "task.update_meta" ||
    event.entityType !== "task" ||
    stringField(event.after, "status") !== "done" ||
    stringField(event.before, "status") === "done"
  ) {
    return { eligible: 0, dispatched: 0 };
  }

  const predecessorId = completedTaskId(event);
  if (!predecessorId) return { eligible: 0, dispatched: 0 };

  const phases = getEffectivePhasesForProjectLike(project);
  const phaseIdByTaskId = new Map(
    phases.flatMap((phase) => phase.tasks.map((task) => [task.id, phase.id] as const)),
  );
  const gateTaskIds = new Set(phases.map((phase) => phase.gateTaskId).filter(Boolean));
  const {
    loadProjectTasks = getProjectTasks,
    dispatchActionItem = notifyActionItem,
    loadActiveReadyItems: _loadActiveReadyItems,
    closeReadyItem: _closeReadyItem,
    ...notifyDeps
  } = deps;
  const rows = await loadProjectTasks(project.id);
  const graph = buildOperationalProjectSchedTasks(project, rows);
  const successors = graph.filter((task) =>
    !gateTaskIds.has(task.id) && (task.dependsOn ?? []).includes(predecessorId),
  );
  if (successors.length === 0) return { eligible: 0, dispatched: 0 };
  const rowByTaskId = new Map(rows.map((task) => [task.taskId, task]));
  let eligible = 0;
  let dispatched = 0;

  for (const successor of successors) {
    const phaseId = phaseIdByTaskId.get(successor.id);
    if (!phaseId) continue;
    const result = await dispatchReadyCandidate({
      project,
      phaseId,
      taskId: successor.id,
      triggerTaskId: predecessorId,
      sourceActivityLogId: event.sourceActivityLogId ?? null,
      phases,
      graphTask: successor,
      rowByTaskId,
      dispatchActionItem,
      notifyDeps,
    });
    eligible += result.eligible;
    dispatched += result.dispatched;
  }

  return { eligible, dispatched };
}
