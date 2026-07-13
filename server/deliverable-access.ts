import type { ProjectFile, ProjectMemberRole, ProjectTask } from "../drizzle/schema";
import { canRoleContributeToDeliverable } from "../shared/deliverable-permissions";
import { getTaskEvidenceLevel } from "../shared/npd-v3";
import { SOP_TEMPLATE_VERSION_NPD_V3 } from "../shared/sop-templates";
import { getProjectById, getProjectEffectiveProcess, getProjectTasks } from "./db";
import { ROLE_PERMISSIONS } from "./routers/members";

type RolePermissions = (typeof ROLE_PERMISSIONS)[ProjectMemberRole];

type DeliverableEvidenceInput = {
  projectId: string;
  actorId: number;
  role: ProjectMemberRole;
  roles?: Iterable<ProjectMemberRole>;
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
 * 任务的「当事人」判定：已有负责人时只认该自然人；未指派时才按岗位可见性兜底。
 * qa/scm/sales/cert/battery_safety 没有 canEditTasks，但 SOP 自动把测试/采购类任务
 * 派给他们——当事人必须能完成任务/交付证据，否则这些角色的工作流死锁。
 */
export function taskAllowsEvidence(
  task: ProjectTask | undefined,
  actorId: number,
  roleOrRoles: ProjectMemberRole | Iterable<ProjectMemberRole>,
) {
  const roles = typeof roleOrRoles === "string" ? [roleOrRoles] : Array.from(roleOrRoles);
  if (!task || !roles.some((role) => role !== "viewer" && ROLE_PERMISSIONS[role]?.canViewInternalWorkspace)) return false;
  if (task.assigneeUserId != null) return task.assigneeUserId === actorId;
  const visibleRoles = (task.visibleRoles as string[] | null) ?? [];
  return visibleRoles.length > 0 && roles.some((role) => visibleRoles.includes(role));
}

export async function canMutateFileForProject(input: DeliverableEvidenceInput): Promise<boolean> {
  const { projectId, actorId, role, roles = [role], permissions, phaseId, taskId, deliverableName } = input;
  if (!deliverableName) {
    if (taskId && phaseId) {
      const [project, tasks] = await Promise.all([
        getProjectById(projectId),
        getProjectTasks(projectId, phaseId),
      ]);
      const task = tasks.find((row) => row.taskId === taskId);
      // NPD v3 重证据必须由明确的任务负责人本人上传；管理角色可查看/协助，
      // 但不能代传一份文件后替负责人完成任务。
      if (
        project?.category === "npd" &&
        project.sopTemplateVersion === SOP_TEMPLATE_VERSION_NPD_V3 &&
        getTaskEvidenceLevel(project, phaseId, taskId) === "heavy"
      ) {
        return !!task?.assigneeUserId && task.assigneeUserId === actorId;
      }
      if (permissions.canEditProjectInfo || permissions.canEditTasks) return true;
      // 与 canSubmitDeliverableEvidence 一致：未指派任务可由可见岗位执行。
      return taskAllowsEvidence(task, actorId, roles);
    }
    return permissions.canEditProjectInfo;
  }
  return canSubmitDeliverableEvidence(input);
}

export async function canSubmitDeliverableEvidence(input: DeliverableEvidenceInput): Promise<boolean> {
  const { projectId, phaseId, deliverableName, permissions, role, roles = [role], actorId, taskId, files } = input;
  if (!phaseId || !deliverableName) return false;
  if (!(await isEffectiveDeliverable(projectId, phaseId, deliverableName))) return false;
  if (permissions.canEditProjectInfo || permissions.canEditTasks) return true;
  if (!Array.from(roles).some((candidate) => candidate !== "viewer" && ROLE_PERMISSIONS[candidate]?.canViewInternalWorkspace)) return false;
  if (files?.some((file) => file.deliverableName === deliverableName && file.uploadedBy === actorId)) {
    return true;
  }
  if (Array.from(roles).some((candidate) => canRoleContributeToDeliverable(candidate, deliverableName))) return true;
  if (taskId) {
    const task = (await getProjectTasks(projectId, phaseId)).find((row) => row.taskId === taskId);
    if (taskAllowsEvidence(task, actorId, roles)) return true;
  }
  return false;
}
