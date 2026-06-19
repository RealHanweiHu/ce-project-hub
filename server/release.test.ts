import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProjectWithSeed,
  setProjectProduct, getOpenP0P1Count, releaseProject,
  getProductById, getProjectById, listProductRevisions,
  createProjectGateReview, createProjectFile, upsertProjectTask,
} from "./db";
import { getReleaseGatePhase } from "../shared/sop-templates";
import { submitDeliverableReview, reviewDeliverable } from "./deliverable-review-service";

const PID = "rel_test_product";
const PRJ = "rel_test_project";
const ACTOR = { id: 1, role: "user" };
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
    await submitDeliverableReview({ projectId, phaseId: phase.id, deliverableName: name, reviewerUserId: 1, submittedBy: 1 }, deps);
    await reviewDeliverable({ projectId, phaseId: phase.id, deliverableName: name, decision: "approved", reviewedBy: 1, note: null }, deps);
  }
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
    const prj = await getProjectById(PRJ);
    expect(prj?.archived).toBe(true);
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
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID2}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID2}`);
  await db.execute(sql`DELETE FROM project_deliverable_reviews WHERE "projectId" = ${PRJ2}`);
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
    expect(prj?.archived).toBe(true);
    const product = await getProductById(PID2);
    expect(product?.lifecycleState).toBe("mass_production");
    await expect(releaseProject({ projectId: PRJ2, actor: ACTOR })).rejects.toThrow(/已发布/);
  });
});

const PID3 = "rel_test_product3";
const PRJ3 = "rel_test_project3";

async function cleanup3() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID3}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID3}`);
  await db.execute(sql`DELETE FROM project_changelog WHERE "projectId" = ${PRJ3}`);
  await db.execute(sql`DELETE FROM project_deliverable_reviews WHERE "projectId" = ${PRJ3}`);
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
