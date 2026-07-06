import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getGateReadiness } from "./db";
import { appRouter } from "./routers";
import { activityLogs, projectGateBlockers, projectMembers, projects } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const PROJECT = `gate-block-${Date.now()}`;
const OWNER = 9_920_001;
const QA = 9_920_002;
const PE = 9_920_003;
const SALES = 9_920_004;
const SUPPLIER = 9_920_005;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `gate-block-${userId}`,
      username: null,
      passwordHash: null,
      name: `GateBlock${userId}`,
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
    name: "Gate 阻断测试",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "evt",
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: QA, role: "qa", invitedBy: OWNER },
    { projectId: PROJECT, userId: PE, role: "pe", invitedBy: OWNER },
    { projectId: PROJECT, userId: SALES, role: "sales", invitedBy: OWNER },
    { projectId: PROJECT, userId: SUPPLIER, role: "supplier", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectGateBlockers).where(eq(projectGateBlockers.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("gate blockers", () => {
  it("QA/PE can create scoped blockers, unauthorized roles cannot, and external roles cannot list internal blockers", async () => {
    const qaCaller = appRouter.createCaller(makeCtx(QA));
    const peCaller = appRouter.createCaller(makeCtx(PE));
    const salesCaller = appRouter.createCaller(makeCtx(SALES));
    const supplierCaller = appRouter.createCaller(makeCtx(SUPPLIER));

    await expect(qaCaller.gateBlockers.create({
      projectId: PROJECT,
      phaseId: "evt",
      blockerType: "quality",
      title: "EVT 功能测试 P1 未复测",
    })).resolves.toMatchObject({ success: true });
    await expect(peCaller.gateBlockers.create({
      projectId: PROJECT,
      phaseId: "evt",
      blockerType: "npi",
      title: "试产治具 CTQ 未验收",
    })).resolves.toMatchObject({ success: true });

    await expect(qaCaller.gateBlockers.create({
      projectId: PROJECT,
      phaseId: "evt",
      blockerType: "npi",
      title: "QA 不能代 PE 阻断 NPI",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(salesCaller.gateBlockers.create({
      projectId: PROJECT,
      phaseId: "evt",
      blockerType: "quality",
      title: "Sales 不能阻断内部 Gate",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(supplierCaller.gateBlockers.list({ projectId: PROJECT, phaseId: "evt" })).resolves.toEqual([]);
  });

  it("open blockers appear in Gate readiness and resolving them clears the role block dimension", async () => {
    const ownerCaller = appRouter.createCaller(makeCtx(OWNER));
    const qaCaller = appRouter.createCaller(makeCtx(QA));
    const peCaller = appRouter.createCaller(makeCtx(PE));

    const initial = await getGateReadiness(PROJECT, "evt");
    const roleDim = initial?.dimensions.find((dimension) => dimension.dimension === "role_blocks");
    expect(roleDim?.ok).toBe(false);
    expect(roleDim?.blockers).toEqual([
      "QA: EVT 功能测试 P1 未复测",
      "PE/NPI: 试产治具 CTQ 未验收",
    ]);

    const blockers = await ownerCaller.gateBlockers.list({ projectId: PROJECT, phaseId: "evt" });
    const quality = blockers.find((blocker) => blocker.blockerType === "quality");
    const npi = blockers.find((blocker) => blocker.blockerType === "npi");
    expect(quality).toBeTruthy();
    expect(npi).toBeTruthy();

    await qaCaller.gateBlockers.resolve({ id: quality!.id });
    await peCaller.gateBlockers.resolve({ id: npi!.id });

    const after = await getGateReadiness(PROJECT, "evt");
    const afterRoleDim = after?.dimensions.find((dimension) => dimension.dimension === "role_blocks");
    expect(afterRoleDim?.ok).toBe(true);
    expect(afterRoleDim?.blockers).toEqual([]);
  });
});
