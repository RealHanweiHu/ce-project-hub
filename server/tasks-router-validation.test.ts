import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projects, projectTasks } from "../drizzle/schema";
import { getDb } from "./db";
import { tasksRouter } from "./routers/tasks";

const OWNER = 779001;
const PROJECT = `tasks-router-val-${Date.now()}`;

const makeCtx = () => ({
  user: {
    id: OWNER,
    role: "user",
    name: "Task Router Validator",
    email: null,
    username: null,
    passwordHash: null,
    canCreateProject: false,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
  },
});

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "任务路由校验",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("tasks.setMeta validation", () => {
  it("拒绝实际不存在的 dueDate", async () => {
    const caller = tasksRouter.createCaller(makeCtx() as any);
    await expect(
      caller.setMeta({
        projectId: PROJECT,
        phaseId: "concept",
        taskId: "c1",
        dueDate: "2026-02-30",
      }),
    ).rejects.toThrow(/日期必须是有效的 YYYY-MM-DD/);
  });
});
