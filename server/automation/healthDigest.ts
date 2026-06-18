import { type RagLevel } from "../../shared/health";
import { ENV } from "../_core/env";
import { pushWebhook as defaultPushWebhook } from "../_core/notify";
import { notifyUsersViaDingtalk as defaultNotifyDingtalk } from "../_core/dingtalkMessage";
import {
  createNotification as defaultCreateNotification,
  createAutomationRun,
  hasAutomationRunForEntity,
  listAutomationRuleRows,
  getPortfolioHealthForDigest as defaultGetHealth,
  type PortfolioHealthRow,
} from "../db";
import { parseDigestRuleConfig, type HealthDigestConfig } from "./digestRules";

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

/** 算每项目 RAG，过滤出黄/红（红在前），并返回绿色计数。 */
export function scorePortfolio(rows: PortfolioHealthRow[]): { abnormal: ScoredProject[]; greenCount: number } {
  const abnormal: ScoredProject[] = [];
  let greenCount = 0;
  for (const row of rows) {
    const level = row.ragLevel;
    if (level === "green") { greenCount += 1; continue; }
    abnormal.push({ row, level, reasons: row.ragReasons });
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

// ── 编排 ─────────────────────────────────────────────────────────────────
export type HealthDigestDeps = {
  getConfigRow?: () => Promise<{ enabled: boolean; config: HealthDigestConfig } | null>;
  getHealth?: (todayISO: string) => Promise<PortfolioHealthRow[]>;
  hasRun?: (periodKey: string) => Promise<boolean>;
  writeRun?: (status: "fired" | "skipped", periodKey: string, detail: string) => Promise<void>;
  createNotification?: typeof defaultCreateNotification;
  notifyDingtalk?: (userIds: number[], title: string, markdown: string) => Promise<void>;
  pushWebhook?: typeof defaultPushWebhook;
};

async function defaultGetConfigRow(): Promise<{ enabled: boolean; config: HealthDigestConfig } | null> {
  const rows = await listAutomationRuleRows();
  const row = rows.find((r) => r.ruleKey === "health_digest");
  if (!row) return null;
  return { enabled: row.enabled, config: parseDigestRuleConfig("health_digest", row.config) };
}

/**
 * 健康摘要扫描：被 scheduler 每个 interval 调一次。
 * 到点 + 当期无 run 才处理；异常为空写 skipped 不发；否则 PM 个人 + 管理群分发后写 fired。
 */
export async function runHealthDigestScan(now: Date, deps: HealthDigestDeps = {}): Promise<void> {
  const getConfigRow = deps.getConfigRow ?? defaultGetConfigRow;
  const cfgRow = await getConfigRow();
  if (!cfgRow || !cfgRow.enabled) return;
  const config = cfgRow.config;

  const { periodKey, reached } = computeDigestTiming(now, config);
  if (!reached) return;

  const hasRun = deps.hasRun ?? ((pk: string) => hasAutomationRunForEntity({ ruleKey: "health_digest", entityId: pk }));
  if (await hasRun(periodKey)) return;

  const writeRun = deps.writeRun ?? ((status: "fired" | "skipped", pk: string, detail: string) =>
    createAutomationRun({
      ruleKey: "health_digest", projectId: null, eventType: "scheduled", entityType: "portfolio",
      entityId: pk, status, recipients: [], detail: detail.slice(0, 1000),
    }));

  const { todayISO } = shanghaiParts(now);
  const getHealth = deps.getHealth ?? defaultGetHealth;
  const rows = await getHealth(todayISO);
  const { abnormal, greenCount } = scorePortfolio(rows);

  if (abnormal.length === 0) {
    await writeRun("skipped", periodKey, `no abnormal (green ${greenCount})`);
    return;
  }

  const createNotification = deps.createNotification ?? defaultCreateNotification;
  const notifyDingtalk = deps.notifyDingtalk ?? defaultNotifyDingtalk;
  const pushWebhook = deps.pushWebhook ?? defaultPushWebhook;

  if (config.pushPmPersonal) {
    for (const [pmUserId, scored] of Array.from(groupByPm(abnormal).entries())) {
      const { title, markdown } = buildPmMarkdown(scored, config.cadence);
      await createNotification({
        userId: pmUserId, type: "automation", title,
        body: `${scored.length} 个项目需关注`, entityType: "portfolio", entityId: periodKey,
      });
      await notifyDingtalk([pmUserId], title, markdown);
    }
  }

  if (config.pushManagerGroup) {
    const { title, markdown, text } = buildGroupMarkdown(abnormal, greenCount, config.cadence);
    await pushWebhook(text, { title, markdown });
  }

  const red = abnormal.filter((s) => s.level === "red").length;
  await writeRun("fired", periodKey, `red ${red} amber ${abnormal.length - red} green ${greenCount}`);
}
