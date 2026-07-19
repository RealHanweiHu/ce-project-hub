import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildWeeklyEvent,
  cancelMeeting,
  DingtalkCalendarCreationUncertainError,
  upsertWeeklyMeeting,
} from "./dingtalkCalendar";
import {
  __setDingtalkConfigForTest,
  _resetTokenCacheForTest,
} from "./dingtalk";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(
    "DATABASE_URL",
    "postgres://app:secret@db.example.com:5432/cehub"
  );
  vi.stubEnv("DINGTALK_DELIVERY_MODE", "live");
  _resetTokenCacheForTest();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildWeeklyEvent", () => {
  it("computes first occurrence on/after start matching weekday + time, weekly recurrence until target", () => {
    // 2026-06-14 是周日(0)；weekday=3(周三) → 首次 2026-06-17 15:00
    const ev = buildWeeklyEvent({
      title: "项目周会",
      weekday: 3,
      time: "15:00",
      durationMin: 60,
      startDate: "2026-06-14",
      targetDate: "2026-08-01",
      timeZone: "Asia/Shanghai",
      attendees: ["u-1", "u-2"],
    });
    expect(ev.summary).toBe("项目周会");
    expect(ev.start.dateTime.startsWith("2026-06-17T15:00")).toBe(true);
    expect(ev.end.dateTime.startsWith("2026-06-17T16:00")).toBe(true);
    expect(ev.recurrence.pattern.type).toBe("weekly");
    expect(ev.recurrence.pattern.interval).toBe(1);
    expect(ev.recurrence.range.type).toBe("endDate");
    expect(ev.recurrence.range.endDate.startsWith("2026-08-01")).toBe(true);
    expect(ev.start.dateTime).toContain("+08:00");
    expect(ev.attendees.map(a => a.id)).toEqual(["u-1", "u-2"]);
    expect(ev.onlineMeetingInfo.type).toBe("dingtalk");
  });

  it("defaults recurrence to 13 weeks when no targetDate", () => {
    const ev = buildWeeklyEvent({
      title: "周会",
      weekday: 1,
      time: "10:00",
      durationMin: 30,
      startDate: "2026-06-14",
      targetDate: null,
      timeZone: "Asia/Shanghai",
      attendees: [],
    });
    expect(ev.recurrence.range.endDate.startsWith("2026-09-14")).toBe(true); // 周一 06-15 + 13 周
  });
});

const sampleEvent = buildWeeklyEvent({
  title: "x",
  weekday: 3,
  time: "15:00",
  durationMin: 60,
  startDate: "2026-06-14",
  targetDate: "2026-08-01",
  timeZone: "Asia/Shanghai",
  attendees: [],
});

describe("upsertWeeklyMeeting", () => {
  it("suppresses test-database calendar writes without an uncertain outcome", async () => {
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not call DingTalk"));

    await expect(
      upsertWeeklyMeeting({
        organizerUserId: "pm-1",
        existingEventId: null,
        event: sampleEvent,
      })
    ).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null (degrade) when dingtalk not configured", async () => {
    __setDingtalkConfigForTest({ appKey: "", appSecret: "" });
    const res = await upsertWeeklyMeeting({
      organizerUserId: "pm-1",
      existingEventId: null,
      event: sampleEvent,
    });
    expect(res).toBeNull();
  });

  it("creates event and returns eventId", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const u = String(url);
      if (u.includes("oauth2/accessToken"))
        return new Response(
          JSON.stringify({ accessToken: "tok", expireIn: 7200 }),
          { status: 200 }
        );
      return new Response(JSON.stringify({ id: "evt-123" }), { status: 200 });
    });
    const res = await upsertWeeklyMeeting({
      organizerUserId: "pm-1",
      existingEventId: null,
      event: sampleEvent,
    });
    expect(res).toBe("evt-123");
  });

  it("throws an uncertain outcome when a new-event request loses its response", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(
          JSON.stringify({ accessToken: "tok", expireIn: 7200 }),
          { status: 200 }
        );
      }
      throw new DOMException("timed out", "TimeoutError");
    });

    await expect(
      upsertWeeklyMeeting({
        organizerUserId: "pm-1",
        existingEventId: null,
        event: sampleEvent,
      })
    ).rejects.toBeInstanceOf(DingtalkCalendarCreationUncertainError);
  });

  it("throws an uncertain outcome when create succeeds without returning an event id", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(
          JSON.stringify({ accessToken: "tok", expireIn: 7200 }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await expect(
      upsertWeeklyMeeting({
        organizerUserId: "pm-1",
        existingEventId: null,
        event: sampleEvent,
      })
    ).rejects.toBeInstanceOf(DingtalkCalendarCreationUncertainError);
  });
});

describe("cancelMeeting", () => {
  it("keeps a production event handle retryable during an explicit delivery pause", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://app:secret@db.example.com:5432/cehub"
    );
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not call DingTalk"));

    await expect(cancelMeeting("pm-1", "evt-live")).resolves.toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("settles test-database cancellation locally without touching DingTalk", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://app:secret@db.example.com:5432/cehub_test_cleanup"
    );
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not call DingTalk"));

    await expect(cancelMeeting("pm-1", "evt-1")).resolves.toBe(true);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns false when dingtalk not configured", async () => {
    __setDingtalkConfigForTest({ appKey: "", appSecret: "" });
    const res = await cancelMeeting("pm-1", "evt-1");
    expect(res).toBe(false);
  });

  it("returns true when dingtalk delete succeeds", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const u = String(url);
      if (u.includes("oauth2/accessToken"))
        return new Response(
          JSON.stringify({ accessToken: "tok", expireIn: 7200 }),
          { status: 200 }
        );
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    });
    const res = await cancelMeeting("pm-1", "evt-1");
    expect(res).toBe(true);
  });

  it("treats an already-deleted remote event as an idempotent success", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(
          JSON.stringify({ accessToken: "tok", expireIn: 7200 }),
          { status: 200 }
        );
      }
      return new Response("", { status: 404 });
    });
    await expect(cancelMeeting("pm-1", "evt-gone")).resolves.toBe(true);
  });
});
