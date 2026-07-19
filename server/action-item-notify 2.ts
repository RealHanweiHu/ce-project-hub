import {
  closeActionItems,
  canReceiveProjectNotification,
  markActionItemDispatchFailed,
  markActionItemSent,
  upsertActionItem,
  type UpsertActionItemInput,
} from "./db";
import {
  buildActionCardExecutePath,
  buildProjectActionPath,
  buildTaskCompletionActionPath,
  toAbsoluteAppUrl,
} from "../shared/action-links";
import { ENV } from "./_core/env";
import type { WorkNotificationButton } from "./_core/dingtalkMessage";
import { createActionCardToken, type ActionCardTokenPayload } from "./action-card-tokens";
import { notifyPersonal, type NotifyPersonalDeps } from "./notification-gateway";
import { maybeSubmitActionExternalApproval } from "./services/action-approval-submit";
import {
  markActionItemInteractiveCardsHandled,
  type ActionCardHandledResult,
} from "./dingtalk-interactive-card-service";

export type ActionItemNotifyInput = Omit<UpsertActionItemInput, "actionUrl"> & {
  actionPath?: string;
  actionUrl?: string;
};

export async function notifyActionItem(
  input: ActionItemNotifyInput,
  deps: NotifyPersonalDeps = {},
): Promise<{ dispatched: boolean; actionItemId: number | null }> {
  if (!await canReceiveProjectNotification(input.projectId, input.recipientUserId)) {
    return { dispatched: false, actionItemId: null };
  }
  const actionUrl = input.actionUrl ?? toAbsoluteAppUrl(input.actionPath ?? "/", ENV.appBaseUrl);
  const { actionItem, shouldNotify } = await upsertActionItem({ ...input, actionUrl });
  if (!shouldNotify) return { dispatched: false, actionItemId: actionItem?.id ?? null };
  const actionButtons = await buildActionItemButtons(input, actionItem?.id ?? null).catch((error) => {
    console.warn("[action-card] failed to build action buttons (non-fatal):", error);
    return [] as WorkNotificationButton[];
  });
  const externalApproval = await maybeSubmitActionExternalApproval({
    kind: input.kind,
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    recipientUserId: input.recipientUserId,
    title: input.title,
    body: input.body ?? null,
    actionUrl,
    metadata: input.metadata,
    actionItemId: actionItem?.id ?? null,
  }).catch((error) => {
    console.warn("[approval] failed to submit external action approval (fallback to CE Hub action):", error);
    return { submitted: false } as const;
  });

  try {
    const delivery = await notifyPersonal({
      eventKey: input.kind,
      userIds: [input.recipientUserId],
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      actionUrl,
      actionButtons,
      interactiveActionItem: {
        actionItemId: actionItem?.id ?? null,
        recipientUserId: input.recipientUserId,
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
      priority: input.priority ?? "normal",
      bestEffortDingtalk: true,
      suppressDingtalk: externalApproval.submitted,
    }, deps);
    if (delivery.site + delivery.dingtalk === 0) {
      throw new Error(delivery.errors.join("；") || "行动项没有渠道实际送达");
    }
    if (actionItem) await markActionItemSent(actionItem.id);
    return { dispatched: true, actionItemId: actionItem?.id ?? null };
  } catch (error) {
    if (actionItem) {
      await markActionItemDispatchFailed(actionItem.id, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

export function taskActionEntityId(projectId: string, phaseId: string, taskId: string): string {
  return `${projectId}:${phaseId}:${taskId}`;
}

export function deliverableActionEntityId(projectId: string, phaseId: string, deliverableName: string): string {
  return `${projectId}:${phaseId}:${deliverableName}`;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function executeButton(title: string, payload: ActionCardTokenPayload): Promise<WorkNotificationButton> {
  const token = await createActionCardToken(payload);
  return {
    title,
    actionUrl: toAbsoluteAppUrl(buildActionCardExecutePath(token), ENV.appBaseUrl),
  };
}

const TWO_DAY_SNOOZE_KINDS = new Set<UpsertActionItemInput["kind"]>(["task_ready"]);

export async function buildActionItemButtons(input: ActionItemNotifyInput, actionItemId?: number | null): Promise<WorkNotificationButton[]> {
  const buttons: WorkNotificationButton[] = [];
  switch (input.kind) {
    case "task_ready": {
      const phaseId = metadataString(input.metadata, "phaseId");
      const taskId = metadataString(input.metadata, "taskId") ?? input.entityId;
      const evidenceLevel = metadataString(input.metadata, "evidenceLevel") === "heavy" ? "heavy" : "light";
      if (!phaseId || !taskId) break;
      buttons.push(await executeButton("▶开始", {
        kind: "task_start",
        userId: input.recipientUserId,
        actionItemId: actionItemId ?? undefined,
        projectId: input.projectId,
        phaseId,
        taskId,
      }));
      const evidencePath = evidenceLevel === "heavy"
        ? buildProjectActionPath({
            projectId: input.projectId,
            tab: "tasks",
            phaseId,
            taskId,
            actionItemId,
          })
        : buildTaskCompletionActionPath({
            projectId: input.projectId,
            phaseId,
            taskId,
            actionItemId,
          });
      buttons.push({
        title: evidenceLevel === "heavy" ? "📎去上传" : "✅完成",
        actionUrl: toAbsoluteAppUrl(evidencePath, ENV.appBaseUrl),
      });
      break;
    }
    case "task_approval": {
      const phaseId = metadataString(input.metadata, "phaseId");
      const taskId = metadataString(input.metadata, "taskId");
      if (!phaseId || !taskId) break;
      buttons.push(
        await executeButton("通过", {
          kind: "task_approval",
          userId: input.recipientUserId,
          actionItemId: actionItemId ?? undefined,
          projectId: input.projectId,
          phaseId,
          taskId,
          decision: "approved",
        }),
        await executeButton("驳回", {
          kind: "task_approval",
          userId: input.recipientUserId,
          actionItemId: actionItemId ?? undefined,
          projectId: input.projectId,
          phaseId,
          taskId,
          decision: "rejected",
        }),
      );
      break;
    }
    case "deliverable_review": {
      const phaseId = metadataString(input.metadata, "phaseId");
      const deliverableName = metadataString(input.metadata, "deliverableName");
      if (!phaseId || !deliverableName) break;
      buttons.push(
        await executeButton("通过", {
          kind: "deliverable_review",
          userId: input.recipientUserId,
          actionItemId: actionItemId ?? undefined,
          projectId: input.projectId,
          phaseId,
          deliverableName,
          decision: "approved",
        }),
        await executeButton("驳回", {
          kind: "deliverable_review",
          userId: input.recipientUserId,
          actionItemId: actionItemId ?? undefined,
          projectId: input.projectId,
          phaseId,
          deliverableName,
          decision: "rejected",
        }),
      );
      break;
    }
    case "issue_validation": {
      const phaseId = metadataString(input.metadata, "phaseId");
      const issueId = metadataString(input.metadata, "issueId") ?? input.entityId;
      if (!phaseId || !issueId) break;
      buttons.push(
        await executeButton("验证关闭", {
          kind: "issue_validation",
          userId: input.recipientUserId,
          actionItemId: actionItemId ?? undefined,
          projectId: input.projectId,
          phaseId,
          issueId,
          decision: "accepted",
        }),
        await executeButton("重开", {
          kind: "issue_validation",
          userId: input.recipientUserId,
          actionItemId: actionItemId ?? undefined,
          projectId: input.projectId,
          phaseId,
          issueId,
          decision: "reopened",
        }),
      );
      break;
    }
    case "delay_impact_notify": {
      const taskId = metadataString(input.metadata, "taskId") ?? input.entityId;
      const startDate = metadataString(input.metadata, "startDate") ?? undefined;
      const dueDate = metadataString(input.metadata, "dueDate") ?? undefined;
      if (!actionItemId || !taskId) break;
      buttons.push(await executeButton("确认生效", {
        kind: "delay_impact_confirm",
        userId: input.recipientUserId,
        actionItemId,
        projectId: input.projectId,
        taskId,
        startDate,
        dueDate,
      }));
      break;
    }
    case "mp_release_confirm": {
      const approvalInstanceId = Number(input.metadata?.approvalInstanceId);
      if (!actionItemId || !Number.isInteger(approvalInstanceId) || approvalInstanceId <= 0) break;
      buttons.push(await executeButton("确认发布", {
        kind: "mp_release_confirm",
        userId: input.recipientUserId,
        actionItemId,
        projectId: input.projectId,
        approvalInstanceId,
      }));
      break;
    }
    default:
      break;
  }
  if (actionItemId && (input.level ?? "owner") === "owner") {
    const twoDaySnooze = TWO_DAY_SNOOZE_KINDS.has(input.kind);
    buttons.push(await executeButton(twoDaySnooze ? "⏰延两天" : "明早处理", {
      kind: "action_item_snooze",
      userId: input.recipientUserId,
      actionItemId,
      until: twoDaySnooze ? "in_2_days" : "tomorrow_morning",
    }));
  }
  return buttons;
}

export function actionDedupeKey(input: {
  kind: UpsertActionItemInput["kind"];
  projectId: string;
  entityId: string;
  recipientUserId: number;
  level?: UpsertActionItemInput["level"];
}): string {
  return `${input.kind}:${input.projectId}:${input.entityId}:${input.recipientUserId}:${input.level ?? "owner"}`;
}

/** Close the system action item and the already-delivered DingTalk card together. */
export async function closeActionItemsWithCards(
  input: Parameters<typeof closeActionItems>[0],
  result: ActionCardHandledResult,
  deps: {
    markHandled?: typeof markActionItemInteractiveCardsHandled;
  } = {},
): Promise<number[]> {
  const ids = await closeActionItems(input);
  const markHandled = deps.markHandled ?? markActionItemInteractiveCardsHandled;
  await Promise.all(ids.map((id) => markHandled(id, result).catch((error) => {
    console.warn("[dingtalk] failed to close action-item interactive card:", error);
  })));
  return ids;
}

export { closeActionItems };
