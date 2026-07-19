import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projects } from "../drizzle/schema";
import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const PROJECT = `del-meet-${Date.now().toString().slice(-8)}`;
const PENDING_PROJECT = `del-meet-p-${Date.now().toString().slice(-7)}`;
const USER = 986301;
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
    name: "周会取消失败项目",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    pmUserId: USER,
    lifecycle: "active",
    dingtalkEventId: "event-that-cannot-be-cancelled",
  });
  await db.insert(projects).values({
    id: PENDING_PROJECT,
    name: "周会仍在同步项目",
    projectNumber: PENDING_PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "active",
    dingtalkMeetingSyncStatus: "pending",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projects).where(eq(projects.id, PENDING_PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("projects.delete meeting cleanup", () => {
  it("keeps the project paused and retryable when its recurring DingTalk meeting cannot be canceled", async () => {
    await expect(
      projectsRouter.createCaller(ctx).delete({ id: PROJECT })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(project).toMatchObject({
      lifecycle: "paused",
      dingtalkEventId: "event-that-cannot-be-cancelled",
    });
  });

  it("keeps the project retryable while recurring meeting creation is still pending", async () => {
    await expect(
      projectsRouter.createCaller(ctx).delete({ id: PENDING_PROJECT })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, PENDING_PROJECT));
    expect(project).toMatchObject({
      lifecycle: "active",
      dingtalkMeetingSyncStatus: "pending",
    });
  });
});
