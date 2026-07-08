import {
  getUserById,
  listDingtalkInteractiveCardsForActionItem,
  markDingtalkInteractiveCardStatus,
  setUserDingtalkCorpId,
  upsertDingtalkInteractiveCard,
} from "./db";
import {
  buildHandledActionCardParams,
  buildPendingActionCardParams,
  createAndDeliverInteractiveCard,
  isDingtalkInteractiveCardConfigured,
  updateInteractiveCard,
} from "./_core/dingtalkInteractiveCard";
import { resolveDingtalkCorpUserId } from "./_core/dingtalk";
import type { WorkNotificationButton } from "./_core/dingtalkMessage";
import { ENV } from "./_core/env";
import { toAbsoluteAppUrl } from "../shared/action-links";
import type { NotificationEventKey } from "../shared/notification-matrix";

export type ActionCardHandledResult = {
  title: string;
  message: string;
  actionPath?: string;
};

export async function tryDeliverActionItemInteractiveCard(input: {
  actionItemId: number | null;
  recipientUserId: number;
  eventKey: NotificationEventKey;
  projectId: string;
  entityType: string;
  entityId: string;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  actionButtons?: WorkNotificationButton[] | null;
}): Promise<boolean> {
  if (!input.actionItemId || !isDingtalkInteractiveCardConfigured()) return false;
  const user = await getUserById(input.recipientUserId);
  if (!user) return false;
  const corpUserId = await resolveDingtalkCorpUserId(user, setUserDingtalkCorpId);
  if (!corpUserId) return false;

  const outTrackId = `cehub_ai_${input.actionItemId}_${input.recipientUserId}`;
  const cardParamMap = buildPendingActionCardParams({
    title: input.title,
    body: input.body,
    actionUrl: input.actionUrl,
    buttons: input.actionButtons,
  });
  const sent = await createAndDeliverInteractiveCard({ corpUserId, outTrackId, cardParamMap });
  await upsertDingtalkInteractiveCard({
    outTrackId,
    actionItemId: input.actionItemId,
    recipientUserId: input.recipientUserId,
    projectId: input.projectId,
    eventKey: input.eventKey,
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title,
    body: input.body ?? null,
    actionUrl: input.actionUrl ?? null,
    status: sent.ok ? "sent" : "failed",
    cardData: cardParamMap,
    lastError: sent.ok ? null : sent.error,
  });
  if (!sent.ok) {
    console.warn("[dingtalk] interactive card delivery failed (fallback to ActionCard):", sent.error);
    return false;
  }
  return true;
}

export async function markActionItemInteractiveCardsHandled(
  actionItemId: number | null | undefined,
  result: ActionCardHandledResult,
): Promise<void> {
  if (!actionItemId || !isDingtalkInteractiveCardConfigured()) return;
  const rows = await listDingtalkInteractiveCardsForActionItem(actionItemId);
  const actionUrl = result.actionPath ? toAbsoluteAppUrl(result.actionPath, ENV.appBaseUrl) : null;
  const cardParamMap = buildHandledActionCardParams({
    title: result.title,
    message: result.message,
    actionUrl,
  });
  for (const row of rows) {
    const updated = await updateInteractiveCard({ outTrackId: row.outTrackId, cardParamMap });
    await markDingtalkInteractiveCardStatus({
      outTrackId: row.outTrackId,
      status: updated.ok ? "handled" : "failed",
      cardData: cardParamMap,
      lastError: updated.ok ? null : updated.error,
      handledAt: updated.ok ? new Date() : null,
    });
    if (!updated.ok) {
      console.warn("[dingtalk] interactive card update failed:", updated.error);
    }
  }
}
