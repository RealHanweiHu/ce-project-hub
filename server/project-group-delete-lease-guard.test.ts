import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projects } from "../drizzle/schema";
import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const PROJECT = `group-guard-${Date.now().toString().slice(-8)}`;
const USER = 986741;
const ctx = {
  user: {
    id: USER,
    role: "admin",
    name: "group guard owner",
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
    name: "删除中建群闸门",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "paused",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("project group creation while deletion is quiesced", () => {
  it("rejects before resolving users or creating a DingTalk group", async () => {
    await expect(
      projectsRouter
        .createCaller(ctx)
        .createDingtalkGroup({ projectId: PROJECT })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
