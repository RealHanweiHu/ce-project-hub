import { describe, it, expect } from "vitest";
import { AUTOMATION_RULES, AUTOMATION_RULE_KEYS, parseAutomationRuleConfig } from "./automation/rules";

const rule = AUTOMATION_RULES.find((r) => r.key === "delay_impact_notify")!;
const impact = {
  changedTaskId: "c1",
  shifted: [{ taskId: "c6", oldDue: "2026-06-10", newDue: "2026-06-13", deltaDays: 3 }],
  gateImpacts: [{ taskId: "c6", gateName: "概念评审", oldDue: "2026-06-10", newDue: "2026-06-13", deltaDays: 3 }],
  targetBreach: null,
  maxDeltaDays: 3,
  hasImpact: true,
};

describe("delay_impact_notify 规则", () => {
  it("已注册到 AUTOMATION_RULES / KEYS", () => {
    expect(rule).toBeTruthy();
    expect(AUTOMATION_RULE_KEYS).toContain("delay_impact_notify");
    expect(rule.triggerType).toBe("event");
    expect(rule.recipientRoles).toContain("pm");
  });

  it("matches 仅在 action=task.rescheduled 且 impact.hasImpact 时为真", () => {
    const cfg = rule.defaultConfig;
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact } as any, cfg)).toBe(true);
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact: { ...impact, hasImpact: false } } as any, cfg)).toBe(false);
    expect(rule.matches({ action: "issue.create", entityType: "issue" } as any, cfg)).toBe(false);
  });

  it("支持按滑期阈值过滤", () => {
    const cfg = parseAutomationRuleConfig("delay_impact_notify", { minDeltaDays: 5 });
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact } as any, cfg)).toBe(false);
    const lower = parseAutomationRuleConfig("delay_impact_notify", { minDeltaDays: 3 });
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact } as any, lower)).toBe(true);
  });

  it("可关闭 Gate 通道，仅保留目标日冲击", () => {
    const cfg = parseAutomationRuleConfig("delay_impact_notify", { notifyGateImpacts: false });
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact } as any, cfg)).toBe(false);
    const withTarget = {
      ...impact,
      gateImpacts: [],
      targetBreach: {
        oldProjectedEnd: "2026-06-10",
        newProjectedEnd: "2026-06-15",
        targetDate: "2026-06-12",
        slipDays: 3,
        newlyBreaches: true,
      },
      maxDeltaDays: 0,
    };
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact: withTarget } as any, cfg)).toBe(true);
  });

  it("onlyNewTargetBreach=true 时不通知已破但继续恶化的目标日", () => {
    const cfg = parseAutomationRuleConfig("delay_impact_notify", {
      notifyGateImpacts: false,
      onlyNewTargetBreach: true,
    });
    const worsened = {
      ...impact,
      gateImpacts: [],
      targetBreach: {
        oldProjectedEnd: "2026-06-15",
        newProjectedEnd: "2026-06-18",
        targetDate: "2026-06-12",
        slipDays: 6,
        newlyBreaches: false,
      },
    };
    expect(rule.matches({ action: "task.rescheduled", entityType: "task", impact: worsened } as any, cfg)).toBe(false);
  });
});
