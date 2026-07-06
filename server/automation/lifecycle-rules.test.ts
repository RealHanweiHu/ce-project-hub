import { describe, it, expect } from "vitest";
import { getAutomationRule, isAutomationRuleMatch, type AutomationEvent } from "./rules";

/**
 * NPD 生命周期三事件的自动化规则：
 * - definition_confirmed_notify：产品定义冻结 → 通知派生项目的 PM（旧行为：无事件，口头传达）
 * - gate_decision_notify：Gate 决策（create 即终态 / update 改决策）→ 通知 PM/管理层/群
 * - phase_advanced_notify：Gate 通过推进阶段 → 通知 PM/群，下一阶段角色启动
 */
describe("definition_confirmed_notify", () => {
  const event: AutomationEvent = {
    action: "product.definition_confirmed",
    projectId: "p1",
    entityType: "product_definition",
    entityId: "prod-1",
    after: { productName: "Pocket E-Pump R1", versionNumber: 3, projectId: "p1" },
  };

  it("匹配 product.definition_confirmed 事件", () => {
    expect(isAutomationRuleMatch("definition_confirmed_notify", event)).toBe(true);
  });

  it("不匹配其他事件", () => {
    expect(isAutomationRuleMatch("definition_confirmed_notify", { ...event, action: "issue.create" })).toBe(false);
  });

  it("消息含产品名与版本号", () => {
    const rule = getAutomationRule("definition_confirmed_notify")!;
    const msg = rule.buildMessage(event, rule.defaultConfig, { projectName: "Decathlon NPD", entityTitle: null, productName: "Pocket E-Pump R1", revisionLabel: null });
    expect(msg.text).toContain("Pocket E-Pump R1");
    expect(msg.text).toContain("3");
  });

  it("默认启用", () => {
    expect(getAutomationRule("definition_confirmed_notify")!.defaultEnabled).toBe(true);
  });
});

describe("gate_decision_notify", () => {
  const base: AutomationEvent = {
    action: "gate.create",
    projectId: "p1",
    entityType: "gate_review",
    entityId: 9,
    after: { decision: "conditional", conditions: "补齐 DVT 振动报告", gateName: "EVT Gate", phaseId: "evt" },
  };

  it("gate.create 即终态：匹配", () => {
    expect(isAutomationRuleMatch("gate_decision_notify", base)).toBe(true);
  });

  it("gate.update 改了 decision：匹配；没改：不匹配", () => {
    const changed: AutomationEvent = {
      ...base, action: "gate.update",
      before: { decision: "rejected" }, after: { ...base.after, decision: "approved" },
    };
    expect(isAutomationRuleMatch("gate_decision_notify", changed)).toBe(true);
    const unchanged: AutomationEvent = {
      ...base, action: "gate.update",
      before: { decision: "conditional" }, after: { ...base.after, decision: "conditional" },
    };
    expect(isAutomationRuleMatch("gate_decision_notify", unchanged)).toBe(false);
  });

  it("非 gate 事件不匹配", () => {
    expect(isAutomationRuleMatch("gate_decision_notify", { ...base, entityType: "issue", action: "issue.update" })).toBe(false);
  });

  it("conditional 消息带条件文本", () => {
    const rule = getAutomationRule("gate_decision_notify")!;
    const msg = rule.buildMessage(base, rule.defaultConfig, { projectName: "Decathlon NPD", entityTitle: "EVT Gate", productName: null, revisionLabel: null });
    expect(msg.text).toContain("有条件通过");
    expect(msg.markdown ?? msg.text).toContain("补齐 DVT 振动报告");
  });

  it("rejected 消息为未通过口径", () => {
    const rule = getAutomationRule("gate_decision_notify")!;
    const ev: AutomationEvent = { ...base, after: { ...base.after, decision: "rejected" } };
    const msg = rule.buildMessage(ev, rule.defaultConfig, { projectName: null, entityTitle: "EVT Gate", productName: null, revisionLabel: null });
    expect(msg.text).toContain("未通过");
  });
});

describe("phase_advanced_notify", () => {
  const event: AutomationEvent = {
    action: "phase.advanced",
    projectId: "p1",
    entityType: "phase",
    entityId: "p1:dvt",
    after: { projectId: "p1", fromPhaseId: "evt", fromPhaseName: "EVT", phaseId: "dvt", phaseName: "DVT" },
  };

  it("匹配 phase.advanced", () => {
    expect(isAutomationRuleMatch("phase_advanced_notify", event)).toBe(true);
    expect(isAutomationRuleMatch("phase_advanced_notify", { ...event, action: "gate.create" })).toBe(false);
  });

  it("消息包含新阶段", () => {
    const rule = getAutomationRule("phase_advanced_notify")!;
    const msg = rule.buildMessage(event, rule.defaultConfig, { projectName: "Decathlon NPD", entityTitle: null, productName: null, revisionLabel: null });
    expect(msg.text).toContain("DVT");
  });

  it("默认启用且默认推群", () => {
    const rule = getAutomationRule("phase_advanced_notify")!;
    expect(rule.defaultEnabled).toBe(true);
    expect((rule.defaultConfig as { pushGroup?: boolean }).pushGroup).toBe(true);
  });
});
