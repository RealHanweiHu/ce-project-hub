import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProjectWithSeed,
  setProjectProduct, getOpenP0P1Count, releaseProject,
  getProductById, getProjectById, listProductRevisions,
  createProjectGateReview, createProjectFile, upsertProjectTask,
  createProjectTestPlan, createProjectTestReport, reviewProjectTestReport,
  createProjectNpiReadinessCheck,
  confirmGateReview,
  createProjectStabilityReport,
  confirmProjectStabilityReport,
  getMpReleaseByProjectId,
  listProjectConditions,
  createProjectChangeScopeDeclarationVersion,
  createProductCertificate,
  reviewProductCertificate,
  createProjectCondition,
  resolveProjectCondition,
  saveProjectCloseHandoffDraft,
  submitProjectCloseHandoff,
  acceptProjectCloseHandoff,
  getProjectCloseHandoffReadiness,
} from "./db";
import { getReleaseGatePhase } from "../shared/sop-templates";
import { EMPTY_CHANGE_SCOPE_DECLARATION, deriveSopRiskAssessment } from "../shared/sop-risk";
import { submitDeliverableReview, reviewDeliverable } from "./deliverable-review-service";

const PID = "rel_test_product";
const PRJ = "rel_test_project";
const ACTOR = { id: 1, role: "user" };
const deps = { notifyDingtalk: async () => {} };

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM action_items WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM project_deliverable_reviews WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_test_reports WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_test_cases WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_test_plans WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_npi_readiness_checks WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_files WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_gate_reviews WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_issues WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

async function addGate(decision: "approved" | "conditional" | "rejected", roundNumber: number, conditions?: string, projectId: string = PRJ) {
  await createProjectGateReview({
    projectId, phaseId: "pvt", phaseName: "PVT", gateName: "MP准备就绪评审",
    reviewDate: "2026-06-01", decision, conditions: conditions ?? null, roundNumber, createdBy: 1,
  } as any);
}
async function completeDeliverables(projectId: string = PRJ) {
  const phase = getReleaseGatePhase("npd")!;
  for (const task of phase.tasks) {
    if (task.id !== phase.gateTaskId) {
      await upsertProjectTask(projectId, phase.id, task.id, { status: "done", completed: true, completedAt: new Date(), updatedBy: 1 });
    }
  }
  const deliverables = Array.from(new Set([...(phase.deliverables ?? []), ...(phase.gateStandard?.requiredDeliverables ?? [])]));
  for (const name of deliverables) {
    await createProjectFile({
      projectId, phaseId: phase.id, taskId: phase.gateTaskId, deliverableName: name,
      name: `${name}.pdf`, mimeType: "application/pdf", size: 1, storageKey: `${projectId}/${name}`, storageUrl: `/storage/${projectId}/${name}`, uploadedBy: 1,
    });
    await submitDeliverableReview({ projectId, phaseId: phase.id, deliverableName: name, reviewerUserId: 2, submittedBy: 1 }, deps);
    await reviewDeliverable({ projectId, phaseId: phase.id, deliverableName: name, decision: "approved", reviewedBy: 2, note: null }, deps);
  }
  await completePvtTestReports(projectId);
  await completePvtNpiReadiness(projectId);
}

async function completePvtTestReports(projectId: string = PRJ) {
  const db = await getDb(); const { sql } = await import("drizzle-orm");
  await db!.execute(sql`DELETE FROM project_test_reports WHERE "projectId"=${projectId} AND "phaseId"='pvt'`);
  await db!.execute(sql`DELETE FROM project_test_cases WHERE "projectId"=${projectId} AND "phaseId"='pvt'`);
  await db!.execute(sql`DELETE FROM project_test_plans WHERE "projectId"=${projectId} AND "phaseId"='pvt'`);
  const planId = await createProjectTestPlan({
    projectId,
    phaseId: "pvt",
    title: "PVT 量产验证测试计划",
    scope: "试产整机功能、可靠性、安规、电池温升、包装运输",
    sampleSize: "PVT x 50",
    status: "active",
    createdBy: 1,
  });
  const reportFileId = await createProjectFile({
    projectId,
    phaseId: "pvt",
    taskId: getReleaseGatePhase("npd")?.gateTaskId ?? "pvt_gate",
    deliverableName: "PVT 量产验证测试报告",
    name: `${projectId}-pvt-report.pdf`,
    mimeType: "application/pdf",
    size: 1,
    storageKey: `${projectId}/pvt-report`,
    storageUrl: `/storage/${projectId}/pvt-report`,
    uploadedBy: 1,
  });
  const reportId = await createProjectTestReport({
    projectId,
    phaseId: "pvt",
    planId,
    title: "PVT 量产验证测试报告",
    reportNo: `${projectId}-PVT-RPT`,
    result: "pass",
    reviewStatus: "pending",
    summary: "PVT 关键测试项通过，QA 确认可进入 MP 发布",
    fileId: reportFileId,
    submittedBy: 1,
  });
  await reviewProjectTestReport(reportId, 1, "approved");
}

async function completePvtNpiReadiness(projectId: string = PRJ) {
  const db = await getDb(); const { sql } = await import("drizzle-orm");
  await db!.execute(sql`DELETE FROM project_npi_readiness_checks WHERE "projectId"=${projectId} AND "phaseId"='pvt'`);
  const evidenceFileId = await createProjectFile({
    projectId,
    phaseId: "pvt",
    taskId: getReleaseGatePhase("npd")?.gateTaskId ?? "pvt_gate",
    deliverableName: "PVT PE/NPI readiness checklist",
    name: `${projectId}-pvt-npi-readiness.pdf`,
    mimeType: "application/pdf",
    size: 1,
    storageKey: `${projectId}/pvt-npi-readiness`,
    storageUrl: `/storage/${projectId}/pvt-npi-readiness`,
    uploadedBy: 1,
  });
  await createProjectNpiReadinessCheck({
    projectId,
    phaseId: "pvt",
    title: "PVT 工艺、治具、测试程序与良率 readiness",
    category: "process_flow",
    status: "ready",
    evidenceFileId,
    createdBy: 1,
    updatedBy: 1,
  });
}

describe("MP Release 硬闸口", () => {
  beforeAll(async () => {
    await createProduct({ id: PID, name: "测试泵", type: "finished", category: "充气泵", createdBy: 1 });
    await createProjectWithSeed(
      { id: PRJ, name: "测试NPD", projectNumber: "T1", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 2 } as any,
      "npd", 1,
    );
    await setProjectProduct(PRJ, PID);
  });

  it("未关联产品：不可发布", async () => {
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    await db!.execute(sql`UPDATE projects SET "productId"=NULL WHERE id=${PRJ}`);
    await expect(releaseProject({ projectId: PRJ, actor: ACTOR })).rejects.toThrow(/未关联产品/);
    await setProjectProduct(PRJ, PID);
  });

  it("P0/P1 未关闭：绝对硬卡，强制也不行", async () => {
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    await db!.execute(sql`INSERT INTO project_issues ("projectId","phaseId",title,severity,status,category) VALUES (${PRJ},'pvt','blocker','P0','open','other')`);
    await addGate("approved", 1);
    await completeDeliverables();
    await expect(releaseProject({ projectId: PRJ, actor: ACTOR })).rejects.toThrow(/P0\/P1/);
    await expect(releaseProject({ projectId: PRJ, actor: { id: 1, role: "admin" }, override: { overrideReason: "x", followUpOwner: 1, dueDate: "2026-07-01" } })).rejects.toThrow(/P0\/P1/);
    await db!.execute(sql`UPDATE project_issues SET status='closed' WHERE "projectId"=${PRJ}`);
  });

  it("交付物未齐：绝对硬卡", async () => {
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    await db!.execute(sql`DELETE FROM project_deliverable_reviews WHERE "projectId"=${PRJ} AND "phaseId"='pvt'`);
    await db!.execute(sql`DELETE FROM project_files WHERE "projectId"=${PRJ} AND "phaseId"='pvt'`);
    await expect(releaseProject({ projectId: PRJ, actor: { id: 1, role: "admin" }, override: { overrideReason: "x", followUpOwner: 1, dueDate: "2026-07-01" } })).rejects.toThrow(/交付物/);
    await completeDeliverables();
  });

  it("Gate rejected：不可发布且不提供强制", async () => {
    await addGate("rejected", 2);
    await expect(releaseProject({ projectId: PRJ, actor: { id: 1, role: "admin" }, override: { overrideReason: "x", followUpOwner: 1, dueDate: "2026-07-01" } })).rejects.toThrow();
  });

  it("conditional + 无权用户：拒绝", async () => {
    await addGate("conditional", 3, "补一份老化报告");
    await expect(releaseProject({ projectId: PRJ, actor: { id: 9, role: "user" }, override: { overrideReason: "x", followUpOwner: 1, dueDate: "2026-07-01" } })).rejects.toThrow(/权限/);
  });

  it("conditional + 授权但缺 override：拒绝", async () => {
    // round-3 conditional gate 已存在；PM(id:2) 有权但未提交 override → 在授权校验前就被拦下
    await expect(releaseProject({ projectId: PRJ, actor: { id: 2, role: "user" } })).rejects.toThrow(/需 owner\/PM\/manager/);
  });

  it("conditional + 授权 + override 齐全：成功并留痕", async () => {
    const res = await releaseProject({ projectId: PRJ, actor: { id: 2, role: "user" }, override: { overrideReason: "管理层接受", followUpOwner: 2, dueDate: "2026-07-01" } });
    expect(res.revisionLabel).toBe("Rev A");
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    const r = await db!.execute(sql`SELECT overridden, "overrideReason", "acceptedBy", "conditionsSnapshot", "followUpOwner", "dueDate" FROM mp_releases WHERE "projectId"=${PRJ}`);
    const row = r.rows[0] as any;
    expect(row.overridden).toBe(true);
    expect(row.acceptedBy).toBe(2);
    expect(row.conditionsSnapshot).toBe("补一份老化报告");
    expect(row.followUpOwner).toBe(2);
    const conditions = await listProjectConditions(PRJ);
    expect(conditions.some((condition) => condition.sourceType === "release" && condition.status === "open" && condition.ownerUserId === 2)).toBe(true);
    const prj = await getProjectById(PRJ);
    expect(prj?.archived).toBe(false);
    expect(prj?.currentPhase).toBe("mp");
    const product = await getProductById(PID);
    expect(product?.lifecycleState).toBe("mass_production");
    expect((await listProductRevisions(PID)).length).toBe(1);
  });
});

const PID2 = "rel_test_product2";
const PRJ2 = "rel_test_project2";

async function cleanup2() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM action_items WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID2}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID2}`);
  await db.execute(sql`DELETE FROM project_deliverable_reviews WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM project_test_reports WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM project_test_cases WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM project_test_plans WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM project_npi_readiness_checks WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM project_files WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM project_gate_reviews WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${PRJ2}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ2}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID2}`);
}

describe("MP Release 正常发布（approved 普通路径）", () => {
  beforeAll(async () => {
    await cleanup2();
    await createProduct({ id: PID2, name: "测试泵2", type: "finished", category: "充气泵", createdBy: 1 });
    await createProjectWithSeed(
      { id: PRJ2, name: "测试NPD2", projectNumber: "T2", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 2 } as any,
      "npd", 1,
    );
    await setProjectProduct(PRJ2, PID2);
    await addGate("approved", 1, undefined, PRJ2);
    await completeDeliverables(PRJ2);
  });
  afterAll(cleanup2);

  it("approved + 四硬卡过：普通发布成功，留痕字段为空（overridden=false）", async () => {
    await expect(releaseProject({ projectId: PRJ2, actor: { id: 9, role: "user" } })).rejects.toThrow(/权限/);
    const res = await releaseProject({ projectId: PRJ2, actor: ACTOR });
    expect(res.revisionLabel).toBe("Rev A");
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    const r = await db!.execute(sql`SELECT overridden, "overrideReason", "acceptedBy", "acceptedAt", "conditionsSnapshot", "followUpOwner", "dueDate" FROM mp_releases WHERE "projectId"=${PRJ2}`);
    const row = r.rows[0] as any;
    expect(row.overridden).toBe(false);
    expect(row.overrideReason).toBeNull();
    expect(row.acceptedBy).toBeNull();
    expect(row.acceptedAt).toBeNull();
    expect(row.conditionsSnapshot).toBeNull();
    expect(row.followUpOwner).toBeNull();
    expect(row.dueDate).toBeNull();
    const prj = await getProjectById(PRJ2);
    expect(prj?.archived).toBe(false);
    expect(prj?.currentPhase).toBe("mp");
    const product = await getProductById(PID2);
    expect(product?.lifecycleState).toBe("mass_production");
    await expect(releaseProject({ projectId: PRJ2, actor: ACTOR })).rejects.toThrow(/已发布/);
    const release = await getMpReleaseByProjectId(PRJ2);
    const addDays = (iso: string, days: number) => {
      const date = new Date(`${iso}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const releaseDay = release!.releasedAt.toISOString().slice(0, 10);
    await expect(createProjectStabilityReport({
      projectId: PRJ2, revisionId: release!.revisionId,
      periodStart: releaseDay, periodEnd: addDays(releaseDay, 6),
      outputQuantity: 0, targetOutputQuantity: 0,
      fpyBasisPoints: 0, targetFpyBasisPoints: 0,
      capacityAttainmentBasisPoints: 10000,
      qualityEvents: null, summary: "空指标不能作为稳定证据", createdBy: 1,
    })).rejects.toThrow(/目标产量/);
    const first = await createProjectStabilityReport({
      projectId: PRJ2, revisionId: release!.revisionId,
      periodStart: releaseDay, periodEnd: addDays(releaseDay, 6),
      outputQuantity: 100, targetOutputQuantity: 100,
      fpyBasisPoints: 9800, targetFpyBasisPoints: 9700,
      capacityAttainmentBasisPoints: 10000,
      qualityEvents: "无", summary: "第一期稳定", createdBy: 1,
    });
    const second = await createProjectStabilityReport({
      projectId: PRJ2, revisionId: release!.revisionId,
      periodStart: addDays(releaseDay, 7), periodEnd: addDays(releaseDay, 13),
      outputQuantity: 120, targetOutputQuantity: 100,
      fpyBasisPoints: 9850, targetFpyBasisPoints: 9700,
      capacityAttainmentBasisPoints: 10000,
      qualityEvents: "无", summary: "第二期稳定", createdBy: 1,
    });
    await confirmProjectStabilityReport(first.id, PRJ2, 1);
    await confirmProjectStabilityReport(second.id, PRJ2, 1);
    const closeInput = {
      projectId: PRJ2,
      phaseId: "mp",
      gateTaskId: "project_close_review",
      phaseName: "量产稳定与移交",
      gateName: "项目关闭移交评审",
      reviewDate: "2026-07-10",
      decision: "approved",
      createdBy: 1,
    } as const;

    const declaration = { ...EMPTY_CHANGE_SCOPE_DECLARATION, batteryCellChange: true };
    await createProjectChangeScopeDeclarationVersion({
      projectId: PRJ2,
      declaration,
      assessment: deriveSopRiskAssessment({ declaration, certificateCoverageMissingReasons: ["UN38.3", "MSDS", "电池安全认证"] }),
      declaredBy: 1,
    });
    await expect(confirmGateReview(closeInput)).rejects.toThrow(/证书覆盖/);

    for (const type of ["un38_3", "msds", "battery_safety"] as const) {
      const certificate = await createProductCertificate({
        productId: PID2, projectId: PRJ2, revisionId: null,
        type, scopeType: "project", certificateNumber: `${PRJ2}-${type}`,
        issuingBody: "Release Test Lab", targetMarkets: [], validFrom: releaseDay,
        validUntil: addDays(releaseDay, 365), evidenceFileId: null,
        evidenceReference: `DCC-${type}`, reuseApproved: false, reuseBasis: null, createdBy: 1,
      });
      await reviewProductCertificate({ id: certificate.id, status: "valid", reviewedBy: 1 });
    }
    const condition = await createProjectCondition({
      projectId: PRJ2, sourceType: "waiver", sourceId: null,
      title: "稳定期临时让步", description: "关闭前必须补齐证据",
      ownerUserId: 1, dueDate: addDays(releaseDay, 20), linkedEcoProjectId: null,
      resolutionNote: null, createdBy: 1,
    });
    await expect(confirmGateReview(closeInput)).rejects.toThrow(/未闭环条件项/);
    await resolveProjectCondition({ id: condition.id, projectId: PRJ2, resolution: "closed", note: "证据已补齐", resolvedBy: 1 });

    await expect(confirmGateReview(closeInput)).rejects.toThrow(/量产移交/);
    await saveProjectCloseHandoffDraft({
      projectId: PRJ2,
      maintenanceOwnerUserId: 1,
      afterSalesOwnerUserId: 1,
      scopeSummary: "产品维护承接量产版本、售后分流和所有后续 ECO 决策。",
      items: [
        { itemKey: "controlled_documents", completed: true, evidenceReference: "DCC-RELEASE-PACK" },
        { itemKey: "maintenance_scope", completed: true, evidenceReference: "OPS-RACI-001" },
        { itemKey: "after_sales_process", completed: true, evidenceReference: "SOP-AFTER-SALES-001" },
        { itemKey: "eco_process", completed: true, evidenceReference: "SOP-ECO-001" },
      ],
      savedBy: 1,
    });
    await submitProjectCloseHandoff(PRJ2, 1);
    expect((await getProjectCloseHandoffReadiness(PRJ2)).ready).toBe(false);
    await acceptProjectCloseHandoff(PRJ2, 1);
    expect((await getProjectCloseHandoffReadiness(PRJ2)).ready).toBe(true);

    const close = await confirmGateReview(closeInput);
    expect(close.closed).toBe(true);
    expect((await getProjectById(PRJ2))?.archived).toBe(true);
    const maintained = await getProductById(PID2);
    expect(maintained?.lifecycleState).toBe("maintenance");
    expect(maintained?.maintenanceOwnerUserId).toBe(1);
    expect(maintained?.afterSalesOwnerUserId).toBe(1);
  });
});

const PID3 = "rel_test_product3";
const PRJ3 = "rel_test_project3";

async function cleanup3() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM action_items WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID3}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID3}`);
  await db.execute(sql`DELETE FROM project_changelog WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_deliverable_reviews WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_test_reports WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_test_cases WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_test_plans WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_npi_readiness_checks WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_files WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_gate_reviews WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ3}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID3}`);
}

describe("MP Release 变更盖章", () => {
  beforeAll(async () => {
    await cleanup3();
    await createProduct({ id: PID3, name: "测试泵3", type: "finished", category: "充气泵", createdBy: 1 });
    await createProjectWithSeed(
      { id: PRJ3, name: "测试NPD3", projectNumber: "T3", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 2 } as any,
      "npd", 1,
    );
    await setProjectProduct(PRJ3, PID3);
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    await db!.execute(sql`INSERT INTO project_changelog ("projectId",number,type,title,status,"createdDate") VALUES
      (${PRJ3},'ECN-002','ecn','改结构','implemented','2026-06-05'),
      (${PRJ3},'ECN-001','ecn','改电芯','approved','2026-06-01'),
      (${PRJ3},'ECR-009','spec','待议','proposed','2026-06-03'),
      (${PRJ3},'ECR-010','cost','驳回','rejected','2026-06-04')`);
    await addGate("approved", 1, undefined, PRJ3);
    await completeDeliverables(PRJ3);
  });
  afterAll(cleanup3);

  it("发布后 implemented+approved 被盖章，proposed/rejected 仍为 null", async () => {
    await releaseProject({ projectId: PRJ3, actor: ACTOR });
    const revId = (await listProductRevisions(PID3))[0].id;
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    const r = await db!.execute(sql`SELECT number, "revisionId" FROM project_changelog WHERE "projectId"=${PRJ3} ORDER BY number`);
    const byNum = Object.fromEntries((r.rows as any[]).map((x) => [x.number, x.revisionId]));
    expect(byNum["ECN-001"]).toBe(revId);
    expect(byNum["ECN-002"]).toBe(revId);
    expect(byNum["ECR-009"]).toBeNull();
    expect(byNum["ECR-010"]).toBeNull();
  });

  it("mpReleases.snapshotChangelog = 盖章条目，按 createdDate→number→id 排序", async () => {
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    const r = await db!.execute(sql`SELECT "snapshotChangelog" FROM mp_releases WHERE "projectId"=${PRJ3}`);
    const snap = (r.rows[0] as any).snapshotChangelog as any[];
    expect(snap.map((e) => e.number)).toEqual(["ECN-001", "ECN-002"]);
    expect(snap[0].title).toBe("改电芯");
  });

  it("listProductRevisions 带出该版本的 snapshotChangelog", async () => {
    const rev = (await listProductRevisions(PID3))[0] as any;
    expect(rev.snapshotChangelog.map((e: any) => e.number)).toEqual(["ECN-001", "ECN-002"]);
  });
});
