import type { ExternalApprovalInstance, ProjectIssue } from "../../drizzle/schema";
import type { NormalizedApprovalStatus } from "../_core/dingtalkApproval";
import {
  createActivityLog,
  decideTaskApproval,
  getProjectIssues,
  getProjectTasks,
  updateProjectIssue,
} from "../db";
import {
  actionDedupeKey,
  closeActionItems,
  notifyActionItem,
  taskActionEntityId,
} from "../action-item-notify";
import { reviewDeliverable } from "../deliverable-review-service";
import { notifyGateReadyIfReady } from "../gate-ready-notify";
import { emitAutomationEvent } from "../automation/events";
import { buildProjectActionPath } from "../../shared/action-links";
import { taskDisplayTitle } from "../task-title";
import { isActionExternalApprovalType, type ActionExternalApprovalType } from "./action-approval-submit";

type ActionApprovalPayload = {
  kind: ActionExternalApprovalType;
  projectId: string;
  entityType: string;
  entityId: string;
  recipientUserId: number;
  actionItemId?: number | null;
  metadata: Record<string, unknown>;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function parseActionPayload(instance: ExternalApprovalInstance): ActionApprovalPayload | null {
  const request = toRecord(instance.requestSnapshot);
  const action = toRecord(request.action);
  const kind = typeof action.kind === "string" ? action.kind : instance.businessType;
  if (!isActionExternalApprovalType(kind)) return null;
  const projectId = typeof action.projectId === "string" && action.projectId ? action.projectId : instance.projectId;
  const recipientUserId = positiveInt(action.recipientUserId);
  if (!projectId || !recipientUserId) return null;
  return {
    kind,
    projectId,
    entityType: typeof action.entityType === "string" && action.entityType ? action.entityType : instance.entityType,
    entityId: typeof action.entityId === "string" && action.entityId ? action.entityId : instance.entityId,
    recipientUserId,
    actionItemId: positiveInt(action.actionItemId),
    metadata: toRecord(action.metadata),
  };
}

async function applyTaskApproval(payload: ActionApprovalPayload, status: Extract<NormalizedApprovalStatus, "approved" | "rejected">) {
  const phaseId = metadataString(payload.metadata, "phaseId");
  const taskId = metadataString(payload.metadata, "taskId");
  if (!phaseId || !taskId) throw new Error("任务审批回调缺少 phaseId/taskId");
  const tasks = await getProjectTasks(payload.projectId, phaseId);
  const task = tasks.find((item) => item.taskId === taskId);
  const decision = status === "approved" ? "approved" : "rejected";
  await decideTaskApproval(payload.projectId, phaseId, taskId, decision, payload.recipientUserId, "钉钉审批回调", false);
  const entityId = taskActionEntityId(payload.projectId, phaseId, taskId);
  await closeActionItems({ kind: "task_approval", entityType: "task", entityId });
  if (decision === "rejected" && task?.approvalRequestedBy) {
    await notifyActionItem({
      kind: "task_rework",
      projectId: payload.projectId,
      entityType: "task",
      entityId,
      dedupeKey: actionDedupeKey({ kind: "task_rework", entityId, recipientUserId: task.approvalRequestedBy }),
      recipientUserId: task.approvalRequestedBy,
      title: "任务审批被驳回",
      body: `「${taskDisplayTitle(task)}」钉钉审批未通过。`,
      actionPath: buildProjectActionPath({
        projectId: payload.projectId,
        tab: "tasks",
        phaseId,
        taskId,
        taskTab: "approval",
      }),
      priority: task.priority === "critical" ? "critical" : "high",
      metadata: { phaseId, taskId, rejectedBy: payload.recipientUserId },
    });
  } else if (decision === "approved") {
    await notifyGateReadyIfReady({
      projectId: payload.projectId,
      phaseId,
      actorId: payload.recipientUserId,
      reason: "task.external_approval.approve",
    });
  }
}

async function applyDeliverableReview(payload: ActionApprovalPayload, status: Extract<NormalizedApprovalStatus, "approved" | "rejected">) {
  const phaseId = metadataString(payload.metadata, "phaseId");
  const deliverableName = metadataString(payload.metadata, "deliverableName");
  if (!phaseId || !deliverableName) throw new Error("交付物审批回调缺少 phaseId/deliverableName");
  await reviewDeliverable({
    projectId: payload.projectId,
    phaseId,
    deliverableName,
    decision: status === "approved" ? "approved" : "rejected",
    reviewedBy: payload.recipientUserId,
    note: "钉钉审批回调",
  });
}

function isGateBlockingCriticalIssue(issue: Pick<ProjectIssue, "severity" | "status">): boolean {
  return (issue.severity === "P0" || issue.severity === "P1")
    && (issue.status === "open" || issue.status === "in_progress" || issue.status === "resolved");
}

async function applyIssueValidation(payload: ActionApprovalPayload, status: Extract<NormalizedApprovalStatus, "approved" | "rejected">) {
  const issueId = positiveInt(metadataString(payload.metadata, "issueId") ?? payload.entityId);
  if (!issueId) throw new Error("问题验证回调缺少 issueId");
  const issue = (await getProjectIssues(payload.projectId)).find((item) => item.id === issueId);
  if (!issue) throw new Error("问题不存在");
  const patch = status === "approved"
    ? {
        status: "closed" as const,
        verifiedBy: payload.recipientUserId,
        verifiedAt: new Date(),
        closedDate: new Date().toISOString().slice(0, 10),
      }
    : {
        status: "in_progress" as const,
        verifiedBy: null,
        verifiedAt: null,
      };
  await updateProjectIssue(issueId, patch);
  const afterIssue = { ...issue, ...patch } as ProjectIssue;
  await createActivityLog({
    projectId: payload.projectId,
    userId: payload.recipientUserId,
    action: status === "approved" ? "issue.close" : "issue.update",
    entityType: "issue",
    entityId: String(issueId),
    meta: {
      source: "dingtalk_approval",
      patch,
      before: issue as unknown as Record<string, unknown>,
      after: afterIssue as unknown as Record<string, unknown>,
    },
  });
  await emitAutomationEvent({
    action: "issue.update",
    projectId: payload.projectId,
    entityType: "issue",
    entityId: issueId,
    actorId: payload.recipientUserId,
    before: issue as unknown as Record<string, unknown>,
    after: afterIssue as unknown as Record<string, unknown>,
  });
  await closeActionItems({ kind: "issue_validation", entityType: "issue", entityId: String(issueId) });
  if (isGateBlockingCriticalIssue(issue) && !isGateBlockingCriticalIssue(afterIssue)) {
    await notifyGateReadyIfReady({
      projectId: payload.projectId,
      phaseId: afterIssue.phaseId,
      actorId: payload.recipientUserId,
      reason: "issue.external_validation.unblock",
    });
  }
}

export async function applyActionExternalApproval(
  instance: ExternalApprovalInstance,
  status: Extract<NormalizedApprovalStatus, "approved" | "rejected">,
): Promise<void> {
  const payload = parseActionPayload(instance);
  if (!payload) return;
  switch (payload.kind) {
    case "task_approval":
      await applyTaskApproval(payload, status);
      break;
    case "deliverable_review":
      await applyDeliverableReview(payload, status);
      break;
    case "issue_validation":
      await applyIssueValidation(payload, status);
      break;
  }
}
