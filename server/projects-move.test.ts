import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projects } from "../drizzle/schema";
import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const ADMIN = 778101;
const OUTSIDER = 778102;
const PROJ = `move-test-${Date.now()}`;

const ctx = (id: number, role = "user") => ({
  user: { id, role, name: "x", email: null, username: null, passwordHash: null,
    canCreateProject: false, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null },
}) as any;

// move 只允许「回退」阶段（前进必须走 Gate 评审），fixture 从 evt 起步往回拖
beforeAll(async () => {
  const db = await getDb(); if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJ, name: "move 测试", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "evt", progress: 42, pmUserId: ADMIN, createdBy: ADMIN,
  });
});
afterAll(async () => {
  const db = await getDb(); if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("projects.move", () => {
  it("只 patch currentPhase（回退），不动 progress", async () => {
    const caller = projectsRouter.createCaller(ctx(ADMIN, "admin"));
    await caller.move({ id: PROJ, currentPhase: "design" });
    const db = await getDb();
    const [row] = await db!.select().from(projects).where(eq(projects.id, PROJ));
    expect(row.currentPhase).toBe("design");
    expect(row.progress).toBe(42);
  });
  it("非授权用户 FORBIDDEN", async () => {
    const caller = projectsRouter.createCaller(ctx(OUTSIDER, "user"));
    await expect(caller.move({ id: PROJ, currentPhase: "concept" })).rejects.toThrow(/FORBIDDEN|权限|forbidden/i);
  });
  it("同时改 currentPhase（回退）+ pmUserId 都生效", async () => {
    const caller = projectsRouter.createCaller(ctx(ADMIN, "admin"));
    await caller.move({ id: PROJ, currentPhase: "planning", pmUserId: ADMIN });
    const db = await getDb();
    const [row] = await db!.select().from(projects).where(eq(projects.id, PROJ));
    expect(row.currentPhase).toBe("planning");
    expect(row.pmUserId).toBe(ADMIN);
  });
});
