import { describe, expect, it } from "vitest";
import { computeProjectMetrics, type MetricIssue, type MetricTask } from "@shared/metrics";

const tasks: MetricTask[] = [
  { phaseId: "concept", createdAt: "2026-05-30", completedAt: "2026-06-02", dueDate: "2026-06-01", status: "done" },
  { phaseId: "concept", createdAt: "2026-06-01", completedAt: "2026-06-05", dueDate: "2026-06-06", status: "done" },
  { phaseId: "planning", createdAt: "2026-06-02", completedAt: "2026-06-10", dueDate: "2026-06-12", status: "done" },
  { phaseId: "planning", createdAt: "2026-06-04", completedAt: "2026-06-14", dueDate: "2026-06-14", status: "done" },
  { phaseId: "planning", createdAt: "2026-06-05", completedAt: null, dueDate: "2026-06-10", status: "in_progress" },
  { phaseId: "design", createdAt: "2026-06-06", completedAt: null, dueDate: null, status: "todo" },
];

const issues: MetricIssue[] = [
  { foundDate: "2026-05-30", closedDate: null, severity: "P0", status: "open", category: "hardware" },
  { foundDate: "2026-06-02", closedDate: "2026-06-10", severity: "P1", status: "closed", category: "software" },
  { foundDate: "2026-06-09", closedDate: null, severity: "P2", status: "in_progress", category: "software" },
  { foundDate: "2026-06-11", closedDate: null, severity: "P3", status: "open", category: "thermal" },
  { foundDate: "2026-06-12", closedDate: "2026-06-13", severity: "P0", status: "closed", category: "hardware" },
  { foundDate: "2026-06-13", closedDate: null, severity: "P1", status: "open", category: "hardware" },
];

function subject() {
  return computeProjectMetrics({
    tasks,
    issues,
    gates: [
      { phaseId: "concept", decision: "approved", roundNumber: 1 },
      { phaseId: "planning", decision: "rejected", roundNumber: 1 },
      { phaseId: "planning", decision: "approved", roundNumber: 2 },
    ],
    phases: [
      { phaseId: "concept", startDate: "2026-06-01", endDate: "2026-06-06" },
      { phaseId: "planning", startDate: null, endDate: null },
    ],
    window: { fromISO: "2026-06-01", toISO: "2026-06-14" },
    totalTaskCount: tasks.length,
  });
}

describe("computeProjectMetrics", () => {
  it("computes lead time median, P85, throughput, and overdue rate", () => {
    const metrics = subject();

    expect(metrics.efficiency.leadTimeDaysMedian).toBe(6);
    expect(metrics.efficiency.leadTimeDaysP85).toBe(10);
    expect(metrics.efficiency.completedCount).toBe(4);
    expect(metrics.efficiency.plannedCount).toBe(6);
    expect(metrics.efficiency.throughputByWeek).toEqual([
      { weekKey: "2026-W23", count: 2 },
      { weekKey: "2026-W24", count: 2 },
    ]);
    expect(metrics.efficiency.overdueRatePct).toBe(40);
  });

  it("computes DI, issue distributions, and open-close trend", () => {
    const metrics = subject();

    expect(metrics.quality.diValue).toBe(14.1);
    expect(metrics.quality.bySeverity).toEqual([
      { severity: "P0", count: 1 },
      { severity: "P1", count: 1 },
      { severity: "P2", count: 1 },
      { severity: "P3", count: 1 },
    ]);
    expect(metrics.quality.byCategory).toEqual([
      { category: "hardware", count: 2 },
      { category: "software", count: 1 },
      { category: "thermal", count: 1 },
    ]);
    expect(metrics.quality.openClose).toEqual([
      { weekKey: "2026-W23", opened: 1, closed: 0, cumulativeOpen: 2 },
      { weekKey: "2026-W24", opened: 4, closed: 2, cumulativeOpen: 4 },
    ]);
  });

  it("computes task and defect burndown from event dates", () => {
    const metrics = subject();

    expect(metrics.burndown.task.find((row) => row.dateISO === "2026-06-01")).toMatchObject({ remaining: 6, ideal: 6 });
    expect(metrics.burndown.task.find((row) => row.dateISO === "2026-06-05")).toMatchObject({ remaining: 4 });
    expect(metrics.burndown.task.find((row) => row.dateISO === "2026-06-14")).toMatchObject({ remaining: 2, ideal: 0 });
    expect(metrics.burndown.defect.find((row) => row.dateISO === "2026-06-01")).toEqual({ dateISO: "2026-06-01", remaining: 1 });
    expect(metrics.burndown.defect.find((row) => row.dateISO === "2026-06-10")).toEqual({ dateISO: "2026-06-10", remaining: 2 });
  });

  it("computes gate first-pass rate and phase durations", () => {
    const metrics = subject();

    expect(metrics.process.gateFirstPassRatePct).toBe(50);
    expect(metrics.process.phaseDurations).toEqual([
      // actualDays 从任务活动算(concept: 05-30→06-05 = 6天)，独立于计划的 5 天
      { phaseId: "concept", plannedDays: 5, actualDays: 6 },
      { phaseId: "planning", plannedDays: null, actualDays: 12 },
    ]);
  });

  it("returns nulls and empty series for empty or invalid windows", () => {
    const metrics = computeProjectMetrics({
      tasks: [],
      issues: [],
      gates: [],
      phases: [],
      window: { fromISO: "2026-06-14", toISO: "2026-06-01" },
      totalTaskCount: 0,
    });

    expect(metrics.efficiency.leadTimeDaysMedian).toBeNull();
    expect(metrics.efficiency.leadTimeDaysP85).toBeNull();
    expect(metrics.efficiency.overdueRatePct).toBeNull();
    expect(metrics.efficiency.throughputByWeek).toEqual([]);
    expect(metrics.quality.openClose).toEqual([]);
    expect(metrics.burndown.task).toEqual([]);
    expect(metrics.burndown.defect).toEqual([]);
    expect(metrics.process.gateFirstPassRatePct).toBeNull();
  });
});
