import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { projects } from "../drizzle/schema";

vi.mock("./project-delete-calendar-cleanup", () => ({
  cancelFutureProjectDingtalkEvents: vi.fn(async () => {
    throw new Error("钉钉日程「设计评审」取消失败");
  }),
}));

import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const PROJECT = `del-cal-${Date.now().toString().slice(-8)}`;
const USER = 986601;
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
    name: "日程取消失败项目",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "active",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("projects.delete one-off DingTalk calendar cleanup", () => {
  it("keeps the project paused and retryable when a future event cannot be canceled", async () => {
    await expect(
      projectsRouter.createCaller(ctx).delete({ id: PROJECT })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("设计评审"),
    });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(project).toMatchObject({ lifecycle: "paused" });
  });
});
