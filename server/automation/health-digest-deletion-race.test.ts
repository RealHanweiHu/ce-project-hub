import { describe, expect, it } from "vitest";
import { runHealthDigestScan, type HealthDigestDeps } from "./healthDigest";

describe("health digest deletion race", () => {
  it("drops a project that became inactive after the health snapshot loaded", async () => {
    const calls = { site: 0, dingtalk: 0, group: 0, runs: [] as string[] };
    let activeChecks = 0;
    const deps = {
      getConfigRow: async () => ({
        enabled: true,
        config: { cadence: "daily", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true },
      }),
      getHealth: async () => [{
        id: "deleted-project",
        name: "已删除项目",
        projectNumber: "P-1",
        category: "npd",
        risk: "high",
        ragLevel: "red",
        ragReasons: ["逾期"],
        currentPhase: "concept",
        targetDate: null,
        pmUserId: 7,
        pmName: "PM",
        overdueTasks: 1,
        blockedTasks: 0,
        openIssues: 0,
        criticalIssues: 0,
        plannedEnd: null,
        projectedEnd: null,
        plannedItems: 1,
        dueItems: 1,
        donePlannedItems: 0,
        progressBehindPct: 100,
        gateNotReady: null,
      }],
      getActiveProjectIds: async () => ++activeChecks === 1
        ? new Set(["deleted-project"])
        : new Set<string>(),
      hasRun: async () => false,
      writeRun: async (status: string) => { calls.runs.push(status); },
      createNotification: async () => { calls.site += 1; },
      notifyDingtalk: async () => { calls.dingtalk += 1; },
      getDeliveryProfiles: async () => new Map(),
      pushWebhook: async () => { calls.group += 1; },
    } as HealthDigestDeps;

    await runHealthDigestScan(new Date("2026-07-18T02:00:00Z"), deps);

    expect(calls).toEqual({ site: 0, dingtalk: 0, group: 0, runs: ["skipped"] });
    expect(activeChecks).toBe(3);
  });
});
