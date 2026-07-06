import { describe, expect, it } from "vitest";
import { isAutomationSuppressedProject } from "./project-filter";

describe("automation project suppression", () => {
  it("suppresses known automated test fixture projects", () => {
    expect(isAutomationSuppressedProject({ id: "proj_autoeng", name: "自动化引擎测试项目" })).toBe(true);
    expect(isAutomationSuppressedProject({ id: "smoke_test_proj_01", name: "Smoke Test Project" })).toBe(true);
    expect(isAutomationSuppressedProject({ id: `cal-test-${Date.now()}`, name: "日历测试项目" })).toBe(true);
    expect(isAutomationSuppressedProject({ id: `role-rank-m-${Date.now()}`, name: "角色不降权测试" })).toBe(true);
    expect(isAutomationSuppressedProject({ id: "qa-login-project", name: "登录验证项目" })).toBe(true);
    expect(isAutomationSuppressedProject({ id: "demo-004", name: "扫地机器人 Vmax" })).toBe(true);
  });

  it("does not suppress ordinary business projects with testing-related wording", () => {
    expect(isAutomationSuppressedProject({ id: "npd-2026-qa-validation", name: "新品可靠性测试计划" })).toBe(false);
    expect(isAutomationSuppressedProject({ id: "customer-testline-pilot", name: "客户测试线试产导入" })).toBe(false);
  });

  it("supports an explicit project-level suppression flag", () => {
    expect(isAutomationSuppressedProject({
      id: "npd-2026-sandbox",
      name: "沙盒项目",
      customFields: { suppressAutomation: true },
    })).toBe(true);
  });
});
