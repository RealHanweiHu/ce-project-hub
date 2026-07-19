import {
  and,
  eq,
  gt,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import {
  activityLogs,
  externalApprovalInstances,
  projectCalendarEvents,
  projectDeletionLeases,
  projectExternalOperations,
  projects,
} from "../drizzle/schema";
import { getDb } from "./db";
import { projectExternalOperationLockKey } from "./project-deletion-lease";

export class ProjectDingtalkUncertainReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDingtalkUncertainReconciliationError";
  }
}

export type ProjectDingtalkUncertainResolution =
  | {
      resource: "approval";
      localId: number;
      outcome: "not_created" | "bind";
      remoteId?: string;
      note: string;
    }
  | {
      resource: "calendar_event";
      localId: number;
      outcome: "not_created" | "bind";
      remoteId?: string;
      note: string;
    }
  | {
      resource: "weekly_meeting";
      outcome: "not_created" | "bind";
      remoteId?: string;
      note: string;
    };

function requireRemoteId(
  input: ProjectDingtalkUncertainResolution
): string | null {
  if (input.outcome === "not_created") return null;
  const remoteId = input.remoteId?.trim();
  if (!remoteId) {
    throw new ProjectDingtalkUncertainReconciliationError(
      "确认远端已创建时必须填写钉钉资源 ID"
    );
  }
  return remoteId;
}

/** List only response-lost creations that have no recoverable remote handle. */
export async function listProjectDingtalkUncertainCreations(
  projectId: string
): Promise<{
  approvals: Array<{ id: number; title: string | null; error: string | null }>;
  calendarEvents: Array<{ id: number; title: string }>;
  weeklyMeeting: boolean;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [approvals, calendarEvents, project] = await Promise.all([
    db
      .select({
        id: externalApprovalInstances.id,
        title: externalApprovalInstances.title,
        error: externalApprovalInstances.lastError,
      })
      .from(externalApprovalInstances)
      .where(
        and(
          eq(externalApprovalInstances.projectId, projectId),
          eq(externalApprovalInstances.status, "pending"),
          isNull(externalApprovalInstances.processInstanceId)
        )
      ),
    db
      .select({ id: projectCalendarEvents.id, title: projectCalendarEvents.title })
      .from(projectCalendarEvents)
      .where(
        and(
          eq(projectCalendarEvents.projectId, projectId),
          eq(projectCalendarEvents.dingtalkSyncStatus, "pending"),
          isNull(projectCalendarEvents.dingtalkEventId)
        )
      ),
    db
      .select({
        status: projects.dingtalkMeetingSyncStatus,
        eventId: projects.dingtalkEventId,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
  ]);
  return {
    approvals,
    calendarEvents,
    weeklyMeeting:
      project[0]?.status === "pending" && !project[0]?.eventId,
  };
}

/**
 * Resolve a response-lost create after an authorized user has checked DingTalk.
 * The project advisory lock, no-live-operation check, state CAS and audit row
 * commit atomically. `bind` preserves the recovered handle for normal cleanup;
 * `not_created` records the human verdict and unblocks deletion.
 */
export async function reconcileProjectDingtalkUncertainCreation(input: {
  projectId: string;
  actorUserId: number;
  resolution: ProjectDingtalkUncertainResolution;
}): Promise<{ resource: ProjectDingtalkUncertainResolution["resource"]; remoteId: string | null }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const remoteId = requireRemoteId(input.resolution);

  return db.transaction(async tx => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${projectExternalOperationLockKey(input.projectId)}))`
    );
    const now = new Date();
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.archived, false),
          ne(projects.lifecycle, "terminated")
        )
      )
      .limit(1);
    if (!project) {
      throw new ProjectDingtalkUncertainReconciliationError(
        "项目不存在、已归档或已终止"
      );
    }
    const [deleteLease] = await tx
      .select({ token: projectDeletionLeases.token })
      .from(projectDeletionLeases)
      .where(eq(projectDeletionLeases.projectId, input.projectId))
      .limit(1);
    if (deleteLease) {
      throw new ProjectDingtalkUncertainReconciliationError(
        "项目删除仍在进行，请稍后再对账"
      );
    }
    const [activeOperation] = await tx
      .select({ token: projectExternalOperations.token })
      .from(projectExternalOperations)
      .where(
        and(
          eq(projectExternalOperations.projectId, input.projectId),
          gt(projectExternalOperations.expiresAt, now)
        )
      )
      .limit(1);
    if (activeOperation) {
      throw new ProjectDingtalkUncertainReconciliationError(
        "钉钉请求仍在执行或隔离中，请等待结束后再对账"
      );
    }

    const note = input.resolution.note.trim();
    if (input.resolution.resource === "approval") {
      const patch = input.resolution.outcome === "bind"
        ? {
            processInstanceId: remoteId,
            lastError: null,
            syncedAt: now,
          }
        : {
            status: "terminated" as const,
            lastError: `人工确认钉钉审批未创建：${note}`,
            terminatedAt: now,
            syncedAt: now,
          };
      const [updated] = await tx
        .update(externalApprovalInstances)
        .set(patch)
        .where(
          and(
            eq(externalApprovalInstances.id, input.resolution.localId),
            eq(externalApprovalInstances.projectId, input.projectId),
            eq(externalApprovalInstances.status, "pending"),
            isNull(externalApprovalInstances.processInstanceId)
          )
        )
        .returning({ id: externalApprovalInstances.id });
      if (!updated) {
        throw new ProjectDingtalkUncertainReconciliationError(
          "待对账审批状态已变化，请刷新后重试"
        );
      }
    } else if (input.resolution.resource === "calendar_event") {
      const [updated] = await tx
        .update(projectCalendarEvents)
        .set({
          dingtalkEventId: remoteId,
          dingtalkSyncStatus:
            input.resolution.outcome === "bind" ? "synced" : "failed",
        })
        .where(
          and(
            eq(projectCalendarEvents.id, input.resolution.localId),
            eq(projectCalendarEvents.projectId, input.projectId),
            eq(projectCalendarEvents.dingtalkSyncStatus, "pending"),
            isNull(projectCalendarEvents.dingtalkEventId)
          )
        )
        .returning({ id: projectCalendarEvents.id });
      if (!updated) {
        throw new ProjectDingtalkUncertainReconciliationError(
          "待对账日程状态已变化，请刷新后重试"
        );
      }
    } else {
      const [updated] = await tx
        .update(projects)
        .set({
          dingtalkEventId: remoteId,
          dingtalkMeetingSyncStatus:
            input.resolution.outcome === "bind" ? "synced" : "failed",
          dingtalkMeetingLastError:
            input.resolution.outcome === "bind"
              ? null
              : `人工确认钉钉周会未创建：${note}`,
          dingtalkMeetingLastSyncedAt: now,
        })
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.dingtalkMeetingSyncStatus, "pending"),
            isNull(projects.dingtalkEventId)
          )
        )
        .returning({ id: projects.id });
      if (!updated) {
        throw new ProjectDingtalkUncertainReconciliationError(
          "待对账周会状态已变化，请刷新后重试"
        );
      }
    }

    await tx.insert(activityLogs).values({
      projectId: input.projectId,
      userId: input.actorUserId,
      action: "project.dingtalk_uncertain_reconcile",
      entityType: input.resolution.resource,
      entityId:
        input.resolution.resource === "weekly_meeting"
          ? input.projectId
          : String(input.resolution.localId),
      meta: {
        outcome: input.resolution.outcome,
        remoteId,
        note,
      },
    });

    return { resource: input.resolution.resource, remoteId };
  });
}
