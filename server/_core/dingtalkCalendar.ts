import { getAccessToken, isDingtalkConfigured } from "./dingtalk";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { addDays } from "../../shared/shanghai-date";
import { isDingtalkDeliveryEnabled } from "./dingtalk-delivery-policy";
import { resolveDingtalkCleanupMode } from "./dingtalk-cleanup-policy";

export type WeeklyEventInput = {
  title: string; weekday: number; time: string; durationMin: number;
  startDate: string; targetDate: string | null; timeZone: string; attendees: string[];
};

export type DingtalkEvent = {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  // 经真机核定：pattern.type:"weekly"（非 repeatType）+ interval；range.type:"endDate" + ISO8601 时间戳
  recurrence?: { pattern: { type: "weekly"; interval: number }; range: { type: "endDate"; endDate: string } };
  attendees: { id: string }[];
  onlineMeetingInfo: { type: "dingtalk" };
};

// 0=Sun..6=Sat（JS getUTCDay 约定）。注意 shared/shanghai-date 的 isoWeekdayOf
// 是 1=Mon..7=Sun，两者不可互换；日期加减统一用 shared 的 addDays。
function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
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
  for (let i = 0; i < 7; i++) { if (weekdayOf(d) === weekday) return d; d = addDays(d, 1); }
  return startDate;
}

export function buildWeeklyEvent(input: WeeklyEventInput): DingtalkEvent {
  const first = firstOccurrence(input.startDate, input.weekday);
  const endTime = addMinutes(input.time, input.durationMin);
  const endDate = input.targetDate ?? addDays(first, 13 * 7);
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

export function buildSingleEvent(input: {
  title: string;
  date: string;
  time: string;
  durationMin: number;
  timeZone: string;
  attendees: string[];
}): DingtalkEvent {
  const endTime = addMinutes(input.time, input.durationMin);
  return {
    summary: input.title,
    start: { dateTime: `${input.date}T${input.time}:00+08:00`, timeZone: input.timeZone },
    end: { dateTime: `${input.date}T${endTime}:00+08:00`, timeZone: input.timeZone },
    attendees: input.attendees.map((id) => ({ id })),
    onlineMeetingInfo: { type: "dingtalk" },
  };
}

const CAL_BASE = "https://api.dingtalk.com/v1.0/calendar/users";

export class DingtalkCalendarCreationUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DingtalkCalendarCreationUncertainError";
  }
}

function isAmbiguousCreateHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function hasCalendarApiError(body: Record<string, unknown>): boolean {
  const errcode = body.errcode;
  const code = body.code;
  return body.success === false
    || (errcode !== undefined && errcode !== 0 && errcode !== "0")
    || (code !== undefined && code !== 0 && code !== "0" && code !== "OK");
}

async function upsertCalendarEvent(params: {
  organizerUserId: string;
  existingEventId: string | null;
  event: DingtalkEvent;
}): Promise<string | null> {
  if (!isDingtalkDeliveryEnabled()) return params.existingEventId;
  if (!isDingtalkConfigured()) return null;
  const isCreate = !params.existingEventId;
  let requestStarted = false;
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const base = `${CAL_BASE}/${encodeURIComponent(params.organizerUserId)}/calendars/primary/events`;
    const url = params.existingEventId ? `${base}/${encodeURIComponent(params.existingEventId)}` : base;
    requestStarted = true;
    const resp = await fetchWithTimeout(url, {
      method: params.existingEventId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": token },
      body: JSON.stringify(params.event),
    });
    const body = (await resp.json()) as Record<string, unknown>;
    if (!resp.ok) {
      if (isCreate && isAmbiguousCreateHttpStatus(resp.status)) {
        throw new DingtalkCalendarCreationUncertainError(
          `钉钉日程创建返回 HTTP ${resp.status}，远端结果未知`
        );
      }
      console.warn("[dingtalk] upsert event http", resp.status);
      return null;
    }
    if (hasCalendarApiError(body)) return null;
    const eventId = typeof body.id === "string" && body.id ? body.id : null;
    if (eventId) return eventId;
    if (params.existingEventId) return params.existingEventId;
    throw new DingtalkCalendarCreationUncertainError(
      "钉钉日程创建响应未返回日程 ID，远端结果未知"
    );
  } catch (e) {
    if (e instanceof DingtalkCalendarCreationUncertainError) throw e;
    if (isCreate && requestStarted) {
      throw new DingtalkCalendarCreationUncertainError(
        `钉钉日程创建响应丢失，远端结果未知：${e instanceof Error ? e.message : String(e)}`
      );
    }
    console.warn("[dingtalk] upsert event failed (degrade):", e);
    return null;
  }
}

/** 建或更新组织者日历上的循环日程；返回 eventId；未配置/失败返回 null（上层降级） */
export async function upsertWeeklyMeeting(params: {
  organizerUserId: string;
  existingEventId: string | null;
  event: DingtalkEvent;
}): Promise<string | null> {
  return upsertCalendarEvent(params);
}

/** 建或更新组织者日历上的单次日程；返回 eventId；未配置/失败返回 null。 */
export async function upsertSingleMeeting(params: {
  organizerUserId: string;
  existingEventId: string | null;
  event: DingtalkEvent;
}): Promise<string | null> {
  return upsertCalendarEvent(params);
}

export async function cancelMeeting(organizerUserId: string, eventId: string): Promise<boolean> {
  const cleanupMode = resolveDingtalkCleanupMode();
  if (cleanupMode === "local_only") return true;
  if (cleanupMode === "deferred") return false;
  if (!isDingtalkConfigured()) return false;
  try {
    const token = await getAccessToken();
    if (!token) return false;
    const resp = await fetchWithTimeout(`${CAL_BASE}/${encodeURIComponent(organizerUserId)}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { "x-acs-dingtalk-access-token": token },
    });
    // Deletion is idempotent: a prior attempt may have succeeded remotely but
    // failed before its local checkpoint was committed.
    if (resp.status === 404 || resp.status === 410) return true;
    if (!resp.ok) return false;
    const text = await resp.text().catch(() => "");
    if (!text) return true;
    try {
      const data = JSON.parse(text) as { errcode?: number; code?: string | number };
      if (data.errcode && data.errcode !== 0) return false;
      if (data.code && String(data.code) !== "0") return false;
    } catch {
      // Some successful DingTalk delete responses are empty/plain text.
    }
    return true;
  } catch (e) {
    console.warn("[dingtalk] cancel event failed (non-fatal):", e);
    return false;
  }
}
