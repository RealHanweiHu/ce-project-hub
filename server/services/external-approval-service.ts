import {
  createActivityLog,
  createExternalApprovalInstance,
  getApprovalConfig,
  getExternalApprovalById,
  getExternalApprovalByProcessInstanceId,
  getOpenP0P1Count,
  getPendingExternalApproval,
  getProductById,
  getProjectById,
  getReleaseGateStatus,
  getUserById,
  isReleaseOverrideAuthorized,
  listExternalApprovalsForEntity,
  releaseProject,
  setUserDingtalkCorpId,
  updateExternalApprovalInstance,
} from "../db";
import type { ExternalApprovalInstance } from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";
import { actionDedupeKey, closeActionItems, notifyActionItem } from "../action-item-notify";
import { resolveDingtalkCorpUserId } from "../_core/dingtalk";
import {
  buildApprovalForm,
  createApprovalInstance,
  getApprovalInstance,
  type NormalizedApprovalStatus,
} from "../_core/dingtalkApproval";
import { buildProjectActionPath } from "../../shared/action-links";
import { cancelAndRecordProjectMeeting } from "./project-meeting-lifecycle";
import { applyActionExternalApproval } from "./action-approval-apply";
import { isActionExternalApprovalType } from "./action-approval-submit";

export const MP_RELEASE_APPROVAL = "mp_release";

type ReleaseOverrideInput = { overrideReason: string; followUpOwner: number; dueDate: string };
type Actor = { id: number; role: string };

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function getReleaseApprovalSnapshot(input: {
  projectId: string;
  actor: Actor;
  override?: ReleaseOverrideInput;
}) {
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("项目不存在");
  const canReleaseActor = await isReleaseOverrideAuthorized(project, input.actor);
  if (!canReleaseActor) throw new Error("无权限发起量产发布审批");

  const product = project.productId ? await getProductById(project.productId) : undefined;
  const openP0P1 = await getOpenP0P1Count(input.projectId);
  const gate = await getReleaseGateStatus(project);
  const failedHardDimensions = gate.dimensions.filter((d) => !d.ok && d.dimension !== "review_conditions");
  const blockers: string[] = [];
  if (!project.productId) blockers.push("未关联产品");
  if (openP0P1 > 0) blockers.push(`${openP0P1} 个未关闭的 P0/P1 问题`);
  if (!gate.phaseId) blockers.push("未定义 MP Release 前置 Gate");
  for (const dim of failedHardDimensions) blockers.push(dim.summary);
  if (gate.decision === null) blockers.push("前置 Gate 无评审记录");
  if (gate.decision === "rejected") blockers.push("前置 Gate 已驳回");
  if (blockers.length > 0) throw new Error(`当前不可发起发布审批：${blockers.join("；")}`);

  if (gate.decision === "conditional") {
    const override = input.override;
    if (!override?.overrideReason?.trim() || !override.followUpOwner || !override.dueDate?.trim()) {
      throw new Error("前置 Gate 为有条件通过，发起审批需填写理由、跟进负责人与截止日期");
    }
  }

  return {
    project,
    product,
    gate,
    snapshot: {
      "业务类型": "MP Release",
      "项目名称": project.name,
      "项目编号": project.projectNumber,
      "关联产品": product?.name ?? project.productId ?? "",
      "前置Gate": gate.gateName,
      "Gate决策": gate.decision ?? "",
      "Gate条件": gate.conditions ?? "",
      "强制发布理由": input.override?.overrideReason ?? "",
      "条件跟进人": input.override?.followUpOwner ?? "",
      "跟进截止日": input.override?.dueDate ?? "",
    },
  };
}

export async function submitReleaseApproval(input: {
  projectId: string;
  actor: Actor;
  override?: ReleaseOverrideInput;
}): Promise<{ instance: ExternalApprovalInstance; alreadyPending: boolean }> {
  const config = await getApprovalConfig(MP_RELEASE_APPROVAL);
  if (!config?.enabled || !config.processCode?.trim()) {
    throw new Error("未启用 MP Release 钉钉审批模板");
  }

  const pending = await getPendingExternalApproval({
    businessType: MP_RELEASE_APPROVAL,
    entityType: "project",
    entityId: input.projectId,
  });
  if (pending) return { instance: pending, alreadyPending: true };

  const originator = await getUserById(input.actor.id);
  if (!originator) throw new Error("发起人不存在");
  const dingtalkOriginatorUserId = await resolveDingtalkCorpUserId(originator, setUserDingtalkCorpId);
  if (!dingtalkOriginatorUserId) throw new Error("发起人未配置可匹配钉钉的手机号");

  const { project, snapshot } = await getReleaseApprovalSnapshot(input);
  const formComponentValues = buildApprovalForm(MP_RELEASE_APPROVAL, snapshot);
  const instance = await createExternalApprovalInstance({
    businessType: MP_RELEASE_APPROVAL,
    entityType: "project",
    entityId: input.projectId,
    projectId: input.projectId,
    processCode: config.processCode,
    title: `MP Release审批：${project.name}`,
    submittedBy: input.actor.id,
    originatorUserId: input.actor.id,
    dingtalkOriginatorUserId,
    formSnapshot: snapshot,
    requestSnapshot: { formComponentValues, override: input.override ?? null },
  });

  const created = await createApprovalInstance({
    processCode: config.processCode,
    originatorUserId: dingtalkOriginatorUserId,
    deptId: config.defaultDeptId,
    formComponentValues,
  });
  if (!created.ok) {
    // 钉钉不可用不阻塞业务：实例落库为 sync_failed 返回，前端提示后可重新发起
    // （getPendingExternalApproval 只匹配 pending，失败实例不会卡住重发）
    const failed = await updateExternalApprovalInstance(instance.id, { status: "sync_failed", lastError: created.error });
    return { instance: failed ?? instance, alreadyPending: false };
  }

  const updated = await updateExternalApprovalInstance(instance.id, {
    processInstanceId: created.data.processInstanceId,
    responseSnapshot: toRecord(created.raw),
    syncedAt: new Date(),
    lastError: null,
  });
  await createActivityLog({
    projectId: input.projectId,
    userId: input.actor.id,
    action: "approval.submit",
    entityType: "external_approval",
    entityId: String(instance.id),
    meta: { businessType: MP_RELEASE_APPROVAL, processInstanceId: created.data.processInstanceId },
  });
  return { instance: updated ?? instance, alreadyPending: false };
}

async function enqueueReleaseConfirmation(instance: ExternalApprovalInstance): Promise<void> {
  const project = await getProjectById(instance.entityId);
  if (!project) throw new Error("项目不存在，无法生成发布确认");
  await createActivityLog({
    projectId: instance.entityId,
    userId: instance.submittedBy,
    action: "approval.approve",
    entityType: "external_approval",
    entityId: String(instance.id),
    meta: { businessType: instance.businessType, processInstanceId: instance.processInstanceId },
  });
  await notifyActionItem({
    kind: "mp_release_confirm",
    projectId: instance.entityId,
    entityType: "external_approval",
    entityId: String(instance.id),
    dedupeKey: actionDedupeKey({
      kind: "mp_release_confirm",
      entityId: String(instance.id),
      recipientUserId: instance.submittedBy,
    }),
    recipientUserId: instance.submittedBy,
    title: "MP Release 待确认发布",
    body: `钉钉审批已通过，系统已备齐「${project.name}」发布链，请确认发布。`,
    actionPath: buildProjectActionPath({ projectId: instance.entityId, tab: "approval" }),
    priority: "critical",
    metadata: {
      approvalInstanceId: instance.id,
      processInstanceId: instance.processInstanceId,
      projectId: instance.entityId,
    },
  });
}

export async function confirmApprovedRelease(input: {
  approvalInstanceId: number;
  actorId: number;
}): Promise<{ revisionId: number; revisionLabel: string }> {
  const instance = await getExternalApprovalById(input.approvalInstanceId);
  if (!instance) throw new Error("审批实例不存在");
  if (instance.businessType !== MP_RELEASE_APPROVAL) throw new Error("不是 MP Release 审批实例");
  if (instance.status !== "approved") throw new Error("审批尚未通过，不能发布");
  if (instance.submittedBy !== input.actorId) throw new Error("仅审批发起人可确认发布");

  const actor = await getUserById(input.actorId);
  if (!actor) throw new Error("发布确认人不存在");
  const request = toRecord(instance.requestSnapshot);
  const override = request.override as ReleaseOverrideInput | null | undefined;
  const project = await getProjectById(instance.entityId);
  const product = project?.productId ? await getProductById(project.productId) : undefined;
  const result = await releaseProject({
    projectId: instance.entityId,
    actor: { id: actor.id, role: actor.role },
    override: override ?? undefined,
    externalApprovalInstanceId: instance.id,
  });
  if (project && (project.dingtalkEventId || (project.meetingConfig as { enabled?: boolean } | null)?.enabled)) {
    try { await cancelAndRecordProjectMeeting(project); }
    catch (error) { console.warn("[meeting] cancel on approved release failed (non-fatal):", error); }
  }
  await closeActionItems({
    kind: "mp_release_confirm",
    entityType: "external_approval",
    entityId: String(instance.id),
    recipientUserId: input.actorId,
  });
  await createActivityLog({
    projectId: instance.entityId,
    userId: actor.id,
    action: "mp.release",
    entityType: "mp_release",
    entityId: `${instance.entityId}:${result.revisionId}`,
    meta: {
      after: {
        projectId: instance.entityId,
        productId: project?.productId ?? null,
        productName: product?.name ?? null,
        revisionId: result.revisionId,
        revisionLabel: result.revisionLabel,
      },
      externalApprovalInstanceId: instance.id,
    },
  });
  await emitAutomationEvent({
    action: "mp.release",
    projectId: instance.entityId,
    entityType: "mp_release",
    entityId: `${instance.entityId}:${result.revisionId}`,
    actorId: actor.id,
    after: {
      projectId: instance.entityId,
      productId: project?.productId ?? null,
      productName: product?.name ?? null,
      revisionId: result.revisionId,
      revisionLabel: result.revisionLabel,
    },
  });
  return result;
}

async function markTerminal(instance: ExternalApprovalInstance, status: NormalizedApprovalStatus, detail: Record<string, unknown>) {
  const now = new Date();
  await updateExternalApprovalInstance(instance.id, {
    status,
    responseSnapshot: detail,
    syncedAt: now,
    approvedAt: status === "approved" ? now : undefined,
    rejectedAt: status === "rejected" ? now : undefined,
    terminatedAt: status === "terminated" ? now : undefined,
    lastError: null,
  });
  if (status === "rejected" || status === "terminated") {
    await createActivityLog({
      projectId: instance.projectId ?? instance.entityId,
      userId: instance.submittedBy,
      action: status === "rejected" ? "approval.reject" : "approval.terminate",
      entityType: "external_approval",
      entityId: String(instance.id),
      meta: { businessType: instance.businessType, processInstanceId: instance.processInstanceId },
    });
  }
}

async function applyTerminalBusiness(
  instance: ExternalApprovalInstance,
  status: Extract<NormalizedApprovalStatus, "approved" | "rejected">,
): Promise<void> {
  try {
    if (instance.businessType === MP_RELEASE_APPROVAL && status === "approved") {
      await enqueueReleaseConfirmation(instance);
      return;
    }
    if (isActionExternalApprovalType(instance.businessType)) {
      await applyActionExternalApproval(instance, status);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateExternalApprovalInstance(instance.id, { status: "business_blocked", lastError: message, syncedAt: new Date() });
    await createActivityLog({
      projectId: instance.projectId ?? instance.entityId,
      userId: instance.submittedBy,
      action: "approval.business_blocked",
      entityType: "external_approval",
      entityId: String(instance.id),
      meta: { businessType: instance.businessType, error: message },
    });
  }
}

export async function syncExternalApprovalByProcessInstanceId(
  processInstanceId: string,
): Promise<ExternalApprovalInstance | undefined> {
  const instance = await getExternalApprovalByProcessInstanceId(processInstanceId);
  if (!instance) return undefined;
  if (!["pending", "sync_failed"].includes(instance.status)) return instance;

  const detail = await getApprovalInstance(processInstanceId);
  if (!detail.ok) {
    return updateExternalApprovalInstance(instance.id, { status: "sync_failed", lastError: detail.error, syncedAt: new Date() });
  }

  const status = detail.data.status;
  if (status === "pending") {
    return updateExternalApprovalInstance(instance.id, {
      status: "pending",
      responseSnapshot: detail.data.detail,
      syncedAt: new Date(),
      lastError: null,
    });
  }

  if (status === "approved") {
    await markTerminal(instance, "approved", detail.data.detail);
    await applyTerminalBusiness(instance, "approved");
  } else {
    await markTerminal(instance, status, detail.data.detail);
    if (status === "rejected") await applyTerminalBusiness(instance, "rejected");
  }

  return getExternalApprovalByProcessInstanceId(processInstanceId);
}

export function listReleaseApprovals(projectId: string) {
  return listExternalApprovalsForEntity({ businessType: MP_RELEASE_APPROVAL, entityType: "project", entityId: projectId });
}
