import { describe, expect, it } from "vitest";
import { rollupPortfolioMetrics } from "@shared/portfolio-metrics";
import type { ProjectMetrics } from "@shared/metrics";

function makeMetrics(over: {
  leadTimeDaysMedian?: number | null;
  overdueRatePct?: number | null;
  overdueCount?: number;
  dueDatedCount?: number;
  throughputByWeek?: { weekKey: string; count: number }[];
  plannedCount?: number;
  gateFirstPassRatePct?: number | null;
}): ProjectMetrics {
  return {
    efficiency: {
      leadTimeDaysMedian: over.leadTimeDaysMedian ?? null,
      leadTimeDaysP85: null,
      throughputByWeek: over.throughputByWeek ?? [],
      overdueRatePct: over.overdueRatePct ?? null,
      overdueCount: over.overdueCount ?? 0,
      dueDatedCount: over.dueDatedCount ?? 0,
      completedCount: 0,
      plannedCount: over.plannedCount ?? 0,
    },
    quality: { diValue: 0, openClose: [], bySeverity: [], byCategory: [] },
    burndown: { task: [], defect: [] },
    process: { gateFirstPassRatePct: over.gateFirstPassRatePct ?? null, phaseDurations: [] },
  };
}

describe("rollupPortfolioMetrics", () => {
  it("recentThroughput 只取末4周求和；不足4周全取", () => {
    const rollup = rollupPortfolioMetrics([
      { projectId: "a", name: "A", ragLevel: "green", metrics: makeMetrics({
        throughputByWeek: [
          { weekKey: "2026-W20", count: 5 },
          { weekKey: "2026-W21", count: 1 },
          { weekKey: "2026-W22", count: 2 },
          { weekKey: "2026-W23", count: 3 },
          { weekKey: "2026-W24", count: 4 },
        ],
      }) },
      { projectId: "b", name: "B", ragLevel: "green", metrics: makeMetrics({
        throughputByWeek: [{ weekKey: "2026-W23", count: 7 }],
      }) },
    ]);
    const a = rollup.rows.find((r) => r.projectId === "a")!;
    const b = rollup.rows.find((r) => r.projectId === "b")!;
    expect(a.recentThroughput).toBe(1 + 2 + 3 + 4);
    expect(b.recentThroughput).toBe(7);
    expect(rollup.aggregates.totalRecentThroughput).toBe(10 + 7);
  });

  it("行标量映射 + ragCounts", () => {
    const rollup = rollupPortfolioMetrics([
      { projectId: "a", name: "A", ragLevel: "red", metrics: makeMetrics({
        leadTimeDaysMedian: 6, overdueRatePct: 40, dueDatedCount: 5, overdueCount: 2,
        plannedCount: 6, gateFirstPassRatePct: 50,
      }) },
      { projectId: "b", name: "B", ragLevel: "amber", metrics: makeMetrics({ overdueRatePct: 10 }) },
      { projectId: "c", name: "C", ragLevel: "green", metrics: makeMetrics({}) },
    ]);
    const a = rollup.rows.find((r) => r.projectId === "a")!;
    expect(a.leadTimeDaysMedian).toBe(6);
    expect(a.overdueRatePct).toBe(40);
    expect(a.gateFirstPassRatePct).toBe(50);
    expect(a.plannedCount).toBe(6);
    expect(a.dueDatedCount).toBe(5);
    expect(a.overdueCount).toBe(2);
    expect(rollup.aggregates.projectCount).toBe(3);
    expect(rollup.aggregates.ragCounts).toEqual({ red: 1, amber: 1, green: 1 });
  });

  it("pooledOverdueRatePct 精确池化，不被高 plannedCount 项目放大", () => {
    const rollup = rollupPortfolioMetrics([
      { projectId: "a", name: "A", ragLevel: "red", metrics: makeMetrics({
        overdueRatePct: 100, dueDatedCount: 2, overdueCount: 2, plannedCount: 2,
      }) },
      { projectId: "b", name: "B", ragLevel: "green", metrics: makeMetrics({
        overdueRatePct: 10, dueDatedCount: 10, overdueCount: 1, plannedCount: 100,
      }) },
    ]);
    expect(rollup.aggregates.pooledOverdueRatePct).toBe(25);
  });

  it("ΣdueDatedCount=0 或空组合 → pooledOverdueRatePct=null", () => {
    expect(rollupPortfolioMetrics([]).aggregates.pooledOverdueRatePct).toBeNull();
    expect(rollupPortfolioMetrics([]).rows).toEqual([]);
    const noDue = rollupPortfolioMetrics([
      { projectId: "a", name: "A", ragLevel: "green", metrics: makeMetrics({ dueDatedCount: 0, overdueCount: 0 }) },
    ]);
    expect(noDue.aggregates.pooledOverdueRatePct).toBeNull();
  });

  it("默认按 overdueRatePct 降序，null 末尾", () => {
    const rollup = rollupPortfolioMetrics([
      { projectId: "lo", name: "lo", ragLevel: "green", metrics: makeMetrics({ overdueRatePct: 10 }) },
      { projectId: "null", name: "null", ragLevel: "green", metrics: makeMetrics({ overdueRatePct: null }) },
      { projectId: "hi", name: "hi", ragLevel: "red", metrics: makeMetrics({ overdueRatePct: 90 }) },
    ]);
    expect(rollup.rows.map((r) => r.projectId)).toEqual(["hi", "lo", "null"]);
  });
});
