import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { projectDeletionLeases, projects } from "../drizzle/schema";

vi.mock("./project-external-operation", async importOriginal => {
  const actual =
    await importOriginal<typeof import("./project-external-operation")>();
  return {
    ...actual,
    waitForProjectExternalOperations: vi.fn(async () => false),
    hasUncertainProjectExternalOperations: vi.fn(async () => true),
  };
});

import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const PROJECT = `delete-unknown-${Date.now().toString().slice(-8)}`;
const USER = 986705;
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
    name: "结果未知发送隔离",
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
  await db
    .delete(projectDeletionLeases)
    .where(eq(projectDeletionLeases.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("projects.delete uncertain remote-send quarantine", () => {
  it("keeps the project paused and releases only the delete lease", async () => {
    await expect(
      projectsRouter.createCaller(ctx).delete({ id: PROJECT })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("项目已暂停"),
    });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db
      .select({ lifecycle: projects.lifecycle })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    const [lease] = await db
      .select({ token: projectDeletionLeases.token })
      .from(projectDeletionLeases)
      .where(eq(projectDeletionLeases.projectId, PROJECT));
    expect(project.lifecycle).toBe("paused");
    expect(lease).toBeUndefined();
  });
});
