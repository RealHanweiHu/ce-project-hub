import { describe, it, expect } from "vitest";
import { AUTOMATION_RULES, AUTOMATION_RULE_KEYS } from "./automation/rules";

const rule = AUTOMATION_RULES.find((r) => r.key === "delay_impact_notify")!;

describe("delay_impact_notify 规则", () => {
  it("已注册到 AUTOMATION_RULES / KEYS", () => {
    expect(rule).toBeTruthy();
    expect(AUTOMATION_RULE_KEYS).toContain("delay_impact_notify");
    expect(rule.triggerType).toBe("event");
    expect(rule.recipientRoles).toContain("pm");
  });

  it("matches 仅在 action=task.rescheduled 且 impact.hasImpact 时为真", () => {
    const cfg = rule.defaultConfig;
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact: { hasImpact: true } } as any, cfg)).toBe(true);
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact: { hasImpact: false } } as any, cfg)).toBe(false);
    expect(rule.matches({ action: "issue.create", entityType: "issue" } as any, cfg)).toBe(false);
  });
});
