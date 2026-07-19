import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { externalApprovalInstances, projects } from "../drizzle/schema";
import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const PROJECT = `del-appr-${Date.now().toString().slice(-8)}`;
const USER = 986401;
let approvalId = 0;
const ctx = {
  user: {
    id: USER,
    role: "admin",
    name: "delete admin",
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
    name: "有待审批的项目",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
  });
  const [approval] = await db.insert(externalApprovalInstances).values({
    businessType: "task_approval",
    entityType: "task",
    entityId: `${PROJECT}:concept:c1`,
    projectId: PROJECT,
    submittedBy: USER,
    processInstanceId: `process-${PROJECT}`,
    status: "pending",
  }).returning({ id: externalApprovalInstances.id });
  approvalId = approval.id;
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(externalApprovalInstances).where(eq(externalApprovalInstances.id, approvalId));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("projects.delete pending DingTalk approval", () => {
  it("keeps the project until its remote approval is terminated", async () => {
    await expect(projectsRouter.createCaller(ctx).delete({ id: PROJECT }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db.select().from(projects).where(eq(projects.id, PROJECT));
    const [approval] = await db.select().from(externalApprovalInstances)
      .where(eq(externalApprovalInstances.id, approvalId));
    expect(project).toBeDefined();
    expect(approval).toMatchObject({ status: "pending", projectId: PROJECT });
  });

  it("also blocks when syncing a known remote approval temporarily fails", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db
      .update(externalApprovalInstances)
      .set({ status: "sync_failed", lastError: "temporary query failure" })
      .where(eq(externalApprovalInstances.id, approvalId));

    await expect(projectsRouter.createCaller(ctx).delete({ id: PROJECT }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(project?.id).toBe(PROJECT);
  });
});
