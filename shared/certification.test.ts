import { describe, expect, it } from "vitest";
import {
  evaluateCertificationCoverage,
  getRequiredCertificationCoverage,
} from "./certification";
import { EMPTY_CHANGE_SCOPE_DECLARATION } from "./sop-risk";

describe("certification coverage", () => {
  it("derives battery and added-market requirements from structured scope only", () => {
    const requirements = getRequiredCertificationCoverage({
      baselineTargetMarkets: ["US"],
      declaration: {
        ...EMPTY_CHANGE_SCOPE_DECLARATION,
        batteryCellChange: true,
        targetMarketExpansion: true,
        targetMarkets: ["US", "EU"],
        notes: "备注中的 JP 不应参与判定",
      },
    });
    expect(requirements.map((item) => `${item.type}:${item.market ?? "*"}`)).toEqual([
      "un38_3:*",
      "msds:*",
      "battery_safety:*",
      "market_access:EU",
    ]);
  });

  it("requires valid evidence and explicit revision reuse approval", () => {
    const requirements = [{ type: "un38_3" as const, market: null, reason: "test" }];
    const notApproved = evaluateCertificationCoverage({
      requirements,
      projectId: "p1",
      baseRevisionId: 7,
      todayISO: "2026-07-10",
      records: [{
        id: 1, type: "un38_3", scopeType: "revision", status: "valid",
        revisionId: 7, certificateNumber: "UN-1", reuseApproved: false,
      }],
    });
    expect(notApproved.covered).toBe(false);

    const approved = evaluateCertificationCoverage({
      requirements,
      projectId: "p1",
      baseRevisionId: 7,
      todayISO: "2026-07-10",
      records: [{
        id: 1, type: "un38_3", scopeType: "revision", status: "valid",
        revisionId: 7, certificateNumber: "UN-1", reuseApproved: true, reuseBasis: "边界未变化",
      }],
    });
    expect(approved.covered).toBe(true);
  });

  it("rejects expired or market-mismatched certificates", () => {
    const result = evaluateCertificationCoverage({
      requirements: [{ type: "market_access", market: "EU", reason: "新增市场" }],
      projectId: "p1",
      todayISO: "2026-07-10",
      records: [{
        id: 1, type: "market_access", scopeType: "product_family", status: "valid",
        certificateNumber: "FCC-1", targetMarkets: ["US"], validUntil: "2026-12-31",
      }, {
        id: 2, type: "market_access", scopeType: "product_family", status: "valid",
        certificateNumber: "CE-OLD", targetMarkets: ["EU"], validUntil: "2026-01-01",
      }],
    });
    expect(result.covered).toBe(false);
    expect(result.missing).toHaveLength(1);
  });
});
