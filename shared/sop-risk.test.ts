import { describe, expect, it } from "vitest";
import {
  EMPTY_CHANGE_SCOPE_DECLARATION,
  SOP_RISK_RULE_VERSION,
  deriveSopRiskAssessment,
} from "./sop-risk";

describe("structured SOP risk assessment", () => {
  it("never upgrades risk from free-text notes", () => {
    const result = deriveSopRiskAssessment({
      declaration: {
        ...EMPTY_CHANGE_SCOPE_DECLARATION,
        notes: "更换电芯、调整保护阈值并新增强制认证市场",
      },
    });

    expect(result.ruleVersion).toBe(SOP_RISK_RULE_VERSION);
    expect(result.safetyRiskLevel).toBe("standard");
    expect(result.regulatoryRiskLevel).toBe("standard");
    expect(result.safetyReasons).toEqual([]);
    expect(result.regulatoryReasons).toEqual([]);
  });

  it("deterministically upgrades safety and regulatory risk from declared scope", () => {
    const result = deriveSopRiskAssessment({
      declaration: {
        ...EMPTY_CHANGE_SCOPE_DECLARATION,
        batteryCellChange: true,
      },
    });

    expect(result.safetyRiskLevel).toBe("high");
    expect(result.regulatoryRiskLevel).toBe("high");
    expect(result.safetyReasons).toContain("新增或更换电芯");
    expect(result.regulatoryReasons).toContain("电芯变化可能影响认证覆盖");
  });

  it("compares normalized target markets against the released baseline", () => {
    const result = deriveSopRiskAssessment({
      baselineTargetMarkets: ["US", "EU"],
      declaration: {
        ...EMPTY_CHANGE_SCOPE_DECLARATION,
        targetMarkets: [" eu ", "JP", "jp"],
      },
    });

    expect(result.addedTargetMarkets).toEqual(["JP"]);
    expect(result.regulatoryRiskLevel).toBe("high");
    expect(result.regulatoryReasons).toContain("目标市场新增：JP");
  });
});
