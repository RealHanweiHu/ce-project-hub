import { describe, it, expect, afterAll } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

const PROJ = `gate-rdy-rt-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("gateReviews.readiness", () => {
  it("成员可取就绪度；返回 4 维", async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(projects).values({
      id: PROJ, name: "rt就绪", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "design", createdBy: 42,
    }).onConflictDoNothing();

    // createdBy=42 → getEffectiveRole 返回 owner（canView=true）
    const ctx: TrpcContext = {
      user: {
        id: 42,
        openId: "test-user-42",
        email: "test42@example.com",
        name: "Test User 42",
        loginMethod: "password",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: {
        protocol: "https",
        headers: {},
      } as TrpcContext["req"],
      res: {
        clearCookie: () => {},
      } as TrpcContext["res"],
    };

    const caller = appRouter.createCaller(ctx);
    const r = await caller.gateReviews.readiness({ projectId: PROJ, phaseId: "design" });
    expect(r).not.toBeNull();
    expect(r!.dimensions.length).toBe(4);
  });
});
