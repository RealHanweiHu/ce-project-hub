import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProductRevision,
  addBomLine, updateBomLine, deleteBomLine, listWorkingBom, listFrozenBom,
  freezeBomToRevision, whereUsed, bomDiff,
} from "./db";

const PRJ = "bom_test_prj";
const COMP = "bom_test_core";    // 零部件（机芯）
const FIN = "bom_test_pump";     // 整机

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM bom_items WHERE "projectId"=${PRJ} OR "componentProductId"=${COMP}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" IN (${COMP},${FIN})`);
  await db.execute(sql`DELETE FROM products WHERE id IN (${COMP},${FIN})`);
  await db.execute(sql`DELETE FROM projects WHERE id=${PRJ}`);
}
beforeAll(async () => {
  await cleanup();
  // bom_items.projectId 有外键后，working BOM 必须挂在真实项目上
  const db = await getDb(); if (!db) throw new Error("no db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`INSERT INTO projects (id, name, "projectNumber", category, "currentPhase", "createdBy") VALUES (${PRJ}, 'BOM 测试', ${PRJ}, 'npd', 'concept', 1)`);
});
afterAll(cleanup);

describe("BOM", () => {
  it("working BOM CRUD", async () => {
    const id = await addBomLine(PRJ, { name: "气泵机芯", partNumber: "CORE-1", quantity: 1 });
    expect(id).toBeGreaterThan(0);
    await addBomLine(PRJ, { name: "外壳", partNumber: "HOUS-1", quantity: 1 });
    await updateBomLine(id, { quantity: 2 });
    let bom = await listWorkingBom(PRJ);
    expect(bom.length).toBe(2);
    expect(bom.find((b) => b.id === id)!.quantity).toBe(2);
    await deleteBomLine(id);
    bom = await listWorkingBom(PRJ);
    expect(bom.length).toBe(1);
  });

  it("freeze working BOM into a revision (working untouched)", async () => {
    await createProduct({ id: FIN, name: "整机泵", type: "finished", category: "充气泵", createdBy: 1 });
    const revId = await createProductRevision({ productId: FIN, revisionLabel: "Rev A", status: "released" });
    const before = await listWorkingBom(PRJ);
    await freezeBomToRevision(PRJ, revId);
    const frozen = await listFrozenBom(revId);
    expect(frozen.length).toBe(before.length);
    const after = await listWorkingBom(PRJ);
    expect(after.length).toBe(before.length); // 工作态不动
  });

  it("where-used: component referenced by a finished BOM", async () => {
    await createProduct({ id: COMP, name: "机芯产品", type: "component", category: "充气泵", createdBy: 1 });
    const finRev = await createProductRevision({ productId: FIN, revisionLabel: "Rev B", status: "released" });
    await freezeBomLineToRevisionDirect(finRev, { name: "气泵机芯", componentProductId: COMP });
    const used = await whereUsed(COMP);
    expect(used.some((u) => u.productId === FIN)).toBe(true);
  });

  it("bom diff between two revisions", async () => {
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    const r1 = await createProductRevision({ productId: FIN, revisionLabel: "Rev C", status: "released" });
    const r2 = await createProductRevision({ productId: FIN, revisionLabel: "Rev D", status: "released" });
    await db!.execute(sql`INSERT INTO bom_items ("revisionId",name,"partNumber",quantity,"unitCost") VALUES (${r1},'A','PN-A',1,'10'),(${r1},'B','PN-B',1,'5')`);
    await db!.execute(sql`INSERT INTO bom_items ("revisionId",name,"partNumber",quantity,"unitCost") VALUES (${r2},'A','PN-A',2,'10'),(${r2},'C','PN-C',1,'8')`);
    const d = await bomDiff(r1, r2);
    expect(d.added.map((x) => x.partNumber)).toContain("PN-C");
    expect(d.removed.map((x) => x.partNumber)).toContain("PN-B");
    expect(d.changed.map((x) => x.partNumber)).toContain("PN-A");
  });
});

// 测试辅助：直接插一条冻结 BOM 行（引用零部件）
async function freezeBomLineToRevisionDirect(revisionId: number, line: { name: string; componentProductId: string }) {
  const db = await getDb(); const { sql } = await import("drizzle-orm");
  await db!.execute(sql`INSERT INTO bom_items ("revisionId",name,"componentProductId") VALUES (${revisionId},${line.name},${line.componentProductId})`);
}
