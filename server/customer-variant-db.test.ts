import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct,
  createCustomerVariant, listVariantsByCustomer, listVariantsByParentProduct,
  getDownstreamVariantImpact,
} from "./db";

// 钉死客户版本持久化 + 下游 SKU 影响查询（PLM 侧登记，不开项目）。
const PID = "cv_prod_dg01";
const CUST_WALMART = "CV-WALMART";
const CUST_ACADEMY = "CV-ACADEMY";

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM customer_variants WHERE "parentProductId" = ${PID}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

describe("客户版本 持久化 + 下游 SKU 影响", () => {
  beforeAll(async () => {
    const db = await getDb(); if (!db) return;
    await createProduct({ id: PID, productNumber: "DG01", name: "高端车载泵 DG01", type: "finished", category: "pump", createdBy: 1 });
    await createCustomerVariant({
      variantCode: "DG01 Rev A - Walmart", customerSku: "DG01-US-BLK",
      parentProductId: PID, baseRevision: "DG01 Rev A",
      customerId: CUST_WALMART, customerName: "Walmart", status: "active",
      deltas: [
        { dimension: "other", variantValue: "Walmart BOM Rev 1", note: "customer_bom_revision" },
        { dimension: "color_cmf", variantValue: "哑光黑", bomImpact: ["HOUSING-TOP", "HOUSING-BTM"] },
      ],
      certReuseParent: true, certAffectedMarks: [], sourceType: "eco", sourceRefId: "ECO-2026-001", createdBy: 1,
    });
    await createCustomerVariant({
      variantCode: "DG01 Rev A - Academy", customerSku: "DG01-US-ACADEMY",
      parentProductId: PID, baseRevision: "DG01 Rev A",
      customerId: CUST_ACADEMY, customerName: "Academy", status: "active",
      deltas: [
        { dimension: "other", variantValue: "Academy BOM Rev 1", note: "customer_bom_revision" },
        { dimension: "color_cmf", variantValue: "藏青", bomImpact: ["HOUSING-TOP"] },
      ],
      certReuseParent: false, certAffectedMarks: ["FCC ID"], sourceType: "ecn", sourceRefId: "ECN-2026-002", createdBy: 1,
    });
    await createCustomerVariant({
      variantCode: "DG01 Rev B - Trek", parentProductId: PID, baseRevision: "DG01 Rev B",
      customerId: "CV-TREK", customerName: "Trek", status: "eol",
      deltas: [
        { dimension: "other", variantValue: "Trek BOM Rev 1", note: "customer_bom_revision" },
        { dimension: "color_cmf", variantValue: "红" },
      ],
      certReuseParent: true, certAffectedMarks: [], sourceType: "eco", sourceRefId: "ECO-2026-003", createdBy: 1,
    });
  });

  it("按客户查询：Walmart 名下一个客户版本", async () => {
    const db = await getDb(); if (!db) return;
    const rows = await listVariantsByCustomer(CUST_WALMART);
    expect(rows.map((r) => r.variantCode)).toEqual(["DG01 Rev A - Walmart"]);
  });

  it("按产品型号查询：deltas 与认证字段正确往返", async () => {
    const db = await getDb(); if (!db) return;
    const rows = await listVariantsByParentProduct(PID);
    expect(rows).toHaveLength(3);
    const b = rows.find((r) => r.variantCode === "DG01 Rev A - Academy")!;
    const colorDelta = b.deltas.find((delta) => delta.dimension === "color_cmf");
    const customerBomRevision = b.deltas.find((delta) => delta.note === "customer_bom_revision");
    expect(colorDelta?.bomImpact).toEqual(["HOUSING-TOP"]);
    expect(customerBomRevision?.variantValue).toBe("Academy BOM Rev 1");
    expect(b.sourceType).toBe("ecn");
    expect(b.sourceRefId).toBe("ECN-2026-002");
    expect(b.certReuseParent).toBe(false);
    expect(b.certAffectedMarks).toEqual(["FCC ID"]);
  });

  it("下游影响：BOM Revision 改 HOUSING-TOP，命中两个 active 客户版本，EOL 被过滤", async () => {
    const db = await getDb(); if (!db) return;
    const impact = await getDownstreamVariantImpact(PID, { onlyActive: true, changedBomLines: ["HOUSING-TOP"] });
    expect(impact).toHaveLength(2);
    expect(impact.every((r) => r.bomTouched)).toBe(true);
    const b = impact.find((r) => r.variantCode === "DG01 Rev A - Academy")!;
    expect(b.customerBomRevision).toBe("Academy BOM Rev 1");
    expect(b.certReuseParent).toBe(false);
    expect(b.affectedMarks).toContain("FCC ID");
  });

  it("客户版本号唯一约束", async () => {
    const db = await getDb(); if (!db) return;
    await expect(createCustomerVariant({
      variantCode: "DG01 Rev A - Walmart", parentProductId: PID, baseRevision: "DG01 Rev A",
      customerId: CUST_WALMART, customerName: "Walmart", status: "active",
      deltas: [{ dimension: "other", variantValue: "Walmart BOM Rev 2", note: "customer_bom_revision" }],
      certReuseParent: true, certAffectedMarks: [], sourceType: "eco", sourceRefId: "ECO-2026-004", createdBy: 1,
    })).rejects.toThrow();
  });
});
