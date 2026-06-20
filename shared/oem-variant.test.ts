import { describe, it, expect } from "vitest";
import { computeDownstreamImpact, type ImpactableVariant } from "./oem-variant";

const CUSTOMER_REVISIONS: ImpactableVariant[] = [
  {
    variantCode: "DG01 Rev A - Walmart",
    customerSku: "DG01-US-BLK",
    customerName: "Walmart",
    status: "active",
    deltas: [
      { dimension: "color_cmf", variantValue: "哑光黑", bomImpact: ["HOUSING-TOP", "HOUSING-BTM"] },
      { dimension: "packaging", variantValue: "客户A 彩盒" },
    ],
    certReuseParent: true,
    certAffectedMarks: [],
  },
  {
    variantCode: "DG01 Rev A - Academy",
    customerSku: "DG01-US-ACADEMY",
    customerName: "Academy",
    status: "active",
    deltas: [
      { dimension: "color_cmf", variantValue: "藏青", bomImpact: ["HOUSING-TOP"] },
      { dimension: "firmware_branding", variantValue: "开机 logo" },
    ],
    certReuseParent: false,
    certAffectedMarks: ["FCC ID"],
  },
  {
    variantCode: "DG01 Rev B - Trek",
    customerName: "Trek",
    status: "eol",
    deltas: [{ dimension: "color_cmf", variantValue: "红", bomImpact: ["HOUSING-TOP"] }],
    certReuseParent: true,
  },
];

describe("computeDownstreamImpact", () => {
  it("无 changedBomLines 时全部 bomTouched=false，但仍列出受影响客户", () => {
    const rows = computeDownstreamImpact(CUSTOMER_REVISIONS, { onlyActive: true });
    expect(rows).toHaveLength(2); // EOL 被 onlyActive 过滤
    expect(rows.every((r) => r.bomTouched === false)).toBe(true);
    expect(rows.map((r) => r.customer)).toEqual(["Walmart", "Academy"]);
  });

  it("changedBomLines 命中客户版本差异料时标记 bomTouched", () => {
    const rows = computeDownstreamImpact(CUSTOMER_REVISIONS, { onlyActive: true, changedBomLines: ["HOUSING-TOP"] });
    const a = rows.find((r) => r.variantCode.includes("Walmart"))!;
    const b = rows.find((r) => r.variantCode.includes("Academy"))!;
    expect(a.bomTouched).toBe(true);
    expect(b.bomTouched).toBe(true);
  });

  it("changedBomLines 只命中部分客户版本", () => {
    const rows = computeDownstreamImpact(CUSTOMER_REVISIONS, { onlyActive: true, changedBomLines: ["HOUSING-BTM"] });
    const a = rows.find((r) => r.variantCode.includes("Walmart"))!;
    const b = rows.find((r) => r.variantCode.includes("Academy"))!;
    expect(a.bomTouched).toBe(true);   // Walmart 有 HOUSING-BTM
    expect(b.bomTouched).toBe(false);  // Academy 只动 HOUSING-TOP
  });

  it("透传认证标识：Academy 用自有 FCC ID 需独立复核", () => {
    const rows = computeDownstreamImpact(CUSTOMER_REVISIONS);
    const b = rows.find((r) => r.variantCode.includes("Academy"))!;
    expect(b.certReuseParent).toBe(false);
    expect(b.affectedMarks).toContain("FCC ID");
  });

  it("onlyActive=false 时包含 EOL 客户版本", () => {
    const rows = computeDownstreamImpact(CUSTOMER_REVISIONS);
    expect(rows).toHaveLength(3);
  });
});
