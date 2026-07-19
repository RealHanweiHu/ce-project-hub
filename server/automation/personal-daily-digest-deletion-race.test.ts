import { describe, expect, it } from "vitest";
import type { PersonalDailyDigestItem } from "../db";
import { runPersonalDailyDigestScan, type PersonalDailyDigestDeps } from "./personalDailyDigest";

function item(projectId: string, projectName: string): PersonalDailyDigestItem {
  return {
    recipientUserId: 7,
    kind: "task_overdue",
    projectId,
    projectName,
    projectNumber: projectId,
    projectCategory: "npd",
    phaseId: "design",
    entityType: "task",
    entityId: `${projectId}:design:d1`,
    title: "d1",
    dueDate: "2026-07-17",
    status: "in_progress",
    severity: "high",
  };
}

describe("personal daily digest deletion race", () => {
  it("revalidates loaded items and omits a project deleted before delivery", async () => {
    const markdown: string[] = [];
    const runs: string[] = [];
    const deps = {
      getConfigRow: async () => ({
        enabled: true,
        config: {
          sendHour: 9,
          dueSoonDays: 3,
          includePendingReviews: true,
          includeProjectExceptions: true,
          pushDingtalk: true,
        },
      }),
      getItems: async () => [
        item("deleted-project", "已删除项目"),
        item("active-project", "仍活跃项目"),
      ],
      getActiveProjectIds: async () => new Set(["active-project"]),
      getProjectLikes: async () => new Map(),
      hasRun: async () => false,
      writeRun: async (_status: string, entityId: string) => { runs.push(entityId); },
      createNotification: async () => undefined,
      notifyDingtalk: async (_ids: number[], _title: string, body: string) => { markdown.push(body); },
      getDeliveryProfiles: async (ids: number[]) => new Map(ids.map((userId) => [
        userId,
        { userId, prefs: {}, immediateSent24h: 0 },
      ])),
    } as PersonalDailyDigestDeps;

    await runPersonalDailyDigestScan(new Date("2026-07-18T01:30:00Z"), deps);

    expect(markdown).toHaveLength(1);
    expect(markdown[0]).toContain("仍活跃项目");
    expect(markdown[0]).not.toContain("已删除项目");
    expect(runs).toEqual(["d:2026-07-18:7"]);
  });
});
