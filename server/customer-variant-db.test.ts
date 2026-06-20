import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct,
  createCustomerVariant, listVariantsByCustomer, listVariantsByParentProduct,
  getDownstreamVariantImpact,
} from "./db";

// 钉死客户版本持久化 + 下游 SKU 影响查询（PLM 侧登记，不开项目）。
const PID = "cv_prod_dg01";
const CUST_A = "CV-CUST-A";
const CUST_B = "CV-CUST-B";

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
      variantCode: "DG01-CUSTA-R1", customerSku: "DG01-US-BLK",
      parentProductId: PID, baseRevision: "Rev A",
      customerId: CUST_A, customerName: "客户A", status: "active",
      deltas: [{ dimension: "color_cmf", variantValue: "哑光黑", bomImpact: ["HOUSING-TOP", "HOUSING-BTM"] }],
      certReuseParent: true, certAffectedMarks: [], createdBy: 1,
    });
    await createCustomerVariant({
      variantCode: "DG01-CUSTB-R1", customerSku: "DG01-EU-NAVY",
      parentProductId: PID, baseRevision: "Rev A",
      customerId: CUST_B, customerName: "客户B", status: "active",
      deltas: [{ dimension: "color_cmf", variantValue: "藏青", bomImpact: ["HOUSING-TOP"] }],
      certReuseParent: false, certAffectedMarks: ["FCC ID"], createdBy: 1,
    });
    await createCustomerVariant({
      variantCode: "DG01-CUSTA-R0", parentProductId: PID, baseRevision: "Rev 0",
      customerId: CUST_A, customerName: "客户A", status: "eol",
      deltas: [{ dimension: "color_cmf", variantValue: "红" }],
      certReuseParent: true, certAffectedMarks: [], createdBy: 1,
    });
  });

  it("按客户查询：客户A 名下两个客户版本", async () => {
    const db = await getDb(); if (!db) return;
    const rows = await listVariantsByCustomer(CUST_A);
    expect(rows.map((r) => r.variantCode).sort()).toEqual(["DG01-CUSTA-R0", "DG01-CUSTA-R1"]);
  });

  it("按产品型号查询：deltas 与认证字段正确往返", async () => {
    const db = await getDb(); if (!db) return;
    const rows = await listVariantsByParentProduct(PID);
    expect(rows).toHaveLength(3);
    const b = rows.find((r) => r.variantCode === "DG01-CUSTB-R1")!;
    expect(b.deltas[0]?.bomImpact).toEqual(["HOUSING-TOP"]);
    expect(b.certReuseParent).toBe(false);
    expect(b.certAffectedMarks).toEqual(["FCC ID"]);
  });

  it("下游影响：BOM Revision 改 HOUSING-TOP，命中两个 active 客户版本，EOL 被过滤", async () => {
    const db = await getDb(); if (!db) return;
    const impact = await getDownstreamVariantImpact(PID, { onlyActive: true, changedBomLines: ["HOUSING-TOP"] });
    expect(impact).toHaveLength(2);
    expect(impact.every((r) => r.bomTouched)).toBe(true);
    const b = impact.find((r) => r.variantCode === "DG01-CUSTB-R1")!;
    expect(b.certReuseParent).toBe(false);
    expect(b.affectedMarks).toContain("FCC ID");
  });

  it("客户版本号唯一约束", async () => {
    const db = await getDb(); if (!db) return;
    await expect(createCustomerVariant({
      variantCode: "DG01-CUSTA-R1", parentProductId: PID, baseRevision: "Rev A",
      customerId: CUST_A, customerName: "客户A", status: "active",
      deltas: [], certReuseParent: true, certAffectedMarks: [], createdBy: 1,
    })).rejects.toThrow();
  });
});
