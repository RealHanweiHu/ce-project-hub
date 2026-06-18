import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct,
  createCustomerVariant, listVariantsByCustomer, listVariantsByParentProduct,
  getDownstreamVariantImpact,
} from "./db";

// 钉死客户变体持久化 + 下游影响查询（PLM 侧登记，不开项目）。
const PID = "cv_prod_s2pump";
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

describe("客户变体 持久化 + 下游影响", () => {
  beforeAll(async () => {
    const db = await getDb(); if (!db) return;
    await createProduct({ id: PID, name: "S2 充气泵", type: "finished", category: "pump", createdBy: 1 });
    await createCustomerVariant({
      variantCode: "CV-S2-CUSTA-BLK", customerSku: "BRANDA-AP200",
      parentProductId: PID, baseRevision: "Rev.C",
      customerId: CUST_A, customerName: "客户A", status: "active",
      deltas: [{ dimension: "color_cmf", variantValue: "哑光黑", bomImpact: ["HOUSING-TOP", "HOUSING-BTM"] }],
      certReuseParent: true, certAffectedMarks: [], createdBy: 1,
    });
    await createCustomerVariant({
      variantCode: "CV-S2-CUSTB-NAVY", customerSku: "BRANDB-INF-01",
      parentProductId: PID, baseRevision: "Rev.C",
      customerId: CUST_B, customerName: "客户B", status: "active",
      deltas: [{ dimension: "color_cmf", variantValue: "藏青", bomImpact: ["HOUSING-TOP"] }],
      certReuseParent: false, certAffectedMarks: ["FCC ID"], createdBy: 1,
    });
    await createCustomerVariant({
      variantCode: "CV-S2-CUSTA-EOL", parentProductId: PID, baseRevision: "Rev.B",
      customerId: CUST_A, customerName: "客户A", status: "eol",
      deltas: [{ dimension: "color_cmf", variantValue: "红" }],
      certReuseParent: true, certAffectedMarks: [], createdBy: 1,
    });
  });

  it("按客户查询：客户A 名下两个变体", async () => {
    const db = await getDb(); if (!db) return;
    const rows = await listVariantsByCustomer(CUST_A);
    expect(rows.map((r) => r.variantCode).sort()).toEqual(["CV-S2-CUSTA-BLK", "CV-S2-CUSTA-EOL"]);
  });

  it("按母平台查询：deltas 与认证字段正确往返", async () => {
    const db = await getDb(); if (!db) return;
    const rows = await listVariantsByParentProduct(PID);
    expect(rows).toHaveLength(3);
    const b = rows.find((r) => r.variantCode === "CV-S2-CUSTB-NAVY")!;
    expect(b.deltas[0]?.bomImpact).toEqual(["HOUSING-TOP"]);
    expect(b.certReuseParent).toBe(false);
    expect(b.certAffectedMarks).toEqual(["FCC ID"]);
  });

  it("下游影响：平台改 HOUSING-TOP，命中两个 active 变体，EOL 被过滤", async () => {
    const db = await getDb(); if (!db) return;
    const impact = await getDownstreamVariantImpact(PID, { onlyActive: true, changedBomLines: ["HOUSING-TOP"] });
    expect(impact).toHaveLength(2);
    expect(impact.every((r) => r.bomTouched)).toBe(true);
    const b = impact.find((r) => r.variantCode === "CV-S2-CUSTB-NAVY")!;
    expect(b.certReuseParent).toBe(false);
    expect(b.affectedMarks).toContain("FCC ID");
  });

  it("变体编码唯一约束", async () => {
    const db = await getDb(); if (!db) return;
    await expect(createCustomerVariant({
      variantCode: "CV-S2-CUSTA-BLK", parentProductId: PID, baseRevision: "Rev.C",
      customerId: CUST_A, customerName: "客户A", status: "active",
      deltas: [], certReuseParent: true, certAffectedMarks: [], createdBy: 1,
    })).rejects.toThrow();
  });
});
