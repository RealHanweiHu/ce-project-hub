import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLogs,
  projectDeliverableOverrides,
  projectGateBlockers,
  projectMembers,
  projectNpiReadinessChecks,
  projectPhases,
  projectSampleSignoffs,
  projectTailoring,
  projects,
  projectTasks,
  projectTestPlans,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import {
  createProjectTailoringRequest,
  getDb,
  getProjectEffectiveProcess,
  reviewProjectTailoring,
  setDeliverableOverride,
} from "./db";
import { appRouter } from "./routers";

const suffix = Date.now();
const PROJECT = `npd-v3-router-${suffix}`;
const OWNER = 9_970_001 + (suffix % 10_000);
const QA = OWNER + 1;
const PE = OWNER + 2;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `npd-v3-router-${userId}`,
      username: null,
      passwordHash: null,
      name: `NpdV3Router${userId}`,
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
    name: "NPD v3 lite+battery 路由守卫",
    projectNumber: PROJECT,
    category: "npd",
    sopTemplateVersion: "2026-07-v3",
    risk: "low",
    safetyRiskLevel: "standard",
    regulatoryRiskLevel: "standard",
    currentPhase: "verification",
    createdBy: OWNER,
    pmUserId: OWNER,
    customFields: {
      npdTemplate: {
        tier: "lite",
        packs: ["battery"],
      },
    },
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: QA, role: "qa", invitedBy: OWNER },
    { projectId: PROJECT, userId: PE, role: "pe", invitedBy: OWNER },
  ]);
  await db.insert(projectPhases).values({ projectId: PROJECT, phaseId: "verification" });
  await db.insert(projectTasks).values({
    projectId: PROJECT,
    phaseId: "verification",
    taskId: "nv3",
    completed: false,
    updatedBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectDeliverableOverrides).where(eq(projectDeliverableOverrides.projectId, PROJECT));
  await db.delete(projectTailoring).where(eq(projectTailoring.projectId, PROJECT));
  await db.delete(projectGateBlockers).where(eq(projectGateBlockers.projectId, PROJECT));
  await db.delete(projectNpiReadinessChecks).where(eq(projectNpiReadinessChecks.projectId, PROJECT));
  await db.delete(projectSampleSignoffs).where(eq(projectSampleSignoffs.projectId, PROJECT));
  await db.delete(projectTestPlans).where(eq(projectTestPlans.projectId, PROJECT));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("NPD v3 lite+battery project-aware router guards", () => {
  it("protects active redline tasks from standard-risk tailoring", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));

    for (const target of [
      { scope: "task" as const, phaseId: "design", taskId: "pb2" },
      { scope: "task" as const, phaseId: "pvt", taskId: "npv2" },
      { scope: "task" as const, phaseId: "mp", taskId: "nm1" },
      { scope: "phase" as const, phaseId: "design" },
    ]) {
      await expect(caller.tailoring.propose({
        projectId: PROJECT,
        reasonType: "reuse_mature",
        reasonNote: "普通风险也不应允许移除 NPD v3 红线",
        targets: [target],
      })).rejects.toThrow(/NPD v3 红线任务不可裁剪/);
    }
  });

  it("protects redline tasks in DB create and approval bypass paths", async () => {
    await expect(createProjectTailoringRequest({
      projectId: PROJECT,
      reasonType: "reuse_mature",
      reasonNote: "绕过 router 直调 service",
      targets: [{ scope: "task", phaseId: "design", taskId: "pb2" }],
      proposedBy: OWNER,
    })).rejects.toThrow(/NPD v3 红线任务不可裁剪/);

    for (const target of [
      { scope: "task" as const, phaseId: "design", taskId: "pb2" },
      { scope: "task" as const, phaseId: "pvt", taskId: "npv2" },
      { scope: "task" as const, phaseId: "mp", taskId: "nm1" },
      { scope: "phase" as const, phaseId: "design" },
    ]) {
      const db = await getDb();
      if (!db) throw new Error("no db");
      const [row] = await db.insert(projectTailoring).values({
        projectId: PROJECT,
        reasonType: "other",
        reasonNote: "bypass create guard",
        targets: [target],
        proposedBy: OWNER,
        status: "pending",
      }).returning({ id: projectTailoring.id });

      await expect(reviewProjectTailoring({
        id: row.id,
        decision: "approved",
        reviewedBy: OWNER,
      })).rejects.toThrow(/NPD v3 红线任务不可裁剪/);
    }
  });

  it("rejects redline audit deliverable removal at router and DB write layers", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));
    const protectedDeliverables = [
      { nodePhaseId: "design", deliverableName: "安全FMEA与危害分析" },
      { nodePhaseId: "pvt", deliverableName: "EOL 100%测试能力验收记录" },
      { nodePhaseId: "mp", deliverableName: "良率报告" },
    ];

    for (const deliverable of protectedDeliverables) {
      await expect(caller.tailoring.setDeliverableOverride({
        projectId: PROJECT,
        ...deliverable,
        action: "remove",
        reason: "不应允许移除红线审计证据",
      })).rejects.toThrow(/NPD v3 红线审计交付物不可移除/);

      await expect(setDeliverableOverride({
        projectId: PROJECT,
        ...deliverable,
        action: "remove",
        createdBy: OWNER,
        reason: "绕过 router 直写 service",
      })).rejects.toThrow(/NPD v3 红线审计交付物不可移除/);
    }
  });

  it("ignores legacy invalid redline tailoring and remove overrides on read", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const [tailoring] = await db.insert(projectTailoring).values({
      projectId: PROJECT,
      reasonType: "other",
      reasonNote: "历史非法红线裁剪",
      targets: [{ scope: "task", phaseId: "design", taskId: "pb2" }],
      proposedBy: OWNER,
      status: "approved",
      reviewedBy: OWNER,
      reviewedAt: new Date(),
    }).returning({ id: projectTailoring.id });
    const [override] = await db.insert(projectDeliverableOverrides).values({
      projectId: PROJECT,
      nodePhaseId: "design",
      deliverableName: "安全FMEA与危害分析",
      action: "remove",
      reason: "历史非法红线豁免",
      createdBy: OWNER,
    }).returning({ id: projectDeliverableOverrides.id });

    const process = await getProjectEffectiveProcess(PROJECT);
    expect(process?.isTaskTailored("design", "pb2")).toBe(false);
    expect(process?.phases.find((phase) => phase.id === "design")?.submittedDeliverables)
      .toContain("安全FMEA与危害分析");

    await db.delete(projectDeliverableOverrides).where(eq(projectDeliverableOverrides.id, override.id));
    await db.delete(projectTailoring).where(eq(projectTailoring.id, tailoring.id));
  });

  it("exposes lite and battery deliverables from the effective project template", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));

    const library = await caller.tailoring.deliverableLibrary({ projectId: PROJECT });

    expect(library).toContain("功能/性能测试报告");
    expect(library).toContain("安全FMEA与危害分析");
    expect(library).toContain("UN38.3运输测试报告或复用确认");

    await expect(caller.tailoring.setDeliverableOverride({
      projectId: PROJECT,
      nodePhaseId: "verification",
      deliverableName: "安全FMEA与危害分析",
      action: "add",
      reason: "验证项目级生效资源库",
    })).resolves.toMatchObject({ success: true });
    await expect(caller.tailoring.deliverableOverrides({ projectId: PROJECT }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          nodePhaseId: "verification",
          deliverableName: "安全FMEA与危害分析",
          action: "add",
        }),
      ]));
  });

  it("accepts lite verification and rejects ghost EVT/DVT across phase-bound workflows", async () => {
    const ownerCaller = appRouter.createCaller(makeCtx(OWNER));
    const qaCaller = appRouter.createCaller(makeCtx(QA));
    const peCaller = appRouter.createCaller(makeCtx(PE));

    await expect(ownerCaller.sampleSignoffs.create({
      projectId: PROJECT,
      phaseId: "verification",
      title: "轻量档验证样件内部签样",
      audience: "internal",
    })).resolves.toMatchObject({ success: true });

    await expect(ownerCaller.gateBlockers.create({
      projectId: PROJECT,
      phaseId: "verification",
      blockerType: "quality",
      title: "轻量档验证缺陷未关闭",
    })).resolves.toMatchObject({ success: true });

    await expect(qaCaller.testPlans.createPlan({
      projectId: PROJECT,
      phaseId: "verification",
      title: "轻量档合并验证计划",
    })).resolves.toMatchObject({ success: true });

    await expect(peCaller.npiReadiness.create({
      projectId: PROJECT,
      phaseId: "verification",
      title: "轻量档合并验证就绪检查",
    })).resolves.toMatchObject({ success: true });

    await expect(ownerCaller.sampleSignoffs.create({
      projectId: PROJECT,
      phaseId: "evt",
      title: "轻量档不应存在 EVT 签样",
      audience: "internal",
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "项目阶段不存在" });

    await expect(ownerCaller.gateBlockers.create({
      projectId: PROJECT,
      phaseId: "evt",
      blockerType: "quality",
      title: "轻量档不应存在 EVT blocker",
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "项目阶段不存在" });

    await expect(qaCaller.testPlans.createPlan({
      projectId: PROJECT,
      phaseId: "evt",
      title: "轻量档不应存在 EVT 测试计划",
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "项目阶段不存在" });

    await expect(peCaller.npiReadiness.create({
      projectId: PROJECT,
      phaseId: "dvt",
      title: "轻量档不应存在 DVT readiness",
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "项目阶段不存在" });
  });

  it("does not allow the lite verification Gate task to be completed directly", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));

    await expect(caller.tasks.setCompleted({
      projectId: PROJECT,
      phaseId: "verification",
      taskId: "nv3",
      completed: true,
    })).rejects.toThrow(/Gate 任务只能通过正式评审推进/);
  });

  it("keeps lite verification effective through move and portfolio paths", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));

    await expect(caller.projects.move({
      id: PROJECT,
      currentPhase: "pvt",
    })).rejects.toThrow(/Gate/i);

    const rows = await caller.projects.portfolio();
    expect(rows.find((row) => row.id === PROJECT)).toMatchObject({
      gatePhaseId: "verification",
      gateName: "验证评审",
      gateTaskTotal: 6,
      sopTemplateVersion: "2026-07-v3",
    });
  });
});
