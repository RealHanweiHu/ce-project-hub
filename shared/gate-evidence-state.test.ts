import { describe, expect, it } from "vitest";
import { getGateEvidenceState } from "../client/src/lib/gate-evidence-state";

describe("Gate deliverable evidence state", () => {
  it.each([
    ["missing", false, true, null, "missing"],
    ["uploaded-awaiting-submit", true, true, null, "uploaded"],
    ["pending-review", true, true, "pending", "pending"],
    ["rejected", true, true, "rejected", "rejected"],
    ["approved", true, false, "approved", "approved"],
  ] as const)(
    "%s 映射为 %s",
    (_caseName, hasFile, readinessMissing, reviewStatus, expected) => {
      expect(getGateEvidenceState({
        hasFile,
        readinessMissing,
        reviewStatus,
      })).toBe(expected);
    },
  );

  it("即使审核记录曾通过，只要服务端 readiness 仍有缺口就不能显示为通过", () => {
    expect(getGateEvidenceState({
      hasFile: true,
      readinessMissing: true,
      reviewStatus: "approved",
    })).toBe("uploaded");
  });
});
