import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLogs,
  externalApprovalInstances,
  projectCalendarEvents,
  projectExternalOperations,
  projects,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  listProjectDingtalkUncertainCreations,
  ProjectDingtalkUncertainReconciliationError,
  reconcileProjectDingtalkUncertainCreation,
} from "./project-dingtalk-uncertain-reconciliation";

const PROJECT = `unknown-recon-${Date.now().toString().slice(-8)}`;
const USER = 986706;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "钉钉未知结果对账",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "active",
  });
});

beforeEach(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db
    .delete(projectExternalOperations)
    .where(eq(projectExternalOperations.projectId, PROJECT));
  await db
    .delete(externalApprovalInstances)
    .where(eq(externalApprovalInstances.projectId, PROJECT));
  await db
    .delete(projectCalendarEvents)
    .where(eq(projectCalendarEvents.projectId, PROJECT));
  await db
    .delete(activityLogs)
    .where(eq(activityLogs.projectId, PROJECT));
  await db
    .update(projects)
    .set({
      lifecycle: "active",
      archived: false,
      dingtalkEventId: null,
      dingtalkMeetingSyncStatus: "not_synced",
    })
    .where(eq(projects.id, PROJECT));
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(externalApprovalInstances)
    .where(eq(externalApprovalInstances.projectId, PROJECT));
  await db
    .delete(activityLogs)
    .where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("uncertain DingTalk create reconciliation", () => {
  it("audits a human verdict that an approval was not created", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const [approval] = await db
      .insert(externalApprovalInstances)
      .values({
        businessType: "task_approval",
        entityType: "task",
        entityId: "task-1",
        projectId: PROJECT,
        status: "pending",
        title: "未知审批",
        submittedBy: USER,
        lastError: "远端结果未知",
      })
      .returning();

    const pending = await listProjectDingtalkUncertainCreations(PROJECT);
    expect(pending.approvals.map(row => row.id)).toContain(approval.id);
    await reconcileProjectDingtalkUncertainCreation({
      projectId: PROJECT,
      actorUserId: USER,
      resolution: {
        resource: "approval",
        localId: approval.id,
        outcome: "not_created",
        note: "已在钉钉后台按发起人和时间核对",
      },
    });

    const [updated] = await db
      .select()
      .from(externalApprovalInstances)
      .where(eq(externalApprovalInstances.id, approval.id));
    const [audit] = await db
      .select({ action: activityLogs.action })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.projectId, PROJECT),
          eq(activityLogs.action, "project.dingtalk_uncertain_reconcile")
        )
      );
    expect(updated.status).toBe("terminated");
    expect(audit?.action).toBe("project.dingtalk_uncertain_reconcile");
  });

  it("binds a recovered one-off calendar handle for normal delete cleanup", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const [event] = await db
      .insert(projectCalendarEvents)
      .values({
        projectId: PROJECT,
        title: "未知日程",
        eventDate: "2026-08-01",
        startTime: "09:00",
        durationMin: 60,
        organizerUserId: USER,
        createdBy: USER,
        dingtalkSyncStatus: "pending",
      })
      .returning();

    await reconcileProjectDingtalkUncertainCreation({
      projectId: PROJECT,
      actorUserId: USER,
      resolution: {
        resource: "calendar_event",
        localId: event.id,
        outcome: "bind",
        remoteId: "event-recovered-1",
        note: "已从钉钉日历复制事件 ID",
      },
    });

    const [updated] = await db
      .select()
      .from(projectCalendarEvents)
      .where(eq(projectCalendarEvents.id, event.id));
    expect(updated).toMatchObject({
      dingtalkEventId: "event-recovered-1",
      dingtalkSyncStatus: "synced",
    });
  });

  it("refuses a verdict while a project remote operation is still live", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db
      .update(projects)
      .set({ dingtalkMeetingSyncStatus: "pending" })
      .where(eq(projects.id, PROJECT));
    await db.insert(projectExternalOperations).values({
      projectId: PROJECT,
      token: "still-running",
      kind: "project_meeting_sync",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      reconcileProjectDingtalkUncertainCreation({
        projectId: PROJECT,
        actorUserId: USER,
        resolution: {
          resource: "weekly_meeting",
          outcome: "not_created",
          note: "人工核对未创建",
        },
      })
    ).rejects.toBeInstanceOf(ProjectDingtalkUncertainReconciliationError);
  });
});
