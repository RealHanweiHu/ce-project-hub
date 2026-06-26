import { describe, expect, it } from "vitest";
import { toShanghaiISODate } from "./scheduler";
import { taskDisplayTitle } from "../task-title";

describe("automation scheduler date handling", () => {
  it("uses Asia/Shanghai date instead of UTC date", () => {
    expect(toShanghaiISODate(new Date("2026-06-20T16:30:00.000Z"))).toBe("2026-06-21");
  });

  it("keeps date-only strings unchanged", () => {
    expect(toShanghaiISODate("2026-06-21")).toBe("2026-06-21");
  });
});

describe("automation scheduler reminder titles", () => {
  it("uses the SOP task name for the project category", () => {
    expect(taskDisplayTitle({ projectCategory: "idr", taskId: "id1" })).toBe("ID/CMF 详细设计");
  });

  it("matches SOP task ids case-insensitively", () => {
    expect(taskDisplayTitle({ projectCategory: "idr", taskId: "IR1" })).toBe("翻新需求与边界定义");
  });

  it("uses the markdown heading for generated non-SOP tasks", () => {
    expect(taskDisplayTitle({
      projectCategory: "npd",
      taskId: "pd_rd_mech",
      instructions: "# 产品定义交接 - 结构/ID\n\n请确认输入。",
    })).toBe("产品定义交接 - 结构/ID");
  });

  it("falls back to taskId when the SOP template has no matching task", () => {
    expect(taskDisplayTitle({ projectCategory: "idr", taskId: "UNKNOWN-1" })).toBe("UNKNOWN-1");
  });
});
