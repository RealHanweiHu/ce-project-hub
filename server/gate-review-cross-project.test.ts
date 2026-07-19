import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { actionItems, activityLogs, projectGateReviews, projects } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const PROJECT_A = `gate-idor-a-${Date.now()}`;
const PROJECT_B = `gate-idor-b-${Date.now()}`;
const OWNER_A = 982001;
const OWNER_B = 982002;

let reviewInB: number;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-user-${userId}`,
      username: null,
      passwordHash: null,
      name: `TestUser${userId}`,
      email: null,
      loginMethod: null,
      role: "user",
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

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");

  await db.insert(projects).values([
    { id: PROJECT_A, name: "IDOR-A", projectNumber: PROJECT_A, category: "npd", risk: "low", currentPhase: "design", createdBy: OWNER_A },
    { id: PROJECT_B, name: "IDOR-B", projectNumber: PROJECT_B, category: "npd", risk: "low", currentPhase: "design", createdBy: OWNER_B },
  ]);
  const [review] = await db.insert(projectGateReviews).values({
    projectId: PROJECT_B,
    phaseId: "design",
    phaseName: "设计",
    gateName: "设计冻结",
    reviewDate: "2026-07-01",
    decision: "approved",
    createdBy: OWNER_B,
  }).returning();
  reviewInB = review.id;
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  for (const projectId of [PROJECT_A, PROJECT_B]) {
    await db.delete(actionItems).where(eq(actionItems.projectId, projectId));
    await db.delete(activityLogs).where(eq(activityLogs.projectId, projectId));
    await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
});

describe("gate review 跨项目 IDOR 防护", () => {
  it("A 项目 owner 不能用 A 的 projectId 改写 B 项目的评审", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER_A));
    await expect(
      caller.gateReviews.update({ id: reviewInB, projectId: PROJECT_A, decision: "rejected" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const db = await getDb();
    const [row] = await db!.select().from(projectGateReviews).where(eq(projectGateReviews.id, reviewInB));
    expect(row.decision).toBe("approved");
  });

  it("A 项目 owner 不能用 A 的 projectId 删除 B 项目的评审", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER_A));
    await expect(
      caller.gateReviews.delete({ id: reviewInB, projectId: PROJECT_A })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const db = await getDb();
    const rows = await db!.select().from(projectGateReviews).where(eq(projectGateReviews.id, reviewInB));
    expect(rows.length).toBe(1);
  });

  it("B 项目 owner 可补充非决策字段，但不能覆盖决策或删除审计记录", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER_B));
    await caller.gateReviews.update({
      id: reviewInB,
      projectId: PROJECT_B,
      notes: "补充会议纪要",
    });
    const db = await getDb();
    const [row] = await db!.select().from(projectGateReviews).where(eq(projectGateReviews.id, reviewInB));
    expect(row.decision).toBe("approved");
    expect(row.notes).toBe("补充会议纪要");

    await expect(caller.gateReviews.update({
      id: reviewInB,
      projectId: PROJECT_B,
      decision: "conditional",
      conditions: "补齐验证证据",
      conditionOwnerUserId: OWNER_B,
      conditionDueDate: "2026-07-15",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.gateReviews.delete({
      id: reviewInB,
      projectId: PROJECT_B,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const rows = await db!.select().from(projectGateReviews).where(eq(projectGateReviews.id, reviewInB));
    expect(rows.length).toBe(1);
  });
});
