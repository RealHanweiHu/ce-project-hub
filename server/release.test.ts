import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProjectWithSeed,
  setProjectProduct, getOpenP0P1Count, releaseProject,
  getProductById, getProjectById, listProductRevisions,
  createProjectGateReview, setTaskDeliverable,
} from "./db";
import { getReleaseGatePhase } from "../shared/sop-templates";
import { getTaskDeliverables } from "../shared/task-deliverables";

const PID = "rel_test_product";
const PRJ = "rel_test_project";
const ACTOR = { id: 1, role: "user" };

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID}`);
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
  for (const t of phase.tasks) {
    if (t.id === phase.gateTaskId) continue;
    for (const name of getTaskDeliverables(t.id, phase.deliverables)) {
      await setTaskDeliverable(projectId, phase.id, t.id, name, true, 1);
    }
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
    await db!.execute(sql`UPDATE project_tasks SET deliverables='{}'::jsonb WHERE "projectId"=${PRJ} AND "phaseId"='pvt'`);
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
  });
});
