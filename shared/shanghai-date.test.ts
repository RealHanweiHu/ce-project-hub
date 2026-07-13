import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  nextShanghaiMorning,
  shanghaiMorningAfterCalendarDays,
  shanghaiDateKey,
  shanghaiDayNumber,
  shanghaiParts,
  todayShanghai,
} from "./shanghai-date";

describe("Shanghai date utilities", () => {
  it("uses the Shanghai calendar boundary independent of the host timezone", () => {
    expect(todayShanghai(new Date("2026-06-20T15:59:59Z"))).toBe("2026-06-20");
    expect(todayShanghai(new Date("2026-06-20T16:00:00Z"))).toBe("2026-06-21");
    expect(shanghaiDateKey("2026-06-20")).toBe("2026-06-20");
    expect(shanghaiDateKey("not-a-date")).toBeNull();
  });

  it("adds and compares ISO calendar days across month boundaries", () => {
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
    expect(daysBetween("2026-06-30", "2026-07-02")).toBe(2);
    expect(daysBetween("2026-07-02", "2026-06-30")).toBe(-2);
  });

  it("returns stable Shanghai parts and day numbers", () => {
    expect(shanghaiParts(new Date("2026-06-15T22:00:00Z"))).toEqual({
      todayISO: "2026-06-16",
      hour: 6,
      isoWeekday: 2,
    });
    expect(shanghaiDayNumber(new Date("2026-06-20T16:30:00Z"))).toBe(
      shanghaiDayNumber("2026-06-21"),
    );
    expect(shanghaiDayNumber("2026-13-99")).toBeNull();
  });

  it("snoozes to this morning before 08:00 and the next morning from 08:00", () => {
    expect(nextShanghaiMorning(new Date("2026-06-20T23:59:59Z")).toISOString()).toBe(
      "2026-06-21T00:00:00.000Z",
    );
    expect(nextShanghaiMorning(new Date("2026-06-21T00:00:00Z")).toISOString()).toBe(
      "2026-06-22T00:00:00.000Z",
    );
  });

  it("resolves a future Shanghai calendar morning independent of host DST", () => {
    expect(shanghaiMorningAfterCalendarDays(
      new Date("2026-07-12T23:30:00.000Z"),
      2,
    ).toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(shanghaiMorningAfterCalendarDays(
      new Date("2026-03-08T06:30:00.000Z"),
      2,
    ).toISOString()).toBe("2026-03-10T00:00:00.000Z");
  });
});
