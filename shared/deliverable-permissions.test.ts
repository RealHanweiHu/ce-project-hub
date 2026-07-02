import { describe, it, expect } from "vitest";
import { preferredDeliverableReviewerRoles, canRoleContributeToDeliverable } from "./deliverable-permissions";

/**
 * P1-9：SALES_RE 过宽——裸「确认/签核」把工程交付物（关键料件规格确认、
 * 图纸/规格完整性确认）错判成 sales 所有，使 sales 成为工程评审的默认审核人。
 * 收紧到真正的商业词（客户/渠道/销售/市场/上市/售后/VoC）。
 */
describe("deliverable 权限路由", () => {
  it("工程类「确认」交付物不再路由到 sales", () => {
    expect(preferredDeliverableReviewerRoles("关键料件规格确认")).not.toContain("sales");
    expect(preferredDeliverableReviewerRoles("图纸/规格完整性确认")).not.toContain("sales");
    expect(preferredDeliverableReviewerRoles("硬件影响确认")).not.toContain("sales");
  });

  it("真正的商业交付物仍路由到 sales", () => {
    expect(preferredDeliverableReviewerRoles("客户签样记录")).toContain("sales");
    expect(preferredDeliverableReviewerRoles("市场与渠道切换方案")).toContain("sales");
    expect(preferredDeliverableReviewerRoles("上市计划")).toContain("sales");
  });

  it("电池/认证/供应/质量交付物路由稳定", () => {
    expect(preferredDeliverableReviewerRoles("UN38.3运输测试报告或复用确认")).toContain("battery_safety");
    expect(preferredDeliverableReviewerRoles("BOM v1.0")).toContain("scm");
    expect(preferredDeliverableReviewerRoles("功能测试报告")).toContain("qa");
  });

  it("料件规格确认可由 scm 贡献（不是 sales）", () => {
    // 关键料件规格确认属采购/EE 范畴
    expect(canRoleContributeToDeliverable("scm", "关键料件规格确认")).toBe(true);
    expect(canRoleContributeToDeliverable("sales", "关键料件规格确认")).toBe(false);
  });
});
