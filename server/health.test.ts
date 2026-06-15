import { describe, it, expect } from "vitest";
import { computeRag, type RagInput } from "@shared/health";

const base: RagInput = {
  risk: "low", projectedEnd: null, targetDate: null,
  overdueTasks: 0, blockedTasks: 0, openIssues: 0, criticalIssues: 0,
};

describe("computeRag", () => {
  it("一切正常 → green", () => {
    expect(computeRag(base)).toBe("green");
  });
  it("high risk → red", () => {
    expect(computeRag({ ...base, risk: "high" })).toBe("red");
  });
  it("预计超期(projectedEnd > targetDate) → red", () => {
    expect(computeRag({ ...base, projectedEnd: "2026-09-01", targetDate: "2026-08-01" })).toBe("red");
  });
  it("有逾期任务 → red", () => {
    expect(computeRag({ ...base, overdueTasks: 2 })).toBe("red");
  });
  it("有 P0/P1 严重问题 → red", () => {
    expect(computeRag({ ...base, criticalIssues: 1 })).toBe("red");
  });
  it("medium risk 且无红灯条件 → amber", () => {
    expect(computeRag({ ...base, risk: "medium" })).toBe("amber");
  });
  it("有阻塞任务但无红灯 → amber", () => {
    expect(computeRag({ ...base, blockedTasks: 1 })).toBe("amber");
  });
  it("有开放问题(非严重)但无红灯 → amber", () => {
    expect(computeRag({ ...base, openIssues: 3 })).toBe("amber");
  });
  it("红灯优先于黄灯：high risk + blocked → red", () => {
    expect(computeRag({ ...base, risk: "high", blockedTasks: 5 })).toBe("red");
  });
});
