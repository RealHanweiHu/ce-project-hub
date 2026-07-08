import {
  createActivityLog,
  createExternalApprovalInstance,
  getApprovalConfig,
  getPendingExternalApproval,
  getUserById,
  setUserDingtalkCorpId,
  updateExternalApprovalInstance,
} from "../db";
import type { ExternalApprovalInstance } from "../../drizzle/schema";
import { resolveDingtalkCorpUserId } from "../_core/dingtalk";
import { buildApprovalForm, createApprovalInstance } from "../_core/dingtalkApproval";

export const ACTION_EXTERNAL_APPROVAL_TYPES = [
  "task_approval",
  "deliverable_review",
  "issue_validation",
] as const;

export type ActionExternalApprovalType = (typeof ACTION_EXTERNAL_APPROVAL_TYPES)[number];

export function isActionExternalApprovalType(kind: string): kind is ActionExternalApprovalType {
  return (ACTION_EXTERNAL_APPROVAL_TYPES as readonly string[]).includes(kind);
}

type SubmitResult =
  | { submitted: true; instance: ExternalApprovalInstance; alreadyPending: boolean }
  | { submitted: false; instance?: ExternalApprovalInstance; error?: string };

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | null {
  const value = metadata?.[key];
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function businessLabel(kind: ActionExternalApprovalType): string {
  switch (kind) {
    case "task_approval": return "任务审批";
    case "deliverable_review": return "交付物审核";
    case "issue_validation": return "问题验证";
  }
}

function submittedByFor(input: {
  kind: ActionExternalApprovalType;
  recipientUserId: number;
  metadata?: Record<string, unknown>;
}): number {
  const key = input.kind === "task_approval"
    ? "requestedBy"
    : input.kind === "deliverable_review"
      ? "submittedBy"
      : "resolvedBy";
  return metadataNumber(input.metadata, key) ?? input.recipientUserId;
}

export async function maybeSubmitActionExternalApproval(input: {
  kind: string;
  projectId: string;
  entityType: string;
  entityId: string;
  recipientUserId: number;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
  actionItemId?: number | null;
}): Promise<SubmitResult> {
  if (!isActionExternalApprovalType(input.kind)) return { submitted: false };
  const config = await getApprovalConfig(input.kind);
  if (!config?.enabled || !config.processCode?.trim()) return { submitted: false };

  const pending = await getPendingExternalApproval({
    businessType: input.kind,
    entityType: input.entityType,
    entityId: input.entityId,
  });
  if (pending) return { submitted: true, instance: pending, alreadyPending: true };

  const submittedBy = submittedByFor({
    kind: input.kind,
    recipientUserId: input.recipientUserId,
    metadata: input.metadata,
  });
  const originator = await getUserById(submittedBy);
  if (!originator) return { submitted: false, error: "外部审批发起人不存在" };
  const dingtalkOriginatorUserId = await resolveDingtalkCorpUserId(originator, setUserDingtalkCorpId);
  if (!dingtalkOriginatorUserId) return { submitted: false, error: "外部审批发起人未匹配钉钉 userid" };

  const snapshot = {
    "业务类型": businessLabel(input.kind),
    "标题": input.title,
    "说明": input.body ?? "",
    "项目ID": input.projectId,
    "对象类型": input.entityType,
    "对象ID": input.entityId,
    "处理人ID": input.recipientUserId,
    "行动项ID": input.actionItemId ?? "",
    "阶段": metadataString(input.metadata, "phaseId") ?? "",
    "任务ID": metadataString(input.metadata, "taskId") ?? "",
    "交付物": metadataString(input.metadata, "deliverableName") ?? "",
    "问题ID": metadataString(input.metadata, "issueId") ?? "",
    "直达链接": input.actionUrl ?? "",
  };
  const formComponentValues = buildApprovalForm(input.kind, snapshot);
  const instance = await createExternalApprovalInstance({
    businessType: input.kind,
    entityType: input.entityType,
    entityId: input.entityId,
    projectId: input.projectId,
    processCode: config.processCode,
    title: input.title,
    submittedBy,
    originatorUserId: submittedBy,
    dingtalkOriginatorUserId,
    formSnapshot: snapshot,
    requestSnapshot: {
      action: {
        kind: input.kind,
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
        recipientUserId: input.recipientUserId,
        actionItemId: input.actionItemId ?? null,
        metadata: input.metadata ?? {},
      },
      formComponentValues,
    },
  });

  const created = await createApprovalInstance({
    processCode: config.processCode,
    originatorUserId: dingtalkOriginatorUserId,
    deptId: config.defaultDeptId,
    formComponentValues,
  });
  if (!created.ok) {
    const failed = await updateExternalApprovalInstance(instance.id, {
      status: "sync_failed",
      lastError: created.error,
      syncedAt: new Date(),
    });
    return { submitted: false, instance: failed ?? instance, error: created.error };
  }

  const updated = await updateExternalApprovalInstance(instance.id, {
    processInstanceId: created.data.processInstanceId,
    responseSnapshot: created.raw && typeof created.raw === "object" && !Array.isArray(created.raw)
      ? created.raw as Record<string, unknown>
      : {},
    syncedAt: new Date(),
    lastError: null,
  });
  await createActivityLog({
    projectId: input.projectId,
    userId: submittedBy,
    action: "approval.submit",
    entityType: "external_approval",
    entityId: String(instance.id),
    meta: { businessType: input.kind, processInstanceId: created.data.processInstanceId },
  });
  return { submitted: true, instance: updated ?? instance, alreadyPending: false };
}
