import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createPlatform, createProduct, getProductById,
  listProductsByCategory, createProductRevision, listProductRevisions,
} from "./db";

const SUF = "cut1test";
const PLATFORM_ID = `pf_${SUF}`;
const PRODUCT_ID = `pr_${SUF}`;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PRODUCT_ID}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PRODUCT_ID}`);
  await db.execute(sql`DELETE FROM platforms WHERE id = ${PLATFORM_ID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

describe("PLM spine db helpers", () => {
  it("creates a platform and a product referencing it", async () => {
    await createPlatform({ id: PLATFORM_ID, name: "锂电充气泵平台", category: "充气泵", createdBy: 1 });
    await createProduct({
      id: PRODUCT_ID, productNumber: "CE-PUMP-001", name: "露营充气泵",
      type: "finished", category: "充气泵", platformId: PLATFORM_ID,
      targetMarkets: ["EU", "US"], createdBy: 1,
    });
    const p = await getProductById(PRODUCT_ID);
    expect(p?.name).toBe("露营充气泵");
    expect(p?.targetMarkets).toEqual(["EU", "US"]);
    expect(p?.platformId).toBe(PLATFORM_ID);
  });

  it("lists products by category", async () => {
    const rows = await listProductsByCategory("充气泵");
    expect(rows.some((r) => r.id === PRODUCT_ID)).toBe(true);
  });

  it("creates and lists product revisions", async () => {
    const id = await createProductRevision({ productId: PRODUCT_ID, revisionLabel: "Rev A", status: "draft" });
    expect(id).toBeGreaterThan(0);
    const revs = await listProductRevisions(PRODUCT_ID);
    expect(revs.map((r) => r.revisionLabel)).toContain("Rev A");
  });
});
