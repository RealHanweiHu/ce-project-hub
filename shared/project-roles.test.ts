import { describe, expect, it } from "vitest";
import {
  isShanghaiDateInInclusiveRange,
  normalizeExtraRoles,
} from "./project-roles";

describe("project role normalization", () => {
  it("filters invalid/owner/primary roles, deduplicates, and returns canonical order", () => {
    expect(normalizeExtraRoles("qa", [
      "scm",
      "qa",
      "scm",
      "owner",
      "not-a-role",
      null,
      "rd_hw",
    ])).toEqual(["rd_hw", "scm"]);
  });

  it("treats malformed extraRoles as an empty compatible legacy value", () => {
    expect(normalizeExtraRoles("pm", null)).toEqual([]);
    expect(normalizeExtraRoles("pm", { role: "qa" })).toEqual([]);
  });
});

describe("Shanghai delegation date range", () => {
  it("includes both start and end dates", () => {
    expect(isShanghaiDateInInclusiveRange("2026-07-12", "2026-07-12", "2026-07-14")).toBe(true);
    expect(isShanghaiDateInInclusiveRange("2026-07-14", "2026-07-12", "2026-07-14")).toBe(true);
  });

  it("rejects dates outside the range or an inverted range", () => {
    expect(isShanghaiDateInInclusiveRange("2026-07-11", "2026-07-12", "2026-07-14")).toBe(false);
    expect(isShanghaiDateInInclusiveRange("2026-07-15", "2026-07-12", "2026-07-14")).toBe(false);
    expect(isShanghaiDateInInclusiveRange("2026-07-12", "2026-07-14", "2026-07-12")).toBe(false);
  });
});
