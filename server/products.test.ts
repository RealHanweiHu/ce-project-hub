import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createPlatform, createProduct, getProductById,
  listProductsByCategory, createProductRevision, listProductRevisions,
  upsertProductDefinition, confirmProductDefinition, getProductDefinitionByProductId,
  listProductDefinitionSnapshots,
  createProductDefinitionChange, listProductDefinitionChanges,
  updateProductDefinitionChange, getProductDefinitionDeviation,
} from "./db";

const SUF = "cut1test";
const PLATFORM_ID = `pf_${SUF}`;
const PRODUCT_ID = `pr_${SUF}`;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM product_definition_changes WHERE "productId" = ${PRODUCT_ID}`);
  await db.execute(sql`DELETE FROM product_definition_snapshots WHERE "productId" = ${PRODUCT_ID}`);
  await db.execute(sql`DELETE FROM product_definitions WHERE "productId" = ${PRODUCT_ID}`);
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

  it("saves and confirms a product definition baseline", async () => {
    const draft = await upsertProductDefinition(PRODUCT_ID, 1, {
      title: "露营充气泵产品定义",
      positioning: "高端精致型便携车载泵",
      prdSummary: "覆盖充气、照明、Type-C 快充和预设胎压核心需求",
      specs: [{ key: "pressure", label: "压力范围", target: "3-150psi", verification: "性能测试" }],
      targetCost: "USD 22",
      targetPrice: "USD 69",
      targetGrossMargin: ">=35%",
      skuPlan: [{ name: "标准版", code: "STD" }],
    });
    expect(draft.status).toBe("draft");

    const confirmed = await confirmProductDefinition(PRODUCT_ID, 1);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedBy).toBe(1);

    const current = await getProductDefinitionByProductId(PRODUCT_ID);
    expect(current?.positioning).toContain("高端精致型");

    const snapshots = await listProductDefinitionSnapshots(PRODUCT_ID);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].versionNumber).toBe(1);
    expect(snapshots[0].snapshot.specs[0].label).toBe("压力范围");

    await confirmProductDefinition(PRODUCT_ID, 1);
    const afterRepeatConfirm = await listProductDefinitionSnapshots(PRODUCT_ID);
    expect(afterRepeatConfirm).toHaveLength(1);

    await upsertProductDefinition(PRODUCT_ID, 1, {
      title: "露营充气泵产品定义 V2",
      positioning: "高端精致型便携车载泵",
      prdSummary: "新增客户定制 SKU，保留核心充气性能",
      specs: [{ key: "battery", label: "电池容量", target: "6000mAh", verification: "容量测试" }],
      skuPlan: [{ name: "Pro版", code: "PRO" }],
    });
    await confirmProductDefinition(PRODUCT_ID, 1);
    const afterSecondGate = await listProductDefinitionSnapshots(PRODUCT_ID);
    expect(afterSecondGate).toHaveLength(2);
    expect(afterSecondGate[0].versionNumber).toBe(2);
    expect(afterSecondGate[0].snapshot.skuPlan[0].name).toBe("Pro版");
  });

  it("tracks product definition changes and deviation from confirmed baseline", async () => {
    const change = await createProductDefinitionChange({
      productId: PRODUCT_ID,
      area: "spec",
      title: "删除照明功能",
      baselineValue: "含应急照明",
      requestedValue: "取消照明以降低 BOM",
      reason: "成本优化",
      impactScope: ["电子", "结构", "采购"],
      costImpact: "BOM -USD 0.8",
      scheduleImpact: "无",
      status: "proposed",
      createdBy: 1,
    });
    expect(change.status).toBe("proposed");

    const approved = await updateProductDefinitionChange(change.id, 1, { status: "approved" });
    expect(approved?.approvedBy).toBe(1);

    const changes = await listProductDefinitionChanges(PRODUCT_ID);
    expect(changes.map((item) => item.title)).toContain("删除照明功能");

    const deviation = await getProductDefinitionDeviation(PRODUCT_ID);
    expect(deviation.deviated).toBe(true);
    expect(deviation.approvedDeviationCount).toBeGreaterThan(0);
    expect(deviation.items[0].baselineValue).toContain("应急照明");
  });
});
