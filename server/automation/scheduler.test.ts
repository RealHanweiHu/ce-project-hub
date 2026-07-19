import { describe, expect, it, vi } from "vitest";
import { safeScan, toShanghaiISODate } from "./scheduler";

describe("scheduled scanner isolation", () => {
  it("does not load a disabled scanner", async () => {
    const load = vi.fn(async () => [1]);
    expect(await safeScan("disabled", false, load)).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("isolates one loader failure and keeps the scan usable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(safeScan("broken", true, async () => { throw new Error("db timeout"); })).resolves.toEqual([]);
    await expect(safeScan("healthy", true, async () => ["ok"])).resolves.toEqual(["ok"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("broken"), expect.any(Error));
    warn.mockRestore();
  });

  it("uses the Shanghai calendar date", () => {
    expect(toShanghaiISODate(new Date("2026-06-20T16:30:00Z"))).toBe("2026-06-21");
  });
});
