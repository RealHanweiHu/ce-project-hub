import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createProjectFile, getDb } from "./db";
import { appRouter } from "./routers";
import {
  activityLogs,
  projectFiles,
  projectIssues,
  projectMembers,
  projects,
  projectTestCases,
  projectTestPlans,
  projectTestReports,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const PROJECT = `test-plan-${Date.now()}`;
const OWNER = 9_930_001;
const QA = 9_930_002;
const SALES = 9_930_003;
const SUPPLIER = 9_930_004;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-plan-${userId}`,
      username: null,
      passwordHash: null,
      name: `TestPlan${userId}`,
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
    name: "测试计划路由",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "evt",
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: QA, role: "qa", invitedBy: OWNER },
    { projectId: PROJECT, userId: SALES, role: "sales", invitedBy: OWNER },
    { projectId: PROJECT, userId: SUPPLIER, role: "supplier", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectTestReports).where(eq(projectTestReports.projectId, PROJECT));
  await db.delete(projectTestCases).where(eq(projectTestCases.projectId, PROJECT));
  await db.delete(projectTestPlans).where(eq(projectTestPlans.projectId, PROJECT));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJECT));
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("testPlans router", () => {
  it("QA can create plan/report and approve the report for Gate readiness", async () => {
    const qaCaller = appRouter.createCaller(makeCtx(QA));

    const plan = await qaCaller.testPlans.createPlan({
      projectId: PROJECT,
      phaseId: "evt",
      title: "EVT 可靠性测试计划",
      scope: "电池温升、充电保护、压力、结构跌落",
      sampleSize: "T1 x 20",
    });
    expect(plan.success).toBe(true);
    const reportFileId = await createProjectFile({
      projectId: PROJECT,
      phaseId: "evt",
      taskId: "e7",
      deliverableName: "EVT 可靠性测试报告",
      name: "evt-reliability.pdf",
      mimeType: "application/pdf",
      size: 1,
      storageKey: `${PROJECT}/evt-reliability`,
      storageUrl: `/storage/${PROJECT}/evt-reliability`,
      uploadedBy: QA,
    });

    const report = await qaCaller.testPlans.createReport({
      projectId: PROJECT,
      phaseId: "evt",
      planId: plan.id,
      title: "EVT 可靠性测试报告",
      reportNo: "EVT-RPT-001",
      result: "conditional",
      summary: "温升通过，跌落需 DVT 加严复测",
      fileId: reportFileId,
    });
    expect(report.success).toBe(true);

    let readiness = await qaCaller.gateReviews.readiness({ projectId: PROJECT, phaseId: "evt" });
    expect(readiness?.dimensions.find((dimension) => dimension.dimension === "test_reports")?.ok).toBe(false);

    await qaCaller.testPlans.reviewReport({ id: report.id, reviewStatus: "approved" });
    readiness = await qaCaller.gateReviews.readiness({ projectId: PROJECT, phaseId: "evt" });
    expect(readiness?.dimensions.find((dimension) => dimension.dimension === "test_reports")?.ok).toBe(true);

    const reports = await qaCaller.testPlans.reports({ projectId: PROJECT, phaseId: "evt" });
    expect(reports).toHaveLength(1);
    expect(reports[0].reviewStatus).toBe("approved");

    const testCase = await qaCaller.testPlans.createCase({
      projectId: PROJECT,
      phaseId: "evt",
      planId: plan.id,
      title: "跌落后外壳卡扣断裂",
      category: "mechanical",
      acceptanceCriteria: "1.2m 跌落后外壳不得开裂",
      method: "T1 样机六面跌落",
      sampleSerials: ["T1-003", "T1-008"],
      severity: "P1",
    });
    await qaCaller.testPlans.updateCase({
      id: testCase.id,
      projectId: PROJECT,
      status: "failed",
      resultNotes: "T1-003 卡扣断裂，T1-008 外壳开缝",
    });
    readiness = await qaCaller.gateReviews.readiness({ projectId: PROJECT, phaseId: "evt" });
    expect(readiness?.dimensions.find((dimension) => dimension.dimension === "test_reports")?.blockers)
      .toContain("1 个失败/阻塞测试项未完成 Issue 闭环");

    const issue = await qaCaller.testPlans.createIssueFromCase({ id: testCase.id });
    expect(issue.existed).toBe(false);
    readiness = await qaCaller.gateReviews.readiness({ projectId: PROJECT, phaseId: "evt" });
    expect(readiness?.dimensions.find((dimension) => dimension.dimension === "test_reports")?.ok).toBe(false);

    await qaCaller.issues.update({ id: issue.id, projectId: PROJECT, status: "closed" });
    readiness = await qaCaller.gateReviews.readiness({ projectId: PROJECT, phaseId: "evt" });
    expect(readiness?.dimensions.find((dimension) => dimension.dimension === "test_reports")?.ok).toBe(true);
  });

  it("sales cannot maintain QA test data and suppliers cannot see internal test records", async () => {
    const salesCaller = appRouter.createCaller(makeCtx(SALES));
    const supplierCaller = appRouter.createCaller(makeCtx(SUPPLIER));

    await expect(salesCaller.testPlans.createPlan({
      projectId: PROJECT,
      phaseId: "evt",
      title: "Sales 不应创建测试计划",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(supplierCaller.testPlans.plans({ projectId: PROJECT, phaseId: "evt" })).resolves.toEqual([]);
    await expect(supplierCaller.testPlans.reports({ projectId: PROJECT, phaseId: "evt" })).resolves.toEqual([]);
  });
});
