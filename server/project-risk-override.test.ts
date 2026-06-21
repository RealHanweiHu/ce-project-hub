import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projects } from "../drizzle/schema";
import { getDb, getProjectById } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const OWNER = 882001;
const PROJECT = `risk-override-${Date.now()}`;

function makeCtx(): TrpcContext {
  return {
    user: {
      id: OWNER,
      openId: `test-user-${OWNER}`,
      username: null,
      passwordHash: null,
      name: "Risk Override Owner",
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
  await db.insert(projects).values({
    id: PROJECT,
    name: "健康度覆盖保留",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    riskOverrideRisk: "high",
    riskOverrideReason: "测试覆盖",
    currentPhase: "concept",
    progress: 0,
    createdBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("projects.update risk override", () => {
  it("omitting riskOverrideRisk preserves the existing manual override", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.projects.update({
      id: PROJECT,
      name: "健康度覆盖保留-改名",
      projectNumber: PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      startDate: null,
      targetDate: null,
    });

    const project = await getProjectById(PROJECT);
    expect(project?.riskOverrideRisk).toBe("high");
    expect(project?.riskOverrideReason).toBe("测试覆盖");
  });

  it("explicit null clears the manual override", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.projects.update({
      id: PROJECT,
      name: "健康度覆盖保留-清除",
      projectNumber: PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      startDate: null,
      targetDate: null,
      riskOverrideRisk: null,
      riskOverrideReason: null,
    });

    const project = await getProjectById(PROJECT);
    expect(project?.riskOverrideRisk).toBeNull();
    expect(project?.riskOverrideReason).toBeNull();
  });
});
