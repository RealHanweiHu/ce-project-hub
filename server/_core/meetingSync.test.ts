import { describe, it, expect, vi } from "vitest";
import { syncProjectMeeting } from "./meetingSync";
import { DingtalkCalendarCreationUncertainError } from "./dingtalkCalendar";

const baseProject = {
  id: "p1",
  name: "测试项目",
  startDate: "2026-06-14",
  targetDate: "2026-08-01",
  pmUserId: 1,
  dingtalkEventId: null,
};
const config = {
  enabled: true,
  weekday: 3,
  time: "15:00",
  durationMin: 60,
  title: "项目周会",
};

describe("syncProjectMeeting", () => {
  it("degrades to group push when PM has no dingtalk id", async () => {
    const pushed: string[] = [];
    const res = await syncProjectMeeting({
      project: baseProject,
      config,
      todayISO: "2026-06-15",
      members: [{ id: 1, dingtalkUserId: null, mobile: null }],
      deps: {
        resolveUserId: async () => null,
        upsert: async () => "should-not-be-called",
        saveEventId: async () => {},
        rollbackCreatedEvent: async () => true,
        groupPush: async t => {
          pushed.push(t);
        },
      },
    });
    expect(res.mode).toBe("group_push");
    expect(res.error).toMatch(/无法解析 PM/);
    expect(pushed.length).toBe(1);
  });

  it("creates dingtalk event when PM resolvable", async () => {
    let savedEvent = "";
    const res = await syncProjectMeeting({
      project: baseProject,
      config,
      todayISO: "2026-06-15",
      members: [{ id: 1, dingtalkUserId: "pm-x", mobile: null }],
      deps: {
        resolveUserId: async u => u.dingtalkUserId ?? null,
        upsert: async () => "evt-1",
        saveEventId: async (_pid, id) => {
          savedEvent = id ?? "";
        },
        rollbackCreatedEvent: async () => true,
        groupPush: async () => {},
      },
    });
    expect(res.mode).toBe("dingtalk");
    expect(res.eventId).toBe("evt-1");
    expect(savedEvent).toBe("evt-1");
  });

  it("does nothing when meeting disabled", async () => {
    const res = await syncProjectMeeting({
      project: baseProject,
      config: { ...config, enabled: false },
      todayISO: "2026-06-15",
      members: [],
      deps: {
        resolveUserId: async () => null,
        upsert: async () => null,
        saveEventId: async () => {},
        rollbackCreatedEvent: async () => true,
        groupPush: async () => {},
      },
    });
    expect(res.mode).toBe("skipped");
  });

  it("returns failed when fallback push is not sent", async () => {
    const res = await syncProjectMeeting({
      project: baseProject,
      config,
      todayISO: "2026-06-15",
      members: [{ id: 1, dingtalkUserId: null, mobile: null }],
      deps: {
        resolveUserId: async () => null,
        upsert: async () => "should-not-be-called",
        saveEventId: async () => {},
        rollbackCreatedEvent: async () => true,
        groupPush: async () => false,
      },
    });
    expect(res.mode).toBe("failed");
    expect(res.error).toMatch(/无法解析 PM/);
  });

  it("rolls back a newly-created remote event when saving its local handle fails", async () => {
    const rollbackCreatedEvent = vi.fn(async () => true);
    const groupPush = vi.fn(async () => true);

    const res = await syncProjectMeeting({
      project: baseProject,
      config,
      todayISO: "2026-06-15",
      members: [{ id: 1, dingtalkUserId: "pm-x", mobile: null }],
      deps: {
        resolveUserId: async user => user.dingtalkUserId ?? null,
        upsert: async () => "evt-new",
        saveEventId: async () => {
          throw new Error("database unavailable");
        },
        rollbackCreatedEvent,
        groupPush,
      },
    });

    expect(rollbackCreatedEvent).toHaveBeenCalledWith("pm-x", "evt-new");
    expect(groupPush).not.toHaveBeenCalled();
    expect(res).toMatchObject({ mode: "failed" });
    expect(res.eventId).toBeUndefined();
    expect(res.error).toMatch(/本地.*保存失败.*已回滚/);
  });

  it("returns the remote id for durable recovery when creation rollback fails", async () => {
    const rollbackCreatedEvent = vi.fn(async () => false);

    const res = await syncProjectMeeting({
      project: baseProject,
      config,
      todayISO: "2026-06-15",
      members: [{ id: 1, dingtalkUserId: "pm-x", mobile: null }],
      deps: {
        resolveUserId: async user => user.dingtalkUserId ?? null,
        upsert: async () => "evt-orphan-risk",
        saveEventId: async () => {
          throw new Error("write failed");
        },
        rollbackCreatedEvent,
        groupPush: async () => true,
      },
    });

    expect(res).toMatchObject({
      mode: "failed",
      eventId: "evt-orphan-risk",
    });
    expect(res.error).toContain("回滚失败");
    expect(res.error).toContain("evt-orphan-risk");
  });

  it("keeps an uncertain remote create pending instead of sending a fallback", async () => {
    const groupPush = vi.fn(async () => true);
    const res = await syncProjectMeeting({
      project: baseProject,
      config,
      todayISO: "2026-06-15",
      members: [{ id: 1, dingtalkUserId: "pm-x", mobile: null }],
      deps: {
        resolveUserId: async user => user.dingtalkUserId ?? null,
        upsert: async () => {
          throw new DingtalkCalendarCreationUncertainError(
            "钉钉可能已创建周会，但未返回日程 ID"
          );
        },
        saveEventId: async () => {},
        rollbackCreatedEvent: async () => true,
        groupPush,
      },
    });

    expect(res).toMatchObject({ mode: "failed", uncertain: true });
    expect(groupPush).not.toHaveBeenCalled();
  });
});
