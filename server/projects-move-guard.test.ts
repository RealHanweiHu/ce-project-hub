import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { activityLogs, projects } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

/**
 * projects.move 的阶段守卫：看板拖拽只允许「回退」，前进推进必须走
 * gateReviews.confirmAndAdvance（Gate 评审单一路径）。此前该规则只在
 * 客户端 ProjectListView 里拦截，直连 API 可绕过 —— 这里锁死服务端行为。
 */

const PROJECT = `move-guard-${Date.now()}`;
const OWNER = 983001;
const ADMIN = 983002;

function makeCtx(userId: number, role: string = "member"): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-user-${userId}`,
      username: null,
      passwordHash: null,
      name: `TestUser${userId}`,
      email: null,
      loginMethod: null,
      role,
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

async function resetPhase(phase: string) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.update(projects).set({ currentPhase: phase }).where(eq(projects.id, PROJECT));
}

async function currentPhaseInDb(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const [row] = await db.select({ phase: projects.currentPhase }).from(projects).where(eq(projects.id, PROJECT));
  return row.phase;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "MoveGuard",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "design",
    createdBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projects).where(inArray(projects.id, [PROJECT]));
});

describe("projects.move phase guard", () => {
  it("rejects moving the phase forward (must go through gate review)", async () => {
    await resetPhase("design");
    const caller = appRouter.createCaller(makeCtx(OWNER));
    await expect(
      caller.projects.move({ id: PROJECT, currentPhase: "evt" })
    ).rejects.toThrow(/Gate/i);
    expect(await currentPhaseInDb()).toBe("design");
  });

  it("rejects forward moves even for system admins", async () => {
    await resetPhase("design");
    const caller = appRouter.createCaller(makeCtx(ADMIN, "admin"));
    await expect(
      caller.projects.move({ id: PROJECT, currentPhase: "mp" })
    ).rejects.toThrow(/Gate/i);
    expect(await currentPhaseInDb()).toBe("design");
  });

  it("rejects phase ids that are not part of the project category's SOP", async () => {
    await resetPhase("design");
    const caller = appRouter.createCaller(makeCtx(OWNER));
    await expect(
      caller.projects.move({ id: PROJECT, currentPhase: "not-a-phase" })
    ).rejects.toThrow();
    expect(await currentPhaseInDb()).toBe("design");
  });

  it("allows moving the phase backward (kanban rollback)", async () => {
    await resetPhase("design");
    const caller = appRouter.createCaller(makeCtx(OWNER));
    await caller.projects.move({ id: PROJECT, currentPhase: "planning" });
    expect(await currentPhaseInDb()).toBe("planning");
  });

  it("still allows pm/product patches without touching the phase", async () => {
    await resetPhase("design");
    const caller = appRouter.createCaller(makeCtx(OWNER));
    await caller.projects.move({ id: PROJECT, pmUserId: null });
    expect(await currentPhaseInDb()).toBe("design");
  });
});
