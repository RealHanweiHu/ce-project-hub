import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, createProduct, getProductById, listProductRevisions } from "./db";
import { productsRouter } from "./routers/products";
import { productDefinitionChanges, productRevisions, products } from "../drizzle/schema";

const OWNER = 991101;
const PRODUCT_ID = `light-revision-${Date.now()}`;
const caller = productsRouter.createCaller({
  user: { id: OWNER, role: "member", name: "Light Revision Owner", canCreateProject: true },
} as any);

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(productDefinitionChanges).where(eq(productDefinitionChanges.productId, PRODUCT_ID));
  await db.delete(productRevisions).where(eq(productRevisions.productId, PRODUCT_ID));
  await db.delete(products).where(eq(products.id, PRODUCT_ID));
}

describe("PLM lightweight Revision", () => {
  beforeAll(async () => {
    await cleanup();
    await createProduct({
      id: PRODUCT_ID,
      name: "包装轻改测试产品",
      type: "finished",
      category: "test",
      createdBy: OWNER,
      productManagerUserId: OWNER,
    });
  });
  afterAll(cleanup);

  it("generates a Revision only when a lightweight change is implemented", async () => {
    const change = await caller.createDefinitionChange({
      productId: PRODUCT_ID,
      area: "packaging",
      title: "更新包装印刷警示语",
      impactScope: ["包装", "印刷"],
      status: "proposed",
    });
    await caller.updateDefinitionChange({ id: change.id, productId: PRODUCT_ID, status: "approved" });
    expect(await listProductRevisions(PRODUCT_ID)).toHaveLength(0);

    const implemented = await caller.updateDefinitionChange({
      id: change.id,
      productId: PRODUCT_ID,
      status: "implemented",
    });
    expect(implemented?.generatedRevisionLabel).toBe("Rev A");
    const revisions = await listProductRevisions(PRODUCT_ID);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].createdByProjectId).toBeNull();
    expect((await getProductById(PRODUCT_ID))?.currentRevisionId).toBe(revisions[0].id);
  });
});
