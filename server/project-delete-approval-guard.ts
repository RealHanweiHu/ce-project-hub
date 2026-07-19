import { and, eq, isNotNull, or } from "drizzle-orm";
import { externalApprovalInstances } from "../drizzle/schema";
import { getDb } from "./db";

export async function hasPendingProjectExternalApproval(projectId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.select({ id: externalApprovalInstances.id })
    .from(externalApprovalInstances)
    .where(and(
      eq(externalApprovalInstances.projectId, projectId),
      or(
        eq(externalApprovalInstances.status, "pending"),
        and(
          eq(externalApprovalInstances.status, "sync_failed"),
          isNotNull(externalApprovalInstances.processInstanceId)
        )
      ),
    ))
    .limit(1);
  return Boolean(row);
}
