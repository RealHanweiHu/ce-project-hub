import { describe, expect, it } from "vitest";
import { toShanghaiISODate } from "./scheduler";

describe("automation scheduler date handling", () => {
  it("uses Asia/Shanghai date instead of UTC date", () => {
    expect(toShanghaiISODate(new Date("2026-06-20T16:30:00.000Z"))).toBe("2026-06-21");
  });

  it("keeps date-only strings unchanged", () => {
    expect(toShanghaiISODate("2026-06-21")).toBe("2026-06-21");
  });
});
