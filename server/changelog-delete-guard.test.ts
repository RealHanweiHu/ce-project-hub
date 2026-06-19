import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { projects, projectChangelog } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { changelogRouter } from "./routers/changelog";

const PRJ = `cl-guard-${Date.now()}`;
const OWNER = 970001;

const makeCtx = (id: number, role = "user") => ({
  user: {
    id, role, name: "x", email: "x", canCreateProject: true, mobile: null,
    dingtalkUserId: null, dingtalkCorpUserId: null, passwordHash: null, username: null,
  },
});
const caller = (id: number) => changelogRouter.createCaller(makeCtx(id) as any);

let stampedId = 0;
let freeId = 0;

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({
    id: PRJ, name: "变更守卫", projectNumber: "CLG", category: "npd", risk: "low",
    currentPhase: "design", createdBy: OWNER, pmUserId: OWNER,
  } as any);
  const [stamped] = await db!.insert(projectChangelog).values({
    projectId: PRJ, number: "ECN-1", type: "ecn", title: "已盖章", status: "implemented",
    revisionId: 12345, creatorId: OWNER,
  } as any).returning({ id: projectChangelog.id });
  const [free] = await db!.insert(projectChangelog).values({
    projectId: PRJ, number: "ECR-1", type: "spec", title: "未盖章", status: "proposed",
    creatorId: OWNER,
  } as any).returning({ id: projectChangelog.id });
  stampedId = stamped.id; freeId = free.id;
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectChangelog).where(eq(projectChangelog.projectId, PRJ));
  await db!.delete(projects).where(eq(projects.id, PRJ));
});

describe("changelog delete 守卫", () => {
  it("已盖章(revisionId 非空)记录禁止删除", async () => {
    await expect(caller(OWNER).delete({ id: stampedId, projectId: PRJ })).rejects.toThrow(/不可删除/);
  });
  it("未盖章记录可正常删除", async () => {
    const res = await caller(OWNER).delete({ id: freeId, projectId: PRJ });
    expect(res.success).toBe(true);
  });
});
