import { describe, expect, it } from "vitest";
import type { ActionItemSlaRow } from "../db";
import {
  nextActionItemSlaTransition,
  runActionItemSlaScan,
} from "./actionItemSla";

const NOW = new Date("2026-07-07T12:00:00Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function item(over: Partial<ActionItemSlaRow> = {}): ActionItemSlaRow {
  return {
    id: 1,
    kind: "task_approval",
    projectId: "p1",
    entityType: "task",
    entityId: "p1:design:d1",
    dedupeKey: "task_approval:p1:design:d1:7:owner",
    recipientUserId: 7,
    level: "owner",
    title: "任务待审批",
    body: "请审批",
    actionUrl: "https://hub.example.com/?view=projects&projectId=p1",
    status: "sent",
    priority: "high",
    dueAt: null,
    snoozedUntil: null,
    sourceActivityLogId: null,
    metadata: {},
    firstSentAt: hoursAgo(25),
    lastSentAt: hoursAgo(25),
    readAt: null,
    handledAt: null,
    closedAt: null,
    createdAt: hoursAgo(25),
    updatedAt: hoursAgo(25),
    projectName: "充气泵",
    projectNumber: "NPD-001",
    pmUserId: 11,
    managerUserIds: [22],
    ...over,
  };
}

function makeDeps(rows: ActionItemSlaRow[]) {
  const calls = {
    notifications: [] as Array<{ userId: number; title: string }>,
    dingtalk: [] as number[][],
    patched: [] as Array<{ id: number; patch: Record<string, unknown>; status?: string }>,
    marked: [] as number[],
    escalations: [] as Array<{ recipientUserId: number; level?: string; title: string; dedupeKey: string }>,
  };
  return {
    calls,
    deps: {
      now: NOW,
      listItems: async () => rows,
      createNotification: async (n: { userId: number; title: string }) => {
        calls.notifications.push({ userId: n.userId, title: n.title });
      },
      notifyDingtalk: async (ids: number[]) => {
        calls.dingtalk.push(ids);
      },
      getDeliveryProfiles: async (userIds: number[]) => new Map(userIds.map((userId) => [
        userId,
        { userId, prefs: {}, immediateSent24h: 0 },
      ])),
      patchItem: async (id: number, patch: Record<string, unknown>, status?: "escalated") => {
        calls.patched.push({ id, patch, status });
      },
      markSent: async (id: number) => {
        calls.marked.push(id);
      },
      notifyActionItem: async (input: { recipientUserId: number; level?: string; title: string; dedupeKey: string }) => {
        calls.escalations.push(input);
        return { dispatched: true, actionItemId: 99 };
      },
    },
  };
}

describe("action item SLA", () => {
  it("computes next transition by SLA stage", () => {
    expect(nextActionItemSlaTransition(item({ lastSentAt: hoursAgo(23), firstSentAt: hoursAgo(23), createdAt: hoursAgo(23) }), NOW)).toBeNull();
    expect(nextActionItemSlaTransition(item(), NOW)).toBe("owner_reminder");
    expect(nextActionItemSlaTransition(item({ metadata: { ownerRemindedAt: hoursAgo(25).toISOString() } }), NOW)).toBe("pm_escalation");
    expect(nextActionItemSlaTransition(item({ metadata: { ownerRemindedAt: hoursAgo(80).toISOString(), pmEscalatedAt: hoursAgo(49).toISOString() } }), NOW)).toBe("manager_escalation");
  });

  it("T1 reminds owner once and records metadata", async () => {
    const { deps, calls } = makeDeps([item()]);
    await runActionItemSlaScan(NOW, deps);
    expect(calls.notifications).toEqual([{ userId: 7, title: "SLA提醒：任务待审批" }]);
    expect(calls.dingtalk).toEqual([[7]]);
    expect(calls.marked).toEqual([1]);
    expect(calls.patched[0].patch.slaStage).toBe("owner_reminded");
  });

  it("T2 escalates to PM with level-specific dedupe key", async () => {
    const { deps, calls } = makeDeps([item({ metadata: { ownerRemindedAt: hoursAgo(25).toISOString() } })]);
    await runActionItemSlaScan(NOW, deps);
    expect(calls.escalations).toHaveLength(1);
    expect(calls.escalations[0].recipientUserId).toBe(11);
    expect(calls.escalations[0].level).toBe("pm");
    expect(calls.escalations[0].dedupeKey).toContain(":pm");
    expect(calls.patched[0].status).toBe("escalated");
    expect(calls.patched[0].patch.slaStage).toBe("pm_escalated");
  });

  it("does not escalate PM to the same owner", async () => {
    const { deps, calls } = makeDeps([item({ pmUserId: 7, metadata: { ownerRemindedAt: hoursAgo(25).toISOString() } })]);
    await runActionItemSlaScan(NOW, deps);
    expect(calls.escalations).toEqual([]);
    expect(calls.patched[0].patch.pmEscalationSkipped).toBe("same_recipient");
  });

  it("T3 escalates to one manager", async () => {
    const { deps, calls } = makeDeps([item({
      metadata: {
        ownerRemindedAt: hoursAgo(80).toISOString(),
        pmEscalatedAt: hoursAgo(49).toISOString(),
      },
    })]);
    await runActionItemSlaScan(NOW, deps);
    expect(calls.escalations).toHaveLength(1);
    expect(calls.escalations[0].recipientUserId).toBe(22);
    expect(calls.escalations[0].level).toBe("manager");
    expect(calls.patched[0].patch.slaStage).toBe("manager_escalated");
  });
});
