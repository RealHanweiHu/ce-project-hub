import { describe, expect, it } from "vitest";
import { notifyPersonal, type NotifyPersonalDeps } from "./notification-gateway";

describe("notification gateway project scope", () => {
  it("does not write or push when the project was deleted before delivery", async () => {
    const site: number[] = [];
    const dingtalk: number[][] = [];
    const deps = {
      isProjectActive: async () => false,
      createNotification: async (row: { userId: number }) => { site.push(row.userId); },
      notifyDingtalk: async (userIds: number[]) => { dingtalk.push(userIds); },
      getDeliveryProfiles: async () => new Map(),
    } as NotifyPersonalDeps;

    const result = await notifyPersonal({
      eventKey: "critical_issue",
      projectId: "deleted-project",
      userIds: [7],
      title: "不应再发送",
      priority: "critical",
    }, deps);

    expect(result).toEqual({ site: 0, dingtalk: 0, failed: 0, skipped: 1, errors: [] });
    expect(site).toEqual([]);
    expect(dingtalk).toEqual([]);
  });

  it("rechecks after recipient lookup and skips the remote push if deletion started", async () => {
    let checks = 0;
    let site = 0;
    let dingtalk = 0;
    const deps = {
      isProjectActive: async () => ++checks < 3,
      createNotification: async () => { site += 1; },
      notifyDingtalk: async () => { dingtalk += 1; },
      getDeliveryProfiles: async (userIds: number[]) => new Map(userIds.map((userId) => [
        userId,
        { userId, prefs: {}, immediateSent24h: 0 },
      ])),
    } as NotifyPersonalDeps;

    const result = await notifyPersonal({
      eventKey: "critical_issue",
      projectId: "deleting-project",
      userIds: [7],
      title: "删除中不应再推送",
      priority: "critical",
    }, deps);

    expect(result.dingtalk).toBe(0);
    expect(result.skipped).toBe(1);
    expect(site).toBe(1);
    expect(dingtalk).toBe(0);
    expect(checks).toBe(3);
  });
});
