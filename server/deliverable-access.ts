import type { ProjectFile, ProjectMemberRole, ProjectTask } from "../drizzle/schema";
import { canRoleContributeToDeliverable } from "../shared/deliverable-permissions";
import { getProjectEffectiveProcess, getProjectTasks } from "./db";
import { ROLE_PERMISSIONS } from "./routers/members";

type RolePermissions = (typeof ROLE_PERMISSIONS)[ProjectMemberRole];

type DeliverableEvidenceInput = {
  projectId: string;
  actorId: number;
  role: ProjectMemberRole;
  permissions: RolePermissions;
  phaseId?: string | null;
  taskId?: string | null;
  deliverableName?: string | null;
  files?: Pick<ProjectFile, "uploadedBy" | "deliverableName">[];
};

async function isEffectiveDeliverable(projectId: string, phaseId: string, deliverableName: string) {
  const effective = await getProjectEffectiveProcess(projectId);
  const effPhase = effective?.phases.find((phase) => phase.id === phaseId);
  return !!effPhase && effPhase.submittedDeliverables.includes(deliverableName);
}

/**
 * 任务的「当事人」判定：被指派人，或任务对其角色可见（viewer 除外）。
 * qa/scm/sales/cert/battery_safety 没有 canEditTasks，但 SOP 自动把测试/采购类任务
 * 派给他们——当事人必须能完成任务/交付证据，否则这些角色的工作流死锁。
 */
export function taskAllowsEvidence(task: ProjectTask | undefined, actorId: number, role: ProjectMemberRole) {
  if (!task || role === "viewer") return false;
  if (task.assigneeUserId != null && task.assigneeUserId === actorId) return true;
  const visibleRoles = (task.visibleRoles as string[] | null) ?? [];
  return visibleRoles.length > 0 && visibleRoles.includes(role);
}

export async function canMutateFileForProject(input: DeliverableEvidenceInput): Promise<boolean> {
  const { projectId, actorId, role, permissions, phaseId, taskId, deliverableName } = input;
  if (!deliverableName) {
    if (permissions.canEditProjectInfo || (!!taskId && permissions.canEditTasks)) return true;
    // 与 canSubmitDeliverableEvidence 一致：任务当事人也可以传普通任务附件
    if (taskId && phaseId) {
      const task = (await getProjectTasks(projectId, phaseId)).find((row) => row.taskId === taskId);
      return taskAllowsEvidence(task, actorId, role);
    }
    return false;
  }
  return canSubmitDeliverableEvidence(input);
}

export async function canSubmitDeliverableEvidence(input: DeliverableEvidenceInput): Promise<boolean> {
  const { projectId, phaseId, deliverableName, permissions, role, actorId, taskId, files } = input;
  if (!phaseId || !deliverableName) return false;
  if (!(await isEffectiveDeliverable(projectId, phaseId, deliverableName))) return false;
  if (permissions.canEditProjectInfo || permissions.canEditTasks) return true;
  if (role === "viewer") return false;
  if (files?.some((file) => file.deliverableName === deliverableName && file.uploadedBy === actorId)) {
    return true;
  }
  if (canRoleContributeToDeliverable(role, deliverableName)) return true;
  if (taskId) {
    const task = (await getProjectTasks(projectId, phaseId)).find((row) => row.taskId === taskId);
    if (taskAllowsEvidence(task, actorId, role)) return true;
  }
  return false;
}
