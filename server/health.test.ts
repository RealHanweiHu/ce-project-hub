import { describe, it, expect } from "vitest";
import { computeRag, ragReasons, type RagInput } from "@shared/health";

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

describe("computeRag 新信号", () => {
  it("目标日偏差 > 7 天 → red", () => {
    expect(computeRag({ ...base, projectedEnd: "2026-08-09", targetDate: "2026-08-01" })).toBe("red");
  });
  it("目标日偏差 1..7 天 → amber", () => {
    expect(computeRag({ ...base, projectedEnd: "2026-08-06", targetDate: "2026-08-01" })).toBe("amber");
  });
  it("目标日偏差 0 天 → green", () => {
    expect(computeRag({ ...base, projectedEnd: "2026-08-01", targetDate: "2026-08-01" })).toBe("green");
  });
  it("进度落后 > 20pt → red", () => {
    expect(computeRag({ ...base, progressBehindPct: 25 })).toBe("red");
  });
  it("进度落后 10..20pt → amber", () => {
    expect(computeRag({ ...base, progressBehindPct: 15 })).toBe("amber");
  });
  it("进度落后 < 10pt → green", () => {
    expect(computeRag({ ...base, progressBehindPct: 5 })).toBe("green");
  });
  it("进度 null → green（不误报）", () => {
    expect(computeRag({ ...base, progressBehindPct: null })).toBe("green");
  });
  it("gateNotReady red/amber", () => {
    expect(computeRag({ ...base, gateNotReady: "red" })).toBe("red");
    expect(computeRag({ ...base, gateNotReady: "amber" })).toBe("amber");
  });
});

describe("ragReasons 不短路", () => {
  it("多触发返回全部原因", () => {
    const r = ragReasons({
      ...base, risk: "high", overdueTasks: 2, criticalIssues: 1,
      projectedEnd: "2026-08-10", targetDate: "2026-08-01", progressBehindPct: 15, gateNotReady: "amber",
    });
    expect(r).toContain("风险:高");
    expect(r).toContain("逾期×2");
    expect(r).toContain("P0/P1×1");
    expect(r).toContain("预计晚9天");
    expect(r).toContain("进度落后15pt");
    expect(r.some((x) => x.startsWith("Gate"))).toBe(true);
  });
  it("绿项目返回空数组", () => {
    expect(ragReasons(base)).toEqual([]);
  });
});
