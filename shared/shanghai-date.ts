export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ShanghaiParts = {
  todayISO: string;
  hour: number;
  isoWeekday: number;
};

/** ISO 日期加指定日历日；运算固定在 UTC 午夜，避免宿主机时区干扰。 */
export function addDays(iso: string, days: number): string {
  const timestamp = Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS;
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** 两个 ISO 日期相差的日历日数（to - from）。 */
export function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  return Math.floor((to - from) / DAY_MS);
}

/** 将日期、时间戳或 ISO 日期转为上海时区的 YYYY-MM-DD 日期键。 */
export function shanghaiDateKey(value: unknown): string | null {
  if (typeof value === "string" && ISO_DATE_RE.test(value)) return value;
  const date = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  if (!date || Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/** 当前时刻对应的上海日期。传入 now 便于任务与测试共用同一时钟。 */
export function todayShanghai(now = new Date()): string {
  const dateKey = shanghaiDateKey(now);
  if (!dateKey) throw new RangeError("Invalid date");
  return dateKey;
}

export function isoWeekdayOf(iso: string): number {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function shanghaiParts(now: Date): ShanghaiParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const todayISO = `${map.year}-${map.month}-${map.day}`;
  const hour = Number(map.hour) % 24; // en-CA 在午夜可能返回 "24"
  return { todayISO, hour, isoWeekday: isoWeekdayOf(todayISO) };
}

/** 上海日期键对应的连续日序号，供自动化规则比较日期窗口。 */
export function shanghaiDayNumber(value: unknown): number | null {
  const dateKey = shanghaiDateKey(value);
  if (!dateKey) return null;
  const timestamp = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : Math.floor(timestamp / DAY_MS);
}

/** 当前上海时间未到 08:00 则返回今天 08:00，否则返回次日 08:00。 */
export function nextShanghaiMorning(now = new Date()): Date {
  const { todayISO, hour } = shanghaiParts(now);
  const targetISO = hour < 8 ? todayISO : addDays(todayISO, 1);
  // 上海固定为 UTC+8，因此当地 08:00 对应 UTC 00:00。
  return new Date(`${targetISO}T00:00:00.000Z`);
}

/** 从当前上海日历日起算 N 天后的 08:00；不受服务器所在时区或其 DST 影响。 */
export function shanghaiMorningAfterCalendarDays(now: Date, days: number): Date {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  const targetISO = addDays(todayShanghai(now), days);
  // 上海当前及未来规则固定为 UTC+8，因此当地 08:00 对应 UTC 00:00。
  return new Date(`${targetISO}T00:00:00.000Z`);
}
