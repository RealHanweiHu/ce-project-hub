import { computeRag, ragReasons, type RagInput, type RagLevel } from "../../shared/health";
import { ENV } from "../_core/env";
import type { PortfolioHealthRow } from "../db";
import type { HealthDigestConfig } from "./digestRules";

// ── 日期/时区（统一 Asia/Shanghai）─────────────────────────────────────────
export function isoWeekdayOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d; // ISO: 周一=1 .. 周日=7
}

export function addDaysISO(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function shanghaiParts(now: Date): { todayISO: string; hour: number; isoWeekday: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  });
  const m: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) m[p.type] = p.value;
  const todayISO = `${m.year}-${m.month}-${m.day}`;
  const hour = Number(m.hour) % 24; // en-CA 在午夜可能给 "24"
  return { todayISO, hour, isoWeekday: isoWeekdayOf(todayISO) };
}

/** 本期标识 + 是否已到计划发送时点（支持服务晚启动补发：过点且本期无 run 即发）。 */
export function computeDigestTiming(now: Date, config: HealthDigestConfig): { periodKey: string; reached: boolean } {
  const { todayISO, hour, isoWeekday } = shanghaiParts(now);
  if (config.cadence === "weekly") {
    const sendDayISO = addDaysISO(todayISO, config.weekday - isoWeekday);
    const reached = todayISO > sendDayISO || (todayISO === sendDayISO && hour >= config.sendHour);
    return { periodKey: `w:${sendDayISO}`, reached };
  }
  return { periodKey: `d:${todayISO}`, reached: hour >= config.sendHour };
}

// ── 评分 / 分组 ───────────────────────────────────────────────────────────
export type ScoredProject = { row: PortfolioHealthRow; level: RagLevel; reasons: string[] };

function progressBehind(row: PortfolioHealthRow): number | null {
  if (row.plannedItems <= 0) return null;
  return Math.max(0, ((row.dueItems - row.donePlannedItems) / row.plannedItems) * 100);
}

function rowToRagInput(row: PortfolioHealthRow): RagInput {
  return {
    risk: (["low", "medium", "high"].includes(row.risk) ? row.risk : "low") as RagInput["risk"],
    projectedEnd: row.plannedEnd,
    targetDate: row.targetDate,
    overdueTasks: row.overdueTasks,
    blockedTasks: row.blockedTasks,
    openIssues: row.openIssues,
    criticalIssues: row.criticalIssues,
    progressBehindPct: progressBehind(row),
    gateNotReady: row.gateNotReady,
  };
}

/** 算每项目 RAG，过滤出黄/红（红在前），并返回绿色计数。 */
export function scorePortfolio(rows: PortfolioHealthRow[]): { abnormal: ScoredProject[]; greenCount: number } {
  const abnormal: ScoredProject[] = [];
  let greenCount = 0;
  for (const row of rows) {
    const input = rowToRagInput(row);
    const level = computeRag(input);
    if (level === "green") { greenCount += 1; continue; }
    abnormal.push({ row, level, reasons: ragReasons(input) });
  }
  abnormal.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  return { abnormal, greenCount };
}

export function groupByPm(abnormal: ScoredProject[]): Map<number, ScoredProject[]> {
  const map = new Map<number, ScoredProject[]>();
  for (const s of abnormal) {
    if (s.row.pmUserId == null) continue;
    const arr = map.get(s.row.pmUserId) ?? [];
    arr.push(s);
    map.set(s.row.pmUserId, arr);
  }
  return map;
}

// ── 消息 ─────────────────────────────────────────────────────────────────
const EMOJI: Record<RagLevel, string> = { red: "🔴", amber: "🟡", green: "🟢" };

function projectLine(s: ScoredProject): string {
  return `- ${EMOJI[s.level]} **${s.row.name}**（${s.row.projectNumber}）：${s.reasons.join("、") || "需关注"}`;
}

function appLink(): string {
  return ENV.appBaseUrl ? `\n\n[打开 CE Project Hub](${ENV.appBaseUrl}/)` : "";
}

export function buildPmMarkdown(scored: ScoredProject[], cadence: "daily" | "weekly"): { title: string; markdown: string } {
  const title = cadence === "weekly" ? "项目健康周报" : "项目健康日报";
  const body = scored.map(projectLine).join("\n");
  return { title, markdown: `#### ${title}\n你负责的 ${scored.length} 个项目需关注：\n${body}${appLink()}` };
}

export function buildGroupMarkdown(
  abnormal: ScoredProject[], greenCount: number, cadence: "daily" | "weekly"
): { title: string; markdown: string; text: string } {
  const title = cadence === "weekly" ? "项目健康周报（全部）" : "项目健康日报（全部）";
  const red = abnormal.filter((s) => s.level === "red").length;
  const amber = abnormal.length - red;
  const body = abnormal.map(projectLine).join("\n");
  const text = `健康摘要：红 ${red} / 黄 ${amber} / 绿 ${greenCount}`;
  return { title, text, markdown: `#### ${title}\n🔴 ${red} · 🟡 ${amber} · 🟢 ${greenCount}\n${body}${appLink()}` };
}
