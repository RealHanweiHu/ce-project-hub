import { afterEach, describe, expect, it } from "vitest";
import type { ActivityLog } from "../../drizzle/schema";
import { activityLogToAutomationEvent, runActivityLogTailerOnce } from "./activityLogTailer";

function log(overrides: Partial<ActivityLog>): ActivityLog {
  return {
    id: 1,
    projectId: "p1",
    userId: 10,
    action: "issue.create",
    entityType: "issue",
    entityId: "101",
    meta: null,
    createdAt: new Date("2026-07-07T00:00:00Z"),
    ...overrides,
  };
}

describe("activity log tailer mapping", () => {
  it("maps issue updates with before/after snapshots", () => {
    const event = activityLogToAutomationEvent(log({
      id: 11,
      action: "issue.update",
      meta: {
        before: { id: 101, title: "开机失败", severity: "P1" },
        after: { id: 101, title: "开机失败", severity: "P0" },
      },
    }));

    expect(event).toMatchObject({
      action: "issue.update",
      projectId: "p1",
      entityType: "issue",
      entityId: "101",
      actorId: 10,
      before: { severity: "P1" },
      after: { severity: "P0" },
    });
  });

  it("maps task reschedule logs including impact payload", () => {
    const event = activityLogToAutomationEvent(log({
      id: 12,
      action: "task.rescheduled",
      entityType: "task",
      entityId: "c1",
      meta: {
        phaseId: "concept",
        after: { taskId: "c1", title: "概念评审" },
        impact: { hasImpact: true, maxDeltaDays: 3, gateImpacts: [], shifted: [], targetBreach: null },
      },
    }));

    expect(event).toMatchObject({
      action: "task.rescheduled",
      entityType: "task",
      entityId: "p1:concept:c1",
      after: { title: "概念评审" },
      impact: { hasImpact: true },
    });
  });

  it("maps phase.advance audit rows to phase.advanced automation events", () => {
    const event = activityLogToAutomationEvent(log({
      id: 13,
      action: "phase.advance",
      entityType: "phase",
      entityId: "design",
      meta: {
        projectId: "p1",
        fromPhaseId: "concept",
        phaseId: "design",
        phaseName: "设计阶段",
      },
    }));

    expect(event).toMatchObject({
      action: "phase.advanced",
      entityType: "phase",
      entityId: "design",
      after: { fromPhaseId: "concept", phaseId: "design" },
    });
  });
});

describe("activity log tailer cursor", () => {
  const previousReplay = process.env.ACTIVITY_LOG_TAILER_REPLAY_HISTORY;

  afterEach(() => {
    if (previousReplay === undefined) delete process.env.ACTIVITY_LOG_TAILER_REPLAY_HISTORY;
    else process.env.ACTIVITY_LOG_TAILER_REPLAY_HISTORY = previousReplay;
  });

  it("initializes to the latest log id on first run instead of replaying history", async () => {
    delete process.env.ACTIVITY_LOG_TAILER_REPLAY_HISTORY;
    const finishes: Array<Record<string, unknown>> = [];
    let listed = false;
    let dispatched = false;

    const result = await runActivityLogTailerOnce({
      tryStartAutomationHeartbeat: async () => true,
      getAutomationHeartbeat: async () => ({ lastCursorId: 0, lastFinishedAt: null }) as any,
      getLatestActivityLogId: async () => 42,
      listActivityLogsAfter: async () => {
        listed = true;
        return [];
      },
      finishAutomationHeartbeat: async (input) => { finishes.push(input); },
      runAutomation: async () => { dispatched = true; },
    });

    expect(result).toEqual({ cursorId: 42, processed: 0, skipped: 0, initialized: true });
    expect(listed).toBe(false);
    expect(dispatched).toBe(false);
    expect(finishes[0]).toMatchObject({ status: "skipped", lastCursorId: 42 });
  });

  it("processes new logs and advances the cursor past skipped rows", async () => {
    process.env.ACTIVITY_LOG_TAILER_REPLAY_HISTORY = "true";
    const events: unknown[] = [];
    const finishes: Array<Record<string, unknown>> = [];

    const result = await runActivityLogTailerOnce({
      tryStartAutomationHeartbeat: async () => true,
      getAutomationHeartbeat: async () => ({ lastCursorId: 7, lastFinishedAt: new Date() }) as any,
      getLatestActivityLogId: async () => 99,
      listActivityLogsAfter: async (cursorId) => {
        expect(cursorId).toBe(7);
        return [
          log({ id: 8, action: "issue.create", meta: { title: "P0", severity: "P0" } }),
          log({ id: 9, action: "file.upload", entityType: "file" }),
        ];
      },
      finishAutomationHeartbeat: async (input) => { finishes.push(input); },
      runAutomation: async (event) => { events.push(event); },
    });

    expect(events).toHaveLength(1);
    expect(result).toMatchObject({ cursorId: 9, processed: 1, skipped: 1, initialized: false });
    expect(finishes[0]).toMatchObject({ status: "success", lastCursorId: 9 });
  });
});
