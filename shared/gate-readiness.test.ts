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
    expect(r.dimensions.map((d) => d.dimension)).toEqual([
      "prereq",
      "deliverables",
      "test_reports",
      "npi_readiness",
      "sample_signoffs",
      "critical_issues",
      "role_blocks",
      "review_conditions",
    ]);
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
  it("EVT/DVT/PVT 正式测试报告缺口 → test_reports 阻塞", () => {
    const r = computeGateReadiness({
      ...base,
      phaseId: "evt",
      testReports: {
        required: true,
        phaseLabel: "EVT",
        planCount: 0,
        approvedReports: 0,
        pendingReports: 0,
        failedReports: 0,
        blockers: ["EVT 缺少测试计划", "EVT 缺少已复核通过/有条件通过测试报告"],
      },
    });
    const dim = r.dimensions.find((d) => d.dimension === "test_reports")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["EVT 缺少测试计划", "EVT 缺少已复核通过/有条件通过测试报告"]);
  });
  it("QA/PE 阻断项 → role_blocks 阻塞", () => {
    const r = computeGateReadiness({ ...base, roleBlocks: { titles: ["QA: 可靠性报告未确认"] } });
    const dim = r.dimensions.find((d) => d.dimension === "role_blocks")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["QA: 可靠性报告未确认"]);
  });
  it("PVT/MP NPI readiness 缺口 → npi_readiness 阻塞", () => {
    const r = computeGateReadiness({
      ...base,
      phaseId: "pvt",
      npiReadiness: {
        required: true,
        phaseLabel: "PVT",
        checkCount: 1,
        readyCount: 0,
        blockedCount: 1,
        pendingCount: 0,
        missingEvidenceCount: 0,
        blockers: ["NPI 阻断: 治具 CTQ 未验收"],
      },
    });
    const dim = r.dimensions.find((d) => d.dimension === "npi_readiness")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["NPI 阻断: 治具 CTQ 未验收"]);
  });
  it("客户/供应商签样缺口 → sample_signoffs 阻塞", () => {
    const r = computeGateReadiness({
      ...base,
      phaseId: "pvt",
      sampleSignoffs: {
        required: true,
        phaseLabel: "PVT",
        signoffCount: 1,
        approvedCount: 0,
        pendingCount: 1,
        rejectedCount: 0,
        blockers: ["签样待确认: Decathlon Golden Sample"],
      },
    });
    const dim = r.dimensions.find((d) => d.dimension === "sample_signoffs")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["签样待确认: Decathlon Golden Sample"]);
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
