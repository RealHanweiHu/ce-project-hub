import { describe, it, expect } from "vitest";
import { isDeliverableSatisfied, type DeliverableReviewStatus } from "@shared/deliverable-review";

describe("isDeliverableSatisfied", () => {
  it("无文件 → 不满足", () => {
    expect(isDeliverableSatisfied(false, null)).toBe(false);
    expect(isDeliverableSatisfied(false, "approved")).toBe(false);
  });
  it("有文件 + 无审核记录 → 不满足", () => {
    expect(isDeliverableSatisfied(true, null)).toBe(false);
  });
  it("有文件 + 已通过 → 满足", () => {
    expect(isDeliverableSatisfied(true, "approved")).toBe(true);
  });
  it("有文件 + 待审/驳回 → 不满足", () => {
    expect(isDeliverableSatisfied(true, "pending" as DeliverableReviewStatus)).toBe(false);
    expect(isDeliverableSatisfied(true, "rejected")).toBe(false);
  });
});
