import {
  getUserById,
  listDingtalkInteractiveCardsForActionItem,
  listDeletedProjectDingtalkInteractiveCards,
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
import { quarantineCurrentProjectExternalOperation } from "./project-external-operation";

export type ActionCardHandledResult = {
  title: string;
  message: string;
  actionPath?: string;
};

export type InteractiveCardDeliveryOutcome =
  | "delivered"
  | "fallback"
  | "uncertain";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
}): Promise<InteractiveCardDeliveryOutcome> {
  if (!input.actionItemId || !isDingtalkInteractiveCardConfigured())
    return "fallback";
  const user = await getUserById(input.recipientUserId);
  if (!user) return "fallback";
  const corpUserId = await resolveDingtalkCorpUserId(
    user,
    setUserDingtalkCorpId
  );
  if (!corpUserId) return "fallback";

  const outTrackId = `cehub_ai_${input.actionItemId}_${input.recipientUserId}`;
  const cardParamMap = buildPendingActionCardParams({
    title: input.title,
    body: input.body,
    actionUrl: input.actionUrl,
    buttons: input.actionButtons,
  });
  try {
    const intent = await upsertDingtalkInteractiveCard({
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
      status: "creating",
      cardData: cardParamMap,
      lastError: null,
    });
    if (!intent) return "fallback";
  } catch (error) {
    console.warn(
      "[dingtalk] interactive card intent persistence failed:",
      error
    );
    return "fallback";
  }

  let sent: Awaited<ReturnType<typeof createAndDeliverInteractiveCard>>;
  try {
    sent = await createAndDeliverInteractiveCard({
      corpUserId,
      outTrackId,
      cardParamMap,
    });
  } catch (error) {
    sent = {
      ok: false,
      error: `钉钉互动卡片投放异常: ${errorMessage(error)}`,
      uncertain: true,
    };
  }
  const deliveryStatus = sent.ok
    ? "sent"
    : sent.uncertain
      ? "creating"
      : "delivery_failed";
  try {
    await markDingtalkInteractiveCardStatus({
      outTrackId,
      status: deliveryStatus,
      cardData: cardParamMap,
      lastError: sent.ok ? null : sent.error,
      handledAt: null,
      expectedStatuses: ["creating"],
    });
  } catch (error) {
    // A persisted `creating` row intentionally remains an ambiguous, retryable
    // record if the remote response cannot be committed locally.
    console.warn(
      "[dingtalk] interactive card delivery status persistence failed:",
      outTrackId,
      error
    );
  }
  if (!sent.ok && sent.uncertain) {
    await quarantineCurrentProjectExternalOperation(sent.error);
    console.warn(
      "[dingtalk] interactive card delivery outcome uncertain (no fallback):",
      sent.error
    );
    return "uncertain";
  }
  if (!sent.ok) {
    console.warn(
      "[dingtalk] interactive card delivery failed (fallback to ActionCard):",
      sent.error
    );
    return "fallback";
  }
  return "delivered";
}

export async function markActionItemInteractiveCardsHandled(
  actionItemId: number | null | undefined,
  result: ActionCardHandledResult
): Promise<boolean> {
  if (!actionItemId) return true;
  const rows = (
    await listDingtalkInteractiveCardsForActionItem(actionItemId)
  ).filter(row => row.status !== "handled");
  if (rows.length === 0) return true;
  let allUpdated = true;
  const actionUrl = result.actionPath
    ? toAbsoluteAppUrl(result.actionPath, ENV.appBaseUrl)
    : null;
  const cardParamMap = buildHandledActionCardParams({
    title: result.title,
    message: result.message,
    actionUrl,
  });
  const remoteRows: typeof rows = [];
  for (const row of rows) {
    if (row.status === "delivery_failed") {
      try {
        const marked = await markDingtalkInteractiveCardStatus({
          outTrackId: row.outTrackId,
          status: "handled",
          cardData: cardParamMap,
          lastError: null,
          handledAt: new Date(),
          expectedStatuses: ["delivery_failed"],
        });
        if (!marked) allUpdated = false;
      } catch (error) {
        console.warn(
          "[dingtalk] local card settlement failed:",
          row.outTrackId,
          error
        );
        allUpdated = false;
      }
      continue;
    }
    remoteRows.push(row);
  }

  if (remoteRows.length === 0) return allUpdated;
  if (!isDingtalkInteractiveCardConfigured()) {
    console.warn(
      "[dingtalk] interactive card update unavailable: configuration missing"
    );
    return false;
  }

  for (const row of remoteRows) {
    let updated: Awaited<ReturnType<typeof updateInteractiveCard>>;
    try {
      updated = await updateInteractiveCard({
        outTrackId: row.outTrackId,
        cardParamMap,
      });
    } catch (error) {
      updated = {
        ok: false,
        error: `钉钉互动卡片更新异常: ${errorMessage(error)}`,
      };
    }

    try {
      const marked = await markDingtalkInteractiveCardStatus({
        outTrackId: row.outTrackId,
        status: updated.ok ? "handled" : "update_failed",
        cardData: cardParamMap,
        lastError: updated.ok ? null : updated.error,
        handledAt: updated.ok ? new Date() : null,
        expectedStatuses: [row.status],
      });
      if (!marked) allUpdated = false;
      if (!updated.ok) {
        console.warn(
          "[dingtalk] interactive card update failed:",
          updated.error
        );
        allUpdated = false;
      }
    } catch (error) {
      console.warn(
        "[dingtalk] interactive card status persistence failed:",
        row.outTrackId,
        error
      );
      allUpdated = false;
    }
  }
  return allUpdated;
}

/** Retry card invalidation after a project row is already gone. Failed rows stay as the durable retry queue. */
export async function retryDeletedProjectInteractiveCards(
  limit = 20
): Promise<number> {
  if (!isDingtalkInteractiveCardConfigured()) return 0;
  const rows = await listDeletedProjectDingtalkInteractiveCards(limit);
  if (rows.length === 0) return 0;
  const cardParamMap = buildHandledActionCardParams({
    title: "项目已删除",
    message: "该项目已删除，此行动项不再需要处理。",
    actionUrl: null,
  });
  let handled = 0;
  for (const row of rows) {
    let updated: Awaited<ReturnType<typeof updateInteractiveCard>>;
    try {
      updated = await updateInteractiveCard({
        outTrackId: row.outTrackId,
        cardParamMap,
      });
    } catch (error) {
      updated = {
        ok: false,
        error: `钉钉互动卡片更新异常: ${errorMessage(error)}`,
      };
    }

    try {
      const marked = await markDingtalkInteractiveCardStatus({
        outTrackId: row.outTrackId,
        status: updated.ok ? "handled" : "update_failed",
        cardData: cardParamMap,
        lastError: updated.ok ? null : updated.error,
        handledAt: updated.ok ? new Date() : null,
        expectedStatuses: [row.status],
      });
      if (updated.ok && marked) handled += 1;
      if (!updated.ok) {
        console.warn(
          "[dingtalk] deleted-project card retry failed:",
          row.outTrackId,
          updated.error
        );
      }
    } catch (error) {
      console.warn(
        "[dingtalk] deleted-project card retry status persistence failed:",
        row.outTrackId,
        error
      );
    }
  }
  return handled;
}
