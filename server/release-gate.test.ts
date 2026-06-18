import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProjectWithSeed, setProjectProduct,
  createProjectGateReview, createProjectFile, upsertProjectTask,
  getReleaseGateStatus, getProjectById, isReleaseOverrideAuthorized,
  getProjectGateReviews,
} from "./db";
import { getReleaseGatePhase } from "../shared/sop-templates";
import { submitDeliverableReview, reviewDeliverable } from "./deliverable-review-service";

const PID = "rgate_prod";
const PRJ = "rgate_proj";
const deps = { notifyDingtalk: async () => {} };

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM project_deliverable_reviews WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_files WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_gate_reviews WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_members WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

async function completeReleaseGateReadiness() {
  const phase = getReleaseGatePhase("npd")!;
  for (const task of phase.tasks) {
    if (task.id !== phase.gateTaskId) {
      await upsertProjectTask(PRJ, phase.id, task.id, { status: "done", completed: true, completedAt: new Date(), updatedBy: 1 });
    }
  }
  const deliverables = Array.from(new Set([...(phase.deliverables ?? []), ...(phase.gateStandard?.requiredDeliverables ?? [])]));
  for (const name of deliverables) {
    await createProjectFile({
      projectId: PRJ, phaseId: phase.id, taskId: phase.gateTaskId, deliverableName: name,
      name: `${name}.pdf`, mimeType: "application/pdf", size: 1, storageKey: `release-gate/${name}`, storageUrl: `/storage/${name}`, uploadedBy: 1,
    });
    await submitDeliverableReview({ projectId: PRJ, phaseId: phase.id, deliverableName: name, reviewerUserId: 1, submittedBy: 1 }, deps);
    await reviewDeliverable({ projectId: PRJ, phaseId: phase.id, deliverableName: name, decision: "approved", reviewedBy: 1, note: null }, deps);
  }
}

describe("release gate status", () => {
  beforeAll(async () => {
    await createProduct({ id: PID, name: "网关测试", type: "finished", category: "x", createdBy: 1 });
    await createProjectWithSeed(
      { id: PRJ, name: "网关NPD", projectNumber: "G1", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 2 } as any,
      "npd", 1,
    );
    await setProjectProduct(PRJ, PID);
  });

  it("交付物未齐时 missing 非空、decision 为 null", async () => {
    const prj = await getProjectById(PRJ);
    const s = await getReleaseGateStatus(prj!);
    expect(s.phaseId).toBe("pvt");
    expect(s.deliverables.missing.length).toBeGreaterThan(0);
    expect(s.decision).toBeNull();
  });

  it("补齐交付物后 missing 为空", async () => {
    await completeReleaseGateReadiness();
    const prj = await getProjectById(PRJ);
    const s = await getReleaseGateStatus(prj!);
    expect(s.deliverables.missing).toEqual([]);
    expect(s.deliverables.done).toBe(s.deliverables.total);
  });

  it("最新记录取 roundNumber 最大那条", async () => {
    await createProjectGateReview({ projectId: PRJ, phaseId: "pvt", phaseName: "PVT", gateName: "MP准备就绪评审", reviewDate: "2026-06-01", decision: "rejected", roundNumber: 1, createdBy: 1 } as any);
    await createProjectGateReview({ projectId: PRJ, phaseId: "pvt", phaseName: "PVT", gateName: "MP准备就绪评审", reviewDate: "2026-06-02", decision: "approved", roundNumber: 2, createdBy: 1 } as any);
    const prj = await getProjectById(PRJ);
    const s = await getReleaseGateStatus(prj!);
    expect(s.decision).toBe("approved");
    expect(s.roundNumber).toBe(2);
  });

  it("服务端生成 roundNumber，忽略客户端乱传", async () => {
    await createProjectGateReview({ projectId: PRJ, phaseId: "round-auto", phaseName: "Round", gateName: "G1", reviewDate: "2026-06-01", decision: "conditional", roundNumber: 99, createdBy: 1 } as any);
    await createProjectGateReview({ projectId: PRJ, phaseId: "round-auto", phaseName: "Round", gateName: "G1", reviewDate: "2026-06-02", decision: "approved", roundNumber: 1, createdBy: 1 } as any);
    const rows = await getProjectGateReviews(PRJ, "round-auto");
    expect(rows.map((row) => row.roundNumber)).toEqual([1, 2]);
  });

  it("override 授权：创建人/PM/admin 允许，其他人拒绝", async () => {
    const prj = await getProjectById(PRJ);
    expect(await isReleaseOverrideAuthorized(prj!, { id: 1, role: "user" })).toBe(true);
    expect(await isReleaseOverrideAuthorized(prj!, { id: 2, role: "user" })).toBe(true);
    expect(await isReleaseOverrideAuthorized(prj!, { id: 9, role: "admin" })).toBe(true);
    expect(await isReleaseOverrideAuthorized(prj!, { id: 9, role: "user" })).toBe(false);
  });
});
