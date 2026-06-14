import { getAccessToken, isDingtalkConfigured } from "./dingtalk";

export type WeeklyEventInput = {
  title: string; weekday: number; time: string; durationMin: number;
  startDate: string; targetDate: string | null; timeZone: string; attendees: string[];
};

export type DingtalkEvent = {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  recurrence: { pattern: { repeatType: "WEEKLY" }; range: { endDate: string } };
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
  return {
    summary: input.title,
    start: { dateTime: `${first}T${input.time}:00`, timeZone: input.timeZone },
    end: { dateTime: `${first}T${endTime}:00`, timeZone: input.timeZone },
    recurrence: { pattern: { repeatType: "WEEKLY" }, range: { endDate } },
    attendees: input.attendees.map((id) => ({ id })),
    onlineMeetingInfo: { type: "dingtalk" },
  };
}

const CAL_BASE = "https://api.dingtalk.com/v1.0/calendar/users";

/** 建或更新组织者日历上的循环日程；返回 eventId；未配置/失败返回 null（上层降级） */
export async function upsertWeeklyMeeting(params: {
  organizerUserId: string;
  existingEventId: string | null;
  event: DingtalkEvent;
}): Promise<string | null> {
  if (!isDingtalkConfigured()) return null;
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const base = `${CAL_BASE}/${encodeURIComponent(params.organizerUserId)}/calendars/primary/events`;
    const url = params.existingEventId ? `${base}/${encodeURIComponent(params.existingEventId)}` : base;
    const resp = await fetch(url, {
      method: params.existingEventId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": token },
      body: JSON.stringify(params.event),
    });
    if (!resp.ok) { console.warn("[dingtalk] upsert event http", resp.status); return null; }
    const j = (await resp.json()) as { id?: string };
    return j.id ?? params.existingEventId ?? null;
  } catch (e) {
    console.warn("[dingtalk] upsert event failed (degrade):", e);
    return null;
  }
}

export async function cancelMeeting(organizerUserId: string, eventId: string): Promise<void> {
  if (!isDingtalkConfigured()) return;
  try {
    const token = await getAccessToken();
    if (!token) return;
    await fetch(`${CAL_BASE}/${encodeURIComponent(organizerUserId)}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { "x-acs-dingtalk-access-token": token },
    });
  } catch (e) {
    console.warn("[dingtalk] cancel event failed (non-fatal):", e);
  }
}
