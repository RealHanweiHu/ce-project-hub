import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { appRouter } from "./routers";
import { createProjectIssue, getDb, getProjectIssues } from "./db";
import type { TrpcContext } from "./_core/context";
import {
  actionItems,
  activityLogs,
  notifications,
  projectIssues,
  projectMembers,
  projects,
} from "../drizzle/schema";

const PROJECT = `issue-validation-${Date.now()}`;
const OWNER = 9_940_001;
const QA = 9_940_002;
const REPORTER = 9_940_003;

function makeCtx(userId: number, name: string): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `issue-validation-${userId}`,
      username: name.toLowerCase(),
      passwordHash: null,
      name,
      email: `${name.toLowerCase()}@example.com`,
      loginMethod: null,
      role: "user",
      canCreateProject: false,
      mobile: null,
      dingtalkUserId: null,
      dingtalkCorpUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.execute(sql`ALTER TYPE "public"."action_item_kind" ADD VALUE IF NOT EXISTS 'issue_validation'`);
  await db.insert(projects).values({
    id: PROJECT,
    name: "问题验证行动项",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "evt",
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: QA, role: "qa", invitedBy: OWNER },
    { projectId: PROJECT, userId: REPORTER, role: "sales", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(notifications).where(eq(notifications.userId, REPORTER));
  await db.delete(actionItems).where(eq(actionItems.projectId, PROJECT));
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("issue validation action item", () => {
  it("creates a validation action item when an issue is resolved and closes it after reporter verification", async () => {
    const issueId = await createProjectIssue({
      projectId: PROJECT,
      phaseId: "evt",
      title: "充电保护修复验证",
      severity: "P1",
      status: "open",
      category: "safety",
      reporter: "Reporter",
      creatorId: REPORTER,
    });

    const qaCaller = appRouter.createCaller(makeCtx(QA, "QA"));
    await qaCaller.issues.update({
      id: issueId,
      projectId: PROJECT,
      status: "resolved",
      solution: "已修复保护阈值",
    });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [item] = await db
      .select()
      .from(actionItems)
      .where(and(
        eq(actionItems.kind, "issue_validation"),
        eq(actionItems.entityType, "issue"),
        eq(actionItems.entityId, String(issueId)),
      ));

    expect(item).toMatchObject({
      recipientUserId: REPORTER,
      title: "问题待验证",
      status: "sent",
      priority: "high",
    });
    expect(item?.actionUrl).toContain("/actions/issue-validation");

    const reporterCaller = appRouter.createCaller(makeCtx(REPORTER, "Reporter"));
    await reporterCaller.issues.update({
      id: issueId,
      projectId: PROJECT,
      status: "closed",
    });

    const [closedItem] = await db
      .select()
      .from(actionItems)
      .where(eq(actionItems.id, item!.id));
    expect(closedItem.status).toBe("closed");
    expect(closedItem.handledAt).toBeTruthy();

    const [issue] = await getProjectIssues(PROJECT);
    expect(issue.status).toBe("closed");
    expect(issue.verifiedBy).toBe(REPORTER);
  });
});
