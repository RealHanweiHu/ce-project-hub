import { describe, expect, it } from "vitest";
import { notifyPersonal, type NotifyPersonalDeps } from "./notification-gateway";
import type { NotificationDeliveryProfile } from "./db";

function profile(input: Partial<NotificationDeliveryProfile> & { userId: number }): NotificationDeliveryProfile {
  return {
    userId: input.userId,
    prefs: input.prefs ?? {},
    immediateSent24h: input.immediateSent24h ?? 0,
  };
}

function depsFor(profiles: NotificationDeliveryProfile[], now: Date) {
  const site: Array<{ userId: number; title: string }> = [];
  const dingtalk: Array<{ userIds: number[]; title: string }> = [];
  const map = new Map(profiles.map((item) => [item.userId, item]));
  const deps: NotifyPersonalDeps = {
    now,
    createNotification: async (notification) => {
      site.push({ userId: notification.userId, title: notification.title });
    },
    notifyDingtalk: async (userIds, title) => {
      dingtalk.push({ userIds, title });
    },
    getDeliveryProfiles: async () => map,
  };
  return { deps, site, dingtalk };
}

describe("notification gateway delivery pressure", () => {
  it("delays non-critical DingTalk pushes during quiet hours", async () => {
    const { deps, site, dingtalk } = depsFor([profile({ userId: 7 })], new Date("2026-07-07T15:00:00Z"));

    const result = await notifyPersonal({
      eventKey: "task_approval",
      userIds: [7],
      title: "任务待审批",
      priority: "normal",
    }, deps);

    expect(result).toEqual({ site: 1, dingtalk: 0 });
    expect(site).toHaveLength(1);
    expect(dingtalk).toHaveLength(0);
  });

  it("keeps critical pushes immediate even during quiet hours", async () => {
    const { deps, dingtalk } = depsFor([profile({ userId: 7 })], new Date("2026-07-07T15:00:00Z"));

    const result = await notifyPersonal({
      eventKey: "critical_issue",
      userIds: [7],
      title: "P0 问题",
      priority: "critical",
    }, deps);

    expect(result.dingtalk).toBe(1);
    expect(dingtalk[0].userIds).toEqual([7]);
  });

  it("auto-downgrades lower-priority action pushes after a user's daily cap", async () => {
    const { deps, dingtalk } = depsFor([profile({ userId: 7, immediateSent24h: 10 })], new Date("2026-07-07T04:00:00Z"));

    const result = await notifyPersonal({
      eventKey: "task_approval",
      userIds: [7],
      title: "任务待审批",
      priority: "normal",
    }, deps);

    expect(result).toEqual({ site: 1, dingtalk: 0 });
    expect(dingtalk).toHaveLength(0);
  });
});
