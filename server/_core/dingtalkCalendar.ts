import { fetchDingtalkApi, isDingtalkConfigured } from "./dingtalk";

export type WeeklyEventInput = {
  title: string; weekday: number; time: string; durationMin: number;
  startDate: string; targetDate: string | null; timeZone: string; attendees: string[];
};

export type DingtalkEvent = {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  // 经真机核定：pattern.type:"weekly"（非 repeatType）+ interval；range.type:"endDate" + ISO8601 时间戳
  recurrence: { pattern: { type: "weekly"; interval: number }; range: { type: "endDate"; endDate: string } };
  attendees: { id: string }[];
  onlineMeetingInfo: { type: "dingtalk" };
};

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}
function addMinutes(time: string, mins: number): string {
  const [h, mi] = time.split(":").map(Number);
  const total = h * 60 + mi + mins;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 首次会议日 = start 当天或之后、第一个匹配 weekday 的日期 */
export function firstOccurrence(startDate: string, weekday: number): string {
  let d = startDate;
  for (let i = 0; i < 7; i++) { if (weekdayOf(d) === weekday) return d; d = addDaysISO(d, 1); }
  return startDate;
}

export function buildWeeklyEvent(input: WeeklyEventInput): DingtalkEvent {
  const first = firstOccurrence(input.startDate, input.weekday);
  const endTime = addMinutes(input.time, input.durationMin);
  const endDate = input.targetDate ?? addDaysISO(first, 13 * 7);
  // 钉钉要求 dateTime 带时区偏移；国内固定 +08:00（与 Asia/Shanghai 一致）
  return {
    summary: input.title,
    start: { dateTime: `${first}T${input.time}:00+08:00`, timeZone: input.timeZone },
    end: { dateTime: `${first}T${endTime}:00+08:00`, timeZone: input.timeZone },
    recurrence: { pattern: { type: "weekly", interval: 1 }, range: { type: "endDate", endDate: `${endDate}T23:59:59+08:00` } },
    attendees: input.attendees.map((id) => ({ id })),
    onlineMeetingInfo: { type: "dingtalk" },
  };
}

const CAL_BASE = "https://api.dingtalk.com/v1.0/calendar/users";

async function confirmEventExists(organizerUserId: string, eventId: string): Promise<boolean> {
  const resp = await fetchDingtalkApi((token) => ({
    url: `${CAL_BASE}/${encodeURIComponent(organizerUserId)}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    init: {
      method: "GET",
      headers: { "x-acs-dingtalk-access-token": token },
    },
  }));
  return !!resp?.ok;
}

/** 建或更新组织者日历上的循环日程；返回 eventId；未配置/失败返回 null（上层降级） */
export async function upsertWeeklyMeeting(params: {
  organizerUserId: string;
  existingEventId: string | null;
  event: DingtalkEvent;
}): Promise<string | null> {
  if (!isDingtalkConfigured()) return null;
  try {
    const base = `${CAL_BASE}/${encodeURIComponent(params.organizerUserId)}/calendars/primary/events`;
    const url = params.existingEventId ? `${base}/${encodeURIComponent(params.existingEventId)}` : base;
    const resp = await fetchDingtalkApi((token) => ({
      url,
      init: {
        method: params.existingEventId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": token },
        body: JSON.stringify(params.event),
      },
    }));
    if (!resp) return null;
    if (!resp.ok) { console.warn("[dingtalk] upsert event http", resp.status); return null; }
    const j = (await resp.json().catch(() => ({}))) as { id?: string };
    const eventId = j.id ?? params.existingEventId ?? null;
    if (!eventId) return null;
    if (!(await confirmEventExists(params.organizerUserId, eventId))) {
      console.warn("[dingtalk] event upsert returned id but follow-up GET did not confirm", eventId);
      return null;
    }
    return eventId;
  } catch (e) {
    console.warn("[dingtalk] upsert event failed (degrade):", e);
    return null;
  }
}

export async function cancelMeeting(organizerUserId: string, eventId: string): Promise<void> {
  if (!isDingtalkConfigured()) return;
  try {
    await fetchDingtalkApi((token) => ({
      url: `${CAL_BASE}/${encodeURIComponent(organizerUserId)}/calendars/primary/events/${encodeURIComponent(eventId)}`,
      init: {
        method: "DELETE",
        headers: { "x-acs-dingtalk-access-token": token },
      },
    }));
  } catch (e) {
    console.warn("[dingtalk] cancel event failed (non-fatal):", e);
  }
}
