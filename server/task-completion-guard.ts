import { TRPCError } from "@trpc/server";
import type { ProjectRow, ProjectTask } from "../drizzle/schema";
import {
  getEffectivePhasesForProjectLike,
  getTaskEvidenceLevel,
} from "../shared/npd-v3";
import { buildOperationalProjectSchedTasks } from "../shared/schedule-graph";
import { SOP_TEMPLATE_VERSION_NPD_V3 } from "../shared/sop-templates";
import { getProjectFiles } from "./db";

type CompletionEvidenceFile = { uploadedBy: number };

export type TaskCompletionGuardDeps = {
  loadTaskFiles?: (
    projectId: string,
    phaseId: string,
    taskId: string,
  ) => Promise<CompletionEvidenceFile[]>;
};

function taskSatisfied(task: ProjectTask | undefined): boolean {
  return !!task && (task.completed || task.status === "done" || task.status === "skipped");
}

function assertTaskExecutionUnlocked(input: {
  project: ProjectRow;
  task: ProjectTask;
  allTasks: ProjectTask[];
}): { isNpdV3: boolean } {
  const phases = getEffectivePhasesForProjectLike(input.project);
  const phaseIndex = phases.findIndex((phase) => phase.id === input.task.phaseId);
  const currentPhaseIndex = phases.findIndex((phase) => phase.id === input.project.currentPhase);
  if (phaseIndex < 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "任务不属于项目当前生效流程" });
  }
  if (currentPhaseIndex < 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "项目当前阶段配置异常，无法操作任务" });
  }
  if (phaseIndex > currentPhaseIndex) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "前置 Gate 尚未通过，未来阶段任务不能提前操作" });
  }

  const phase = phases[phaseIndex];
  if (phase.gateTaskId === input.task.taskId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Gate 任务只能通过正式评审推进" });
  }

  const isNpdV3 = input.project.category === "npd"
    && input.project.sopTemplateVersion === SOP_TEMPLATE_VERSION_NPD_V3;
  if (!isNpdV3) return { isNpdV3 };

  // 存量模板可能保留历史自定义任务；它们继续沿用原完成语义。只有 v3
  // 才以“有效模板”为单一事实源，防止 lite / 附加包被旁路或裸 taskId 混入。
  const templateTask = phase.tasks.find((task) => task.id === input.task.taskId);
  if (!templateTask) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "任务不属于项目当前生效模板" });
  }

  const taskById = new Map(input.allTasks.map((task) => [task.taskId, task]));
  const effectiveTask = buildOperationalProjectSchedTasks(input.project, input.allTasks)
    .find((task) => task.id === input.task.taskId);
  if (!effectiveTask) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "任务不属于项目当前有效依赖图" });
  }
  const unresolved = (effectiveTask.dependsOn ?? [])
    .filter((dependencyId) => !taskSatisfied(taskById.get(dependencyId)));
  if (unresolved.length > 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `前置任务尚未完成：${unresolved.join("、")}`,
    });
  }
  return { isNpdV3 };
}

/** “开始”与“完成”共用同一阶段/依赖锁。 */
export function assertTaskStartAllowed(input: {
  project: ProjectRow;
  task: ProjectTask;
  allTasks: ProjectTask[];
}): void {
  assertTaskExecutionUnlocked(input);
}

/**
 * Authoritative completion guard shared by every UI/card entry.
 * Legacy templates retain their former evidence behavior; NPD v3 enforces the
 * new light/heavy evidence contract and effective dependency graph.
 */
export async function assertTaskCompletionAllowed(input: {
  project: ProjectRow;
  task: ProjectTask;
  allTasks: ProjectTask[];
  actorId: number;
  completed: boolean;
  completionNote?: string;
}, deps: TaskCompletionGuardDeps = {}): Promise<void> {
  if (input.task.status === "skipped") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "已审批裁剪的任务只能通过撤销裁剪恢复" });
  }
  if (!input.completed) {
    // Gate 的完成态与评审记录、阶段推进是一笔业务事实，不能从普通任务入口
    // 单独撤销；需要回退时走受控阶段/Gate 流程，避免 currentPhase 与 Gate 分叉。
    const phase = getEffectivePhasesForProjectLike(input.project)
      .find((candidate) => candidate.id === input.task.phaseId);
    if (phase?.gateTaskId === input.task.taskId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Gate 状态只能通过正式评审流程维护" });
    }
    return;
  }
  const { isNpdV3 } = assertTaskExecutionUnlocked(input);
  if (!isNpdV3) return;

  const evidenceLevel = getTaskEvidenceLevel(input.project, input.task.phaseId, input.task.taskId);
  if (evidenceLevel === "light") {
    if (!input.completionNote?.trim()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "轻证据任务完成时必须填写一句话结论" });
    }
    return;
  }

  if (!input.task.assigneeUserId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "重证据任务必须先明确负责人" });
  }
  if (input.task.assigneeUserId !== input.actorId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "重证据必须由任务负责人本人上传并完成" });
  }
  const loadTaskFiles = deps.loadTaskFiles ?? getProjectFiles;
  const files = await loadTaskFiles(input.project.id, input.task.phaseId, input.task.taskId);
  if (!files.some((file) => file.uploadedBy === input.task.assigneeUserId)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先由任务负责人上传正式证据文件" });
  }
}

/**
 * Approval is a delayed completion entry, so it must re-check the current
 * phase/dependencies and persisted evidence just before the CAS to done.
 */
export async function assertTaskApprovalFinalizeAllowed(input: {
  project: ProjectRow;
  task: ProjectTask;
  allTasks: ProjectTask[];
}, deps: TaskCompletionGuardDeps = {}): Promise<void> {
  if (
    !input.task.requiresApproval ||
    input.task.status !== "pending_approval" ||
    input.task.approvalStatus !== "pending"
  ) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "任务当前不在待审批状态" });
  }
  const { isNpdV3 } = assertTaskExecutionUnlocked(input);
  if (!isNpdV3) return;

  const evidenceLevel = getTaskEvidenceLevel(input.project, input.task.phaseId, input.task.taskId);
  if (evidenceLevel === "light") {
    if (!input.task.completionNote?.trim()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "轻证据任务缺少已提交的一句话结论" });
    }
    return;
  }
  if (!input.task.assigneeUserId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "重证据任务必须先明确负责人" });
  }
  const loadTaskFiles = deps.loadTaskFiles ?? getProjectFiles;
  const files = await loadTaskFiles(input.project.id, input.task.phaseId, input.task.taskId);
  if (!files.some((file) => file.uploadedBy === input.task.assigneeUserId)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "负责人提交的重证据文件已不存在，不能通过审批" });
  }
}
