import { describe, it, expect } from "vitest";
import { syncProjectMeeting } from "./meetingSync";

const baseProject = { id: "p1", name: "测试项目", startDate: "2026-06-14", targetDate: "2026-08-01", pmUserId: 1, dingtalkEventId: null };
const config = { enabled: true, weekday: 3, time: "15:00", durationMin: 60, title: "项目周会" };

describe("syncProjectMeeting", () => {
  it("degrades to group push when PM has no dingtalk id", async () => {
    const pushed: string[] = [];
    const res = await syncProjectMeeting({
      project: baseProject, config, todayISO: "2026-06-15", members: [{ id: 1, dingtalkUserId: null, mobile: null }],
      deps: {
        resolveUserId: async () => null,
        upsert: async () => "should-not-be-called",
        saveEventId: async () => {},
        groupPush: async (t) => { pushed.push(t); },
      },
    });
    expect(res.mode).toBe("group_push");
    expect(pushed.length).toBe(1);
  });

  it("creates dingtalk event when PM resolvable", async () => {
    let savedEvent = "";
    const res = await syncProjectMeeting({
      project: baseProject, config, todayISO: "2026-06-15", members: [{ id: 1, dingtalkUserId: "pm-x", mobile: null }],
      deps: {
        resolveUserId: async (u) => u.dingtalkUserId ?? null,
        upsert: async () => "evt-1",
        saveEventId: async (_pid, id) => { savedEvent = id ?? ""; },
        groupPush: async () => {},
      },
    });
    expect(res.mode).toBe("dingtalk");
    expect(savedEvent).toBe("evt-1");
  });

  it("marks pending_sync when event creation cannot be confirmed", async () => {
    let savedEvent: string | null = null;
    const pushed: string[] = [];
    const res = await syncProjectMeeting({
      project: baseProject, config, todayISO: "2026-06-15", members: [{ id: 1, dingtalkUserId: "pm-x", mobile: null }],
      deps: {
        resolveUserId: async (u) => u.dingtalkUserId ?? null,
        upsert: async () => null,
        saveEventId: async (_pid, id) => { savedEvent = id; },
        groupPush: async (t) => { pushed.push(t); },
      },
    });
    expect(res.mode).toBe("group_push");
    expect(savedEvent).toBe("pending_sync");
    expect(pushed.length).toBe(1);
  });

  it("does not overwrite an existing real event id when update fails", async () => {
    let saved = false;
    const res = await syncProjectMeeting({
      project: { ...baseProject, dingtalkEventId: "evt-old" }, config, todayISO: "2026-06-15", members: [{ id: 1, dingtalkUserId: "pm-x", mobile: null }],
      deps: {
        resolveUserId: async (u) => u.dingtalkUserId ?? null,
        upsert: async () => null,
        saveEventId: async () => { saved = true; },
        groupPush: async () => {},
      },
    });
    expect(res.mode).toBe("group_push");
    expect(saved).toBe(false);
  });

  it("does nothing when meeting disabled", async () => {
    const res = await syncProjectMeeting({
      project: baseProject, config: { ...config, enabled: false }, todayISO: "2026-06-15", members: [],
      deps: { resolveUserId: async () => null, upsert: async () => null, saveEventId: async () => {}, groupPush: async () => {} },
    });
    expect(res.mode).toBe("skipped");
  });
});
