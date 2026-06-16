import { describe, it, expect } from "vitest";
import { computeGateReadiness, type GateReadinessInput } from "@shared/gate-readiness";

const base: GateReadinessInput = {
  phaseId: "design", gateName: "设计冻结评审",
  prereq: { incompleteTaskIds: [] },
  deliverables: { required: ["ID外观图", "BOM v1.0"], uploaded: ["ID外观图", "BOM v1.0"] },
  criticalIssues: { titles: [] },
  latestReview: null,
};

describe("computeGateReadiness", () => {
  it("全就绪 → ready, 无 blocker", () => {
    const r = computeGateReadiness(base);
    expect(r.ready).toBe(true);
    expect(r.blockerCount).toBe(0);
    expect(r.dimensions.every((d) => d.ok)).toBe(true);
    expect(r.dimensions.map((d) => d.dimension)).toEqual(["prereq", "deliverables", "critical_issues", "review_conditions"]);
  });
  it("前置未完 → prereq 阻塞", () => {
    const r = computeGateReadiness({ ...base, prereq: { incompleteTaskIds: ["d2", "d4"] } });
    expect(r.ready).toBe(false);
    const dim = r.dimensions.find((d) => d.dimension === "prereq")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["d2", "d4"]);
  });
  it("缺交付物 → deliverables 阻塞，列缺失名", () => {
    const r = computeGateReadiness({ ...base, deliverables: { required: ["ID外观图", "BOM v1.0"], uploaded: ["ID外观图"] } });
    const dim = r.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["BOM v1.0"]);
  });
  it("本阶段 P0/P1 未关 → critical_issues 阻塞", () => {
    const r = computeGateReadiness({ ...base, criticalIssues: { titles: ["上电烧机"] } });
    const dim = r.dimensions.find((d) => d.dimension === "critical_issues")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["上电烧机"]);
  });
  it("评审 conditional → 阻塞用 conditions", () => {
    const r = computeGateReadiness({ ...base, latestReview: { decision: "conditional", conditions: "补充可靠性数据", notes: null } });
    const dim = r.dimensions.find((d) => d.dimension === "review_conditions")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["补充可靠性数据"]);
    // conditions 为空时用 fallback
    const r2 = computeGateReadiness({ ...base, latestReview: { decision: "conditional", conditions: null, notes: null } });
    expect(r2.dimensions.find((d) => d.dimension === "review_conditions")!.blockers).toEqual(["上轮评审有遗留条件"]);
  });
  it("评审 rejected → 阻塞用 notes，缺则 conditions", () => {
    const r1 = computeGateReadiness({ ...base, latestReview: { decision: "rejected", conditions: null, notes: "结构强度不达标" } });
    expect(r1.dimensions.find((d) => d.dimension === "review_conditions")!.blockers).toEqual(["结构强度不达标"]);
    const r2 = computeGateReadiness({ ...base, latestReview: { decision: "rejected", conditions: "整改项A", notes: null } });
    expect(r2.dimensions.find((d) => d.dimension === "review_conditions")!.blockers).toEqual(["整改项A"]);
  });
  it("评审 approved → review 维 ok", () => {
    const r = computeGateReadiness({ ...base, latestReview: { decision: "approved", conditions: null, notes: null } });
    expect(r.dimensions.find((d) => d.dimension === "review_conditions")!.ok).toBe(true);
  });
  it("多维阻塞 → blockerCount 累计", () => {
    const r = computeGateReadiness({
      ...base, prereq: { incompleteTaskIds: ["d2"] },
      deliverables: { required: ["A", "B"], uploaded: [] },
      criticalIssues: { titles: ["x"] },
    });
    expect(r.blockerCount).toBe(1 + 2 + 1);
    expect(r.ready).toBe(false);
  });
});
