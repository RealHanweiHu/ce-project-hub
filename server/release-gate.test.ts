import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProjectWithSeed, setProjectProduct,
  createProjectGateReview, setTaskDeliverable,
  getReleaseGateStatus, getProjectById, isReleaseOverrideAuthorized,
} from "./db";
import { getReleaseGatePhase } from "../shared/sop-templates";
import { getTaskDeliverables } from "../shared/task-deliverables";

const PID = "rgate_prod";
const PRJ = "rgate_proj";

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM project_gate_reviews WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_members WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

async function completeReleaseGateDeliverables() {
  const phase = getReleaseGatePhase("npd")!;
  for (const t of phase.tasks) {
    if (t.id === phase.gateTaskId) continue;
    for (const name of getTaskDeliverables(t.id, phase.deliverables)) {
      await setTaskDeliverable(PRJ, phase.id, t.id, name, true, 1);
    }
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
    await completeReleaseGateDeliverables();
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

  it("override 授权：创建人/PM/admin 允许，其他人拒绝", async () => {
    const prj = await getProjectById(PRJ);
    expect(await isReleaseOverrideAuthorized(prj!, { id: 1, role: "user" })).toBe(true);
    expect(await isReleaseOverrideAuthorized(prj!, { id: 2, role: "user" })).toBe(true);
    expect(await isReleaseOverrideAuthorized(prj!, { id: 9, role: "admin" })).toBe(true);
    expect(await isReleaseOverrideAuthorized(prj!, { id: 9, role: "user" })).toBe(false);
  });
});
