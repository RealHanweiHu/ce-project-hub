import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  actionItems,
  automationClaims,
  automationRuns,
  dingtalkInteractiveCards,
  externalApprovalInstances,
  notifications,
  projects,
} from "../drizzle/schema";
import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const SUFFIX = Date.now().toString().slice(-8);
const PROJECT = `del_push_${SUFFIX}`;
const USER = 986101;
const TASK_ENTITY = `${PROJECT}:concept:c1`;
const ISSUE_ENTITY = `${SUFFIX}`;
const LOOKALIKE_ENTITY = `${PROJECT.replace("_", "X")}:concept:c1`;
const CLAIM_KEY = `delete-cleanup:${PROJECT}`;
const OUT_TRACK_ID = `delete_cleanup_${PROJECT}`;
let actionItemId = 0;
let directNotificationId = 0;
let taskNotificationId = 0;
let issueNotificationId = 0;
let scopedNotificationId = 0;
let unrelatedNotificationId = 0;
let approvalId = 0;

const ctx = {
  user: {
    id: USER,
    role: "admin",
    name: "delete cleanup admin",
    email: null,
    username: null,
    passwordHash: null,
    canCreateProject: true,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
  },
} as never;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "删除后停止推送",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
  });
  const [actionItem] = await db
    .insert(actionItems)
    .values({
      kind: "critical_issue",
      projectId: PROJECT,
      entityType: "issue",
      entityId: ISSUE_ENTITY,
      dedupeKey: `${PROJECT}:critical:${ISSUE_ENTITY}`,
      recipientUserId: USER,
      title: "项目问题待处理",
      actionUrl: "/",
    })
    .returning({ id: actionItems.id });
  actionItemId = actionItem.id;
  const insertedNotifications = await db
    .insert(notifications)
    .values([
      {
        userId: USER,
        type: "automation",
        title: "项目通知",
        entityType: "project",
        entityId: PROJECT,
      },
      {
        userId: USER,
        type: "automation",
        title: "任务通知",
        entityType: "task",
        entityId: TASK_ENTITY,
      },
      {
        userId: USER,
        type: "action",
        title: "问题通知",
        entityType: "issue",
        entityId: ISSUE_ENTITY,
      },
      {
        projectId: PROJECT,
        userId: USER,
        type: "automation",
        title: "精确项目归属通知",
        entityType: "review",
        entityId: "42",
      },
      {
        userId: USER,
        type: "automation",
        title: "相似前缀的其他通知",
        entityType: "task",
        entityId: LOOKALIKE_ENTITY,
      },
    ])
    .returning({ id: notifications.id });
  [
    directNotificationId,
    taskNotificationId,
    issueNotificationId,
    scopedNotificationId,
    unrelatedNotificationId,
  ] = insertedNotifications.map(row => row.id);
  await db.insert(automationRuns).values({
    ruleKey: "delete_cleanup_test",
    projectId: PROJECT,
    eventType: "scheduled",
    entityType: "task",
    entityId: TASK_ENTITY,
    status: "fired",
  });
  await db.insert(automationClaims).values({
    claimKey: CLAIM_KEY,
    ruleKey: "delete_cleanup_test",
    projectId: PROJECT,
    entityId: TASK_ENTITY,
    token: `token-${SUFFIX}`,
    status: "fired",
  });
  await db.insert(dingtalkInteractiveCards).values({
    outTrackId: OUT_TRACK_ID,
    actionItemId,
    recipientUserId: USER,
    projectId: PROJECT,
    eventKey: "critical_issue",
    entityType: "issue",
    entityId: ISSUE_ENTITY,
    title: "项目问题待处理",
    status: "handled",
  });
  const [approval] = await db
    .insert(externalApprovalInstances)
    .values({
      businessType: "task_approval",
      entityType: "task",
      entityId: TASK_ENTITY,
      projectId: PROJECT,
      submittedBy: USER,
      status: "rejected",
    })
    .returning({ id: externalApprovalInstances.id });
  approvalId = approval.id;
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(dingtalkInteractiveCards)
    .where(eq(dingtalkInteractiveCards.outTrackId, OUT_TRACK_ID));
  await db
    .delete(externalApprovalInstances)
    .where(eq(externalApprovalInstances.id, approvalId));
  await db
    .delete(automationClaims)
    .where(eq(automationClaims.claimKey, CLAIM_KEY));
  for (const id of [
    directNotificationId,
    taskNotificationId,
    issueNotificationId,
    scopedNotificationId,
    unrelatedNotificationId,
  ]) {
    await db.delete(notifications).where(eq(notifications.id, id));
  }
  await db.delete(actionItems).where(eq(actionItems.id, actionItemId));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("deleteProject notification cleanup", () => {
  it("removes every project-scoped push artifact so deleted work cannot notify again", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");

    const result = await projectsRouter
      .createCaller(ctx)
      .delete({ id: PROJECT });
    expect(result.pushCleanupComplete).toBe(true);

    const [
      projectRows,
      actionRows,
      runRows,
      claimRows,
      cardRows,
      approvalRows,
    ] = await Promise.all([
      db.select().from(projects).where(eq(projects.id, PROJECT)),
      db.select().from(actionItems).where(eq(actionItems.projectId, PROJECT)),
      db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.projectId, PROJECT)),
      db
        .select()
        .from(automationClaims)
        .where(eq(automationClaims.projectId, PROJECT)),
      db
        .select()
        .from(dingtalkInteractiveCards)
        .where(eq(dingtalkInteractiveCards.projectId, PROJECT)),
      db
        .select()
        .from(externalApprovalInstances)
        .where(eq(externalApprovalInstances.projectId, PROJECT)),
    ]);
    expect(projectRows).toHaveLength(0);
    expect(actionRows).toHaveLength(0);
    expect(runRows).toHaveLength(0);
    expect(claimRows).toHaveLength(0);
    expect(cardRows).toHaveLength(0);
    expect(approvalRows).toHaveLength(0);

    for (const id of [
      directNotificationId,
      taskNotificationId,
      issueNotificationId,
      scopedNotificationId,
    ]) {
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, id));
      expect(rows, `notification ${id} should be removed`).toHaveLength(0);
    }
    const unrelatedRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, unrelatedNotificationId));
    expect(unrelatedRows, "lookalike prefix must not be deleted").toHaveLength(
      1
    );
  });
});
