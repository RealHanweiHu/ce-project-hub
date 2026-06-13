import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProject,
  setProjectProduct, getOpenP0P1Count, releaseProject,
  getProductById, getProjectById, listProductRevisions,
} from "./db";

const PID = "rel_test_product";
const PRJ = "rel_test_project";

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM project_issues WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

describe("MP Release", () => {
  it("links a project to a product", async () => {
    await createProduct({ id: PID, name: "测试泵", type: "finished", category: "充气泵", createdBy: 1 });
    await createProject({ id: PRJ, name: "测试NPD", projectNumber: "T1", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1 } as any);
    await setProjectProduct(PRJ, PID);
    const prj = await getProjectById(PRJ);
    expect(prj?.productId).toBe(PID);
  });

  it("counts open P0/P1 issues", async () => {
    const db = await getDb();
    const { sql } = await import("drizzle-orm");
    await db!.execute(sql`INSERT INTO project_issues ("projectId","phaseId",title,severity,status,category) VALUES (${PRJ},'concept','blocker','P0','open','other')`);
    const n = await getOpenP0P1Count(PRJ);
    expect(n).toBe(1);
  });

  it("blocks release when open P0/P1 exist", async () => {
    await expect(releaseProject({ projectId: PRJ, releasedBy: 1 })).rejects.toThrow();
  });

  it("releases after P0/P1 closed: Rev A, project archived, product → mass_production", async () => {
    const db = await getDb();
    const { sql } = await import("drizzle-orm");
    await db!.execute(sql`UPDATE project_issues SET status='closed' WHERE "projectId"=${PRJ}`);
    const res = await releaseProject({ projectId: PRJ, releasedBy: 1, notes: "首发" });
    expect(res.revisionLabel).toBe("Rev A");
    const revs = await listProductRevisions(PID);
    expect(revs.length).toBe(1);
    const product = await getProductById(PID);
    expect(product?.lifecycleState).toBe("mass_production");
    expect(product?.currentRevisionId).toBe(res.revisionId);
    const prj = await getProjectById(PRJ);
    expect(prj?.archived).toBe(true);
    expect(prj?.resultRevisionId).toBe(res.revisionId);
  });
});
