import {
  listActionItemsForSla as defaultListItems,
  markActionItemSent as defaultMarkSent,
  patchActionItemMetadata as defaultPatchItem,
  type ActionItemSlaRow,
} from "../db";
import {
  actionDedupeKey,
  notifyActionItem as defaultNotifyActionItem,
  type ActionItemNotifyInput,
} from "../action-item-notify";
import { notifyPersonal, type NotifyPersonalDeps } from "../notification-gateway";
import {
  getActionItemSlaPolicy,
  hoursElapsedSince,
  type ActionItemSlaMetadata,
} from "../../shared/action-item-sla";

export type ActionItemSlaTransition = "owner_reminder" | "pm_escalation" | "manager_escalation";

export type ActionItemSlaDeps = NotifyPersonalDeps & {
  listItems?: () => Promise<ActionItemSlaRow[]>;
  patchItem?: (id: number, patch: Record<string, unknown>, status?: "escalated") => Promise<void>;
  markSent?: (id: number) => Promise<void>;
  notifyActionItem?: (input: ActionItemNotifyInput) => Promise<{ dispatched: boolean; actionItemId: number | null }>;
};

export function nextActionItemSlaTransition(item: ActionItemSlaRow, now: Date): ActionItemSlaTransition | null {
  const policy = getActionItemSlaPolicy(item.kind);
  const metadata = item.metadata as ActionItemSlaMetadata | null;
  if (!metadata?.ownerRemindedAt) {
    const startedAt = item.lastSentAt ?? item.firstSentAt ?? item.createdAt;
    return hoursElapsedSince(now, startedAt) >= policy.remindOwnerAfterHours
      ? "owner_reminder"
      : null;
  }
  if (!metadata.pmEscalatedAt && !metadata.pmEscalationSkipped) {
    return hoursElapsedSince(now, metadata.ownerRemindedAt) >= policy.escalatePmAfterHours
      ? "pm_escalation"
      : null;
  }
  if (!metadata.managerEscalatedAt && !metadata.managerEscalationSkipped) {
    const from = metadata.pmEscalatedAt ?? metadata.ownerRemindedAt;
    return hoursElapsedSince(now, from) >= policy.escalateManagerAfterHours
      ? "manager_escalation"
      : null;
  }
  return null;
}

export async function runActionItemSlaScan(now = new Date(), deps: ActionItemSlaDeps = {}): Promise<void> {
  const listItems = deps.listItems ?? defaultListItems;
  const items = await listItems();
  for (const item of items) {
    const transition = nextActionItemSlaTransition(item, now);
    if (!transition) continue;
    if (transition === "owner_reminder") {
      await remindOwner(item, now, deps);
    } else if (transition === "pm_escalation") {
      await escalateToPm(item, now, deps);
    } else {
      await escalateToManager(item, now, deps);
    }
  }
}

async function remindOwner(item: ActionItemSlaRow, now: Date, deps: ActionItemSlaDeps): Promise<void> {
  await notifyPersonal({
    eventKey: item.kind,
    userIds: [item.recipientUserId],
    title: `SLA提醒：${item.title}`,
    body: `${item.projectName} · ${item.body ?? "行动项超时未处理"}`,
    entityType: item.entityType,
    entityId: item.entityId,
    actionUrl: item.actionUrl,
    bestEffortDingtalk: true,
  }, deps);
  const markSent = deps.markSent ?? defaultMarkSent;
  await markSent(item.id);
  const patchItem = deps.patchItem ?? defaultPatchItem;
  await patchItem(item.id, {
    slaStage: "owner_reminded",
    ownerRemindedAt: now.toISOString(),
  });
}

async function escalateToPm(item: ActionItemSlaRow, now: Date, deps: ActionItemSlaDeps): Promise<void> {
  const patchItem = deps.patchItem ?? defaultPatchItem;
  if (!item.pmUserId || item.pmUserId === item.recipientUserId) {
    await patchItem(item.id, {
      slaStage: "pm_escalated",
      pmEscalationSkipped: item.pmUserId ? "same_recipient" : "missing_pm",
      pmEscalatedAt: now.toISOString(),
    }, "escalated");
    return;
  }
  await createEscalationAction(item, item.pmUserId, "pm", now, deps);
  await patchItem(item.id, {
    slaStage: "pm_escalated",
    pmEscalatedAt: now.toISOString(),
  }, "escalated");
}

async function escalateToManager(item: ActionItemSlaRow, now: Date, deps: ActionItemSlaDeps): Promise<void> {
  const patchItem = deps.patchItem ?? defaultPatchItem;
  const managerUserId = item.managerUserIds.find((id) => id !== item.recipientUserId && id !== item.pmUserId)
    ?? item.managerUserIds.find((id) => id !== item.recipientUserId)
    ?? null;
  if (!managerUserId) {
    await patchItem(item.id, {
      slaStage: "manager_escalated",
      managerEscalationSkipped: "missing_manager",
      managerEscalatedAt: now.toISOString(),
    }, "escalated");
    return;
  }
  await createEscalationAction(item, managerUserId, "manager", now, deps);
  await patchItem(item.id, {
    slaStage: "manager_escalated",
    managerEscalatedAt: now.toISOString(),
  }, "escalated");
}

async function createEscalationAction(
  item: ActionItemSlaRow,
  recipientUserId: number,
  level: "pm" | "manager",
  now: Date,
  deps: ActionItemSlaDeps,
): Promise<void> {
  const policy = getActionItemSlaPolicy(item.kind);
  const notifyActionItem = deps.notifyActionItem ?? ((input: ActionItemNotifyInput) => defaultNotifyActionItem(input, deps));
  await notifyActionItem({
    kind: item.kind,
    projectId: item.projectId,
    entityType: item.entityType,
    entityId: item.entityId,
    dedupeKey: actionDedupeKey({ kind: item.kind, entityId: item.entityId, recipientUserId, level }),
    recipientUserId,
    level,
    title: level === "pm" ? `SLA升级：${item.title}` : `管理层红名单：${item.title}`,
    body: `${item.projectName}（${item.projectNumber}）的${policy.label}已超时未处理。`,
    actionUrl: item.actionUrl,
    priority: item.priority,
    metadata: {
      escalatedFromActionItemId: item.id,
      originalRecipientUserId: item.recipientUserId,
      slaLevel: level,
      escalatedAt: now.toISOString(),
    },
  });
}
