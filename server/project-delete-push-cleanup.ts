import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  actionItems,
  automationClaims,
  dingtalkInteractiveCards,
  externalApprovalInstances,
  notifications,
} from "../drizzle/schema";
import { getDb } from "./db";
import { markActionItemInteractiveCardsHandled } from "./dingtalk-interactive-card-service";

export type ProjectPushCleanupPlan = {
  notificationIds: number[];
  actionItemIds: number[];
};

/**
 * Capture notification ids while action-item ownership still exists. The
 * notifications table predates projectId, so issue/review notifications with
 * numeric entity ids cannot be attributed after the project rows are gone.
 */
export async function collectProjectPushCleanupPlan(
  projectId: string
): Promise<ProjectPushCleanupPlan> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      or(
        eq(notifications.projectId, projectId),
        and(
          eq(notifications.entityType, "project"),
          eq(notifications.entityId, projectId)
        ),
        sql`starts_with(${notifications.entityId}, ${`${projectId}:`})`,
        sql`EXISTS (
        SELECT 1
        FROM ${actionItems} project_action_item
        WHERE project_action_item."projectId" = ${projectId}
          AND project_action_item."entityType" = ${notifications.entityType}
          AND project_action_item."entityId" = ${notifications.entityId}
      )`
      )
    );
  const itemRows = await db
    .select({ id: actionItems.id })
    .from(actionItems)
    .where(eq(actionItems.projectId, projectId));
  return {
    notificationIds: rows.map(row => row.id),
    actionItemIds: itemRows.map(row => row.id),
  };
}

/** Best-effort: turn already-delivered native cards into a non-actionable state. */
export async function settleProjectInteractiveCards(
  plan: ProjectPushCleanupPlan
): Promise<boolean> {
  const settled = await Promise.all(
    plan.actionItemIds.map(async actionItemId => {
      try {
        return await markActionItemInteractiveCardsHandled(actionItemId, {
          title: "项目已删除",
          message: "该项目已删除，此行动项不再需要处理。",
        });
      } catch (error) {
        console.warn(
          "[project.delete] failed to settle interactive card:",
          actionItemId,
          error
        );
        return false;
      }
    })
  );
  return settled.every(Boolean);
}

/** Remove every persisted delivery artifact after the project delete commits. */
export async function purgeProjectPushArtifacts(
  projectId: string,
  plan: ProjectPushCleanupPlan
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    if (plan.notificationIds.length > 0) {
      await tx
        .delete(notifications)
        .where(inArray(notifications.id, plan.notificationIds));
    }
    // Catch direct/scoped notices written in the short interval between the
    // read-only capture and the project delete.
    await tx
      .delete(notifications)
      .where(
        or(
          eq(notifications.projectId, projectId),
          and(
            eq(notifications.entityType, "project"),
            eq(notifications.entityId, projectId)
          ),
          sql`starts_with(${notifications.entityId}, ${`${projectId}:`})`
        )
      );
    await tx
      .delete(dingtalkInteractiveCards)
      .where(
        and(
          eq(dingtalkInteractiveCards.projectId, projectId),
          eq(dingtalkInteractiveCards.status, "handled")
        )
      );
    await tx
      .delete(externalApprovalInstances)
      .where(eq(externalApprovalInstances.projectId, projectId));
    await tx
      .delete(automationClaims)
      .where(eq(automationClaims.projectId, projectId));
  });
}
