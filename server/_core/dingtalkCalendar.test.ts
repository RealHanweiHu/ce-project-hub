import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildWeeklyEvent, upsertWeeklyMeeting } from "./dingtalkCalendar";
import { __setDingtalkConfigForTest, _resetTokenCacheForTest } from "./dingtalk";

beforeEach(() => { _resetTokenCacheForTest(); vi.restoreAllMocks(); });

describe("buildWeeklyEvent", () => {
  it("computes first occurrence on/after start matching weekday + time, weekly recurrence until target", () => {
    // 2026-06-14 是周日(0)；weekday=3(周三) → 首次 2026-06-17 15:00
    const ev = buildWeeklyEvent({
      title: "项目周会", weekday: 3, time: "15:00", durationMin: 60,
      startDate: "2026-06-14", targetDate: "2026-08-01",
      timeZone: "Asia/Shanghai", attendees: ["u-1", "u-2"],
    });
    expect(ev.summary).toBe("项目周会");
    expect(ev.start.dateTime.startsWith("2026-06-17T15:00")).toBe(true);
    expect(ev.end.dateTime.startsWith("2026-06-17T16:00")).toBe(true);
    expect(ev.recurrence.pattern.type).toBe("weekly");
    expect(ev.recurrence.pattern.interval).toBe(1);
    expect(ev.recurrence.range.type).toBe("endDate");
    expect(ev.recurrence.range.endDate.startsWith("2026-08-01")).toBe(true);
    expect(ev.start.dateTime).toContain("+08:00");
    expect(ev.attendees.map((a) => a.id)).toEqual(["u-1", "u-2"]);
    expect(ev.onlineMeetingInfo.type).toBe("dingtalk");
  });

  it("defaults recurrence to 13 weeks when no targetDate", () => {
    const ev = buildWeeklyEvent({
      title: "周会", weekday: 1, time: "10:00", durationMin: 30,
      startDate: "2026-06-14", targetDate: null, timeZone: "Asia/Shanghai", attendees: [],
    });
    expect(ev.recurrence.range.endDate.startsWith("2026-09-14")).toBe(true); // 周一 06-15 + 13 周
  });
});

const sampleEvent = buildWeeklyEvent({
  title: "x", weekday: 3, time: "15:00", durationMin: 60,
  startDate: "2026-06-14", targetDate: "2026-08-01", timeZone: "Asia/Shanghai", attendees: [],
});

describe("upsertWeeklyMeeting", () => {
  it("returns null (degrade) when dingtalk not configured", async () => {
    __setDingtalkConfigForTest({ appKey: "", appSecret: "" });
    const res = await upsertWeeklyMeeting({ organizerUserId: "pm-1", existingEventId: null, event: sampleEvent });
    expect(res).toBeNull();
  });

  it("creates event and returns eventId", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ id: "evt-123" }), { status: 200 });
    });
    const res = await upsertWeeklyMeeting({ organizerUserId: "pm-1", existingEventId: null, event: sampleEvent });
    expect(res).toBe("evt-123");
  });

  it("returns null when follow-up GET cannot confirm the event", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      if (init?.method === "GET") return new Response("missing", { status: 404 });
      return new Response(JSON.stringify({ id: "evt-ghost" }), { status: 200 });
    });

    const res = await upsertWeeklyMeeting({ organizerUserId: "pm-1", existingEventId: null, event: sampleEvent });

    expect(res).toBeNull();
  });
});
