import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * Use this instead of `new Date().toISOString().slice(0, 10)` whenever the
 * value is compared against, or stored as, a calendar date (dueDate, 今天).
 * `toISOString()` is UTC, so after 16:00 in China (UTC+8) it rolls to the next
 * day — making tasks due today look overdue and stamping the wrong date.
 */
export function toLocalISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local calendar date N days from now (or from `from`), as YYYY-MM-DD. */
export function localISODatePlus(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}
