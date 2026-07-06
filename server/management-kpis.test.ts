import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLogs,
  bomItems,
  projectGateReviews,
  projectIssues,
  projectMembers,
  projectTestCases,
  projects,
} from "../drizzle/schema";
import { appRouter } from "./routers";
import { getDb } from "./db";
import type { TrpcContext } from "./_core/context";

const PROJECT = `mgmt-kpi-${Date.now()}`;
const OWNER = 9_950_001;
const MANAGER = 9_950_002;
const SALES = 9_950_003;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `mgmt-kpi-${userId}`,
      username: null,
      passwordHash: null,
      name: `MgmtKpi${userId}`,
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
    name: "Pocket E-Pump R1",
    projectNumber: PROJECT,
    category: "npd",
    customer: "Decathlon",
    risk: "low",
    currentPhase: "pvt",
    targetDate: "2026-07-01",
    customFields: { targetCost: "20" },
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: MANAGER, role: "manager", invitedBy: OWNER },
    { projectId: PROJECT, userId: SALES, role: "sales", invitedBy: OWNER },
  ]);
  await db.insert(projectGateReviews).values([
    { projectId: PROJECT, phaseId: "evt", phaseName: "EVT", gateName: "EVT Gate", reviewDate: "2026-06-01", decision: "approved", roundNumber: 1, createdBy: MANAGER },
    { projectId: PROJECT, phaseId: "dvt", phaseName: "DVT", gateName: "DVT Gate", reviewDate: "2026-06-15", decision: "rejected", roundNumber: 1, createdBy: MANAGER },
    { projectId: PROJECT, phaseId: "dvt", phaseName: "DVT", gateName: "DVT Gate", reviewDate: "2026-06-20", decision: "approved", roundNumber: 2, createdBy: MANAGER },
  ]);
  await db.insert(projectIssues).values({
    projectId: PROJECT,
    phaseId: "pvt",
    title: "PVT 温升 P1 未关闭",
    severity: "P1",
    status: "open",
    category: "thermal",
    foundDate: "2026-06-01",
    creatorId: MANAGER,
  });
  await db.insert(projectTestCases).values([
    { projectId: PROJECT, phaseId: "evt", title: "EVT function", status: "passed", severity: "P2", createdBy: MANAGER },
    { projectId: PROJECT, phaseId: "pvt", title: "PVT thermal", status: "blocked", severity: "P1", createdBy: MANAGER },
  ]);
  await db.insert(bomItems).values([
    { projectId: PROJECT, partNumber: "MOTOR-001", name: "Motor", quantity: 1, unitCost: "12", sortOrder: 1 },
    { projectId: PROJECT, partNumber: "BAT-001", name: "Battery", quantity: 2, unitCost: "6", sortOrder: 2 },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(bomItems).where(eq(bomItems.projectId, PROJECT));
  await db.delete(projectTestCases).where(eq(projectTestCases.projectId, PROJECT));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJECT));
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("management KPI dashboard", () => {
  it("manager can read management KPIs", async () => {
    const caller = appRouter.createCaller(makeCtx(MANAGER));
    const data = await caller.analytics.managementKpis();

    expect(data.gateFirstPass.reviewedGateCount).toBeGreaterThanOrEqual(2);
    expect(data.gateFirstPass.ratePct).not.toBeNull();
    expect(data.p0p1Aging.openCount).toBeGreaterThanOrEqual(1);
    expect(data.bomCostDelta.rows.some((row) => row.projectId === PROJECT && row.delta === 4)).toBe(true);
    expect(data.customerRiskRanking.rows.some((row) => row.projectId === PROJECT && row.customer === "Decathlon")).toBe(true);
  });

  it("non-management roles cannot read management KPIs", async () => {
    const caller = appRouter.createCaller(makeCtx(SALES));
    await expect(caller.analytics.managementKpis()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
