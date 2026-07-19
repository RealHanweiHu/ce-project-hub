import { describe, expect, it } from "vitest";
import { SOP_TEMPLATE_VERSION_NPD_V3 } from "./sop-templates";
import {
  assertFourEyes,
  redlineKindForGateSlot,
  redlineKindForTask,
} from "./redline-four-eyes";

describe("redline four-eyes mapping", () => {
  const v3 = {
    category: "npd",
    sopTemplateVersion: SOP_TEMPLATE_VERSION_NPD_V3,
    customFields: { npdTemplate: { tier: "full", packs: ["battery", "certification"] } },
  };
  const legacy = { category: "npd", sopTemplateVersion: "2026-07-v2" };

  it("maps v3 and legacy redline task ids without matching normal tasks", () => {
    expect(redlineKindForTask(v3, "npv2")).toBe("safety_certification");
    expect(redlineKindForTask(v3, "npv5")).toBe("production_release");
    expect(redlineKindForTask(v3, "nm1")).toBe("customer_release");
    expect(redlineKindForTask(legacy, "d7a")).toBe("safety_certification");
    expect(redlineKindForTask(legacy, "pv8")).toBe("production_release");
    expect(redlineKindForTask(legacy, "mp1")).toBe("customer_release");
    expect(redlineKindForTask(v3, "npd1")).toBeNull();
  });

  it("maps release Gates and the two specialist redline slots", () => {
    expect(redlineKindForGateSlot(v3, "pvt", "qa")).toBe("production_release");
    expect(redlineKindForGateSlot(v3, "verification", "certification")).toBe("safety_certification");
    expect(redlineKindForGateSlot(v3, "verification", "customer")).toBe("customer_release");
  });

  it("compares natural people, not their selected roles", () => {
    expect(() => assertFourEyes(7, 7)).toThrow(/另一位自然人/);
    expect(() => assertFourEyes(7, 8)).not.toThrow();
  });
});
