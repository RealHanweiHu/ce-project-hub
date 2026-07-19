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
const LITE_PROJECT = `move-guard-lite-${Date.now()}`;
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
  await db.insert(projects).values({
    id: LITE_PROJECT,
    name: "MoveGuard Lite",
    projectNumber: LITE_PROJECT,
    category: "npd",
    sopTemplateVersion: "2026-07-v3",
    customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
    risk: "low",
    currentPhase: "verification",
    createdBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projects).where(inArray(projects.id, [PROJECT, LITE_PROJECT]));
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

  it("rejects moving lite verification forward instead of treating it as dirty data", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));
    await expect(
      caller.projects.move({ id: LITE_PROJECT, currentPhase: "pvt" })
    ).rejects.toThrow(/Gate/i);
    const db = await getDb();
    const [row] = await db!.select({ phase: projects.currentPhase })
      .from(projects)
      .where(eq(projects.id, LITE_PROJECT));
    expect(row.phase).toBe("verification");
  });

  it("rejects forward phase changes through the generic project update API", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));
    await expect(caller.projects.update({
      id: LITE_PROJECT,
      name: "MoveGuard Lite",
      projectNumber: LITE_PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "pvt",
      progress: 0,
      startDate: null,
      targetDate: null,
    })).rejects.toThrow(/Gate|阶段/);
    const db = await getDb();
    const [row] = await db!.select({ phase: projects.currentPhase })
      .from(projects)
      .where(eq(projects.id, LITE_PROJECT));
    expect(row.phase).toBe("verification");
  });

  it("generic metadata updates cannot remove the frozen NPD tier or locked packs", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));
    await caller.projects.update({
      id: LITE_PROJECT,
      name: "MoveGuard Lite renamed",
      projectNumber: LITE_PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "verification",
      progress: 0,
      startDate: null,
      targetDate: null,
      customFields: {
        note: "ordinary metadata remains editable",
        npdTemplate: { tier: "lite", packs: [] },
      },
    });
    const db = await getDb();
    const [row] = await db!.select({ customFields: projects.customFields })
      .from(projects)
      .where(eq(projects.id, LITE_PROJECT));
    expect(row.customFields).toMatchObject({
      note: "ordinary metadata remains editable",
      npdTemplate: { tier: "lite", packs: ["battery"] },
    });
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
