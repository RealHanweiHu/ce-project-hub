import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    tasks: [] as Array<{ projectId: string; phaseId: string; taskId: string }>,
    issues: [] as Array<{ projectId: string; id: number }>,
    gates: [] as Array<{ projectId: string; phaseId: string; gateTaskId: string; gateName: string; dueDate: string; status: string }>,
  };
  const sliceBatch = <T>(rows: T[], input?: { limit?: number; offset?: number }) => {
    const limit = input?.limit ?? 500;
    const offset = input?.offset ?? 0;
    return rows.slice(offset, offset + limit);
  };
  return {
    state,
    getAutomationDueTasks: vi.fn((input?: { limit?: number; offset?: number }) => Promise.resolve(sliceBatch(state.tasks, input))),
    getAutomationDueIssues: vi.fn((input?: { limit?: number; offset?: number }) => Promise.resolve(sliceBatch(state.issues, input))),
    getApproachingGates: vi.fn(() => Promise.resolve(state.gates)),
    getGateReadiness: vi.fn(() => Promise.resolve({
      phaseId: "evt",
      gateName: "EVT Gate",
      ready: false,
      blockerCount: 1,
      dimensions: [{ key: "tasks", label: "任务", ok: false, summary: "仍有未完成任务" }],
    })),
    runAutomation: vi.fn(() => Promise.resolve()),
    runHealthDigestScan: vi.fn(() => Promise.resolve()),
    shanghaiParts: vi.fn(() => ({ todayISO: "2026-06-17", hour: 9, isoWeekday: 3 })),
  };
});

vi.mock("../db", () => ({
  getAutomationDueTasks: mocks.getAutomationDueTasks,
  getAutomationDueIssues: mocks.getAutomationDueIssues,
  getApproachingGates: mocks.getApproachingGates,
  getGateReadiness: mocks.getGateReadiness,
}));

vi.mock("./engine", () => ({
  runAutomation: mocks.runAutomation,
}));

vi.mock("./healthDigest", () => ({
  runHealthDigestScan: mocks.runHealthDigestScan,
  shanghaiParts: mocks.shanghaiParts,
}));

import { runScheduledAutomationScan } from "./scheduler";

describe("automation scheduler", () => {
  beforeEach(() => {
    mocks.state.tasks = [];
    mocks.state.issues = [];
    mocks.state.gates = [];
    mocks.getAutomationDueTasks.mockClear();
    mocks.getAutomationDueIssues.mockClear();
    mocks.getApproachingGates.mockClear();
    mocks.getGateReadiness.mockClear();
    mocks.runAutomation.mockReset();
    mocks.runAutomation.mockResolvedValue(undefined);
    mocks.runHealthDigestScan.mockReset();
    mocks.runHealthDigestScan.mockResolvedValue(undefined);
    mocks.shanghaiParts.mockClear();
  });

  it("loads due tasks in bounded batches using the Shanghai day key", async () => {
    mocks.state.tasks = Array.from({ length: 501 }, (_, index) => ({
      projectId: "p1",
      phaseId: "concept",
      taskId: `t${index}`,
    }));

    await runScheduledAutomationScan(new Date("2026-06-17T01:00:00Z"));

    expect(mocks.getAutomationDueTasks).toHaveBeenNthCalledWith(1, {
      todayISO: "2026-06-17",
      limit: 500,
      offset: 0,
    });
    expect(mocks.getAutomationDueTasks).toHaveBeenNthCalledWith(2, {
      todayISO: "2026-06-17",
      limit: 500,
      offset: 500,
    });
    expect(mocks.runAutomation).toHaveBeenCalledTimes(501);
  });

  it("runs gate readiness events from approaching gates", async () => {
    mocks.state.gates = [{
      projectId: "p1",
      phaseId: "evt",
      gateTaskId: "evt_gate",
      gateName: "EVT Gate",
      dueDate: "2026-06-18",
      status: "todo",
    }];

    await runScheduledAutomationScan(new Date("2026-06-17T01:00:00Z"));

    expect(mocks.getGateReadiness).toHaveBeenCalledWith("p1", "evt");
    expect(mocks.runAutomation).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "gate:p1:evt_gate",
      after: expect.objectContaining({
        isGate: true,
        gateName: "EVT Gate",
        notReady: true,
        blockerSummaries: ["仍有未完成任务"],
      }),
    }));
  });

  it("skips overlapping scans while one is still running", async () => {
    mocks.state.tasks = [{ projectId: "p1", phaseId: "concept", taskId: "t1" }];
    let releaseRun: (() => void) | undefined;
    mocks.runAutomation.mockImplementation(() => new Promise<void>((resolve) => {
      releaseRun = resolve;
    }));

    const firstScan = runScheduledAutomationScan(new Date("2026-06-17T01:00:00Z"));
    await vi.waitFor(() => expect(mocks.runAutomation).toHaveBeenCalledTimes(1));

    await runScheduledAutomationScan(new Date("2026-06-17T01:01:00Z"));
    expect(mocks.getAutomationDueTasks).toHaveBeenCalledTimes(1);

    releaseRun?.();
    await firstScan;
  });
});
