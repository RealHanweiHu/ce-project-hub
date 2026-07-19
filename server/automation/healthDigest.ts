import { type RagLevel } from "../../shared/health";
import { ENV } from "../_core/env";
import { pushWebhook as defaultPushWebhook } from "../_core/notify";
import {
  createAutomationRun,
  getAutomationActiveProjects,
  hasAutomationRunForEntity,
  listAutomationRuleRows,
  getPortfolioHealthForDigest as defaultGetHealth,
  type PortfolioHealthRow,
} from "../db";
import { parseDigestRuleConfig, type HealthDigestConfig } from "./digestRules";
import { isAutomationSuppressedProject } from "./project-filter";
import {
  notifyPersonal,
  type NotifyPersonalDeps,
} from "../notification-gateway";
import {
  addDays as addDaysISO,
  isoWeekdayOf,
  shanghaiParts,
} from "../../shared/shanghai-date";
import {
  ProjectExternalOperationBlockedError,
  withProjectExternalOperation,
} from "../project-external-operation";
import { isDingtalkDeliveryEnabled as defaultIsDingtalkDeliveryEnabled } from "../_core/dingtalk-delivery-policy";

export { addDaysISO, isoWeekdayOf, shanghaiParts };

// ── 日期/时区（统一 Asia/Shanghai）─────────────────────────────────────────
/** 本期标识 + 是否已到计划发送时点（支持服务晚启动补发：过点且本期无 run 即发）。 */
export function computeDigestTiming(
  now: Date,
  config: HealthDigestConfig
): { periodKey: string; reached: boolean } {
  const { todayISO, hour, isoWeekday } = shanghaiParts(now);
  if (config.cadence === "weekly") {
    const sendDayISO = addDaysISO(todayISO, config.weekday - isoWeekday);
    const reached =
      todayISO > sendDayISO ||
      (todayISO === sendDayISO && hour >= config.sendHour);
    return { periodKey: `w:${sendDayISO}`, reached };
  }
  return { periodKey: `d:${todayISO}`, reached: hour >= config.sendHour };
}

// ── 评分 / 分组 ───────────────────────────────────────────────────────────
export type ScoredProject = {
  row: PortfolioHealthRow;
  level: RagLevel;
  reasons: string[];
};

/** 算每项目 RAG，过滤出黄/红（红在前），并返回绿色计数。 */
export function scorePortfolio(rows: PortfolioHealthRow[]): {
  abnormal: ScoredProject[];
  greenCount: number;
} {
  const abnormal: ScoredProject[] = [];
  let greenCount = 0;
  for (const row of rows) {
    const level = row.ragLevel;
    if (level === "green") {
      greenCount += 1;
      continue;
    }
    abnormal.push({ row, level, reasons: row.ragReasons });
  }
  abnormal.sort(
    (a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1)
  );
  return { abnormal, greenCount };
}

export function groupByPm(
  abnormal: ScoredProject[]
): Map<number, ScoredProject[]> {
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

export function buildPmMarkdown(
  scored: ScoredProject[],
  cadence: "daily" | "weekly"
): { title: string; markdown: string } {
  const title = cadence === "weekly" ? "项目健康周报" : "项目健康日报";
  const body = scored.map(projectLine).join("\n");
  return {
    title,
    markdown: `#### ${title}\n你负责的 ${scored.length} 个项目需关注：\n${body}${appLink()}`,
  };
}

export function buildGroupMarkdown(
  abnormal: ScoredProject[],
  greenCount: number,
  cadence: "daily" | "weekly"
): { title: string; markdown: string; text: string } {
  const title =
    cadence === "weekly" ? "项目健康周报（全部）" : "项目健康日报（全部）";
  const red = abnormal.filter(s => s.level === "red").length;
  const amber = abnormal.length - red;
  const body = abnormal.map(projectLine).join("\n");
  const text = `健康摘要：红 ${red} / 黄 ${amber} / 绿 ${greenCount}`;
  return {
    title,
    text,
    markdown: `#### ${title}\n🔴 ${red} · 🟡 ${amber} · 🟢 ${greenCount}\n${body}${appLink()}`,
  };
}

// ── 编排 ─────────────────────────────────────────────────────────────────
export type HealthDigestDeps = {
  getConfigRow?: () => Promise<{
    enabled: boolean;
    config: HealthDigestConfig;
  } | null>;
  getHealth?: (todayISO: string) => Promise<PortfolioHealthRow[]>;
  getActiveProjectIds?: (projectIds: string[]) => Promise<Set<string>>;
  hasRun?: (periodKey: string) => Promise<boolean>;
  writeRun?: (
    status: "fired" | "partial" | "skipped",
    periodKey: string,
    detail: string
  ) => Promise<void>;
  pushWebhook?: (
    text: string,
    opts?: { title?: string; markdown?: string }
  ) => Promise<boolean | void>;
  runProjectOperation?: typeof withProjectExternalOperation;
} & NotifyPersonalDeps;

async function defaultGetConfigRow(): Promise<{
  enabled: boolean;
  config: HealthDigestConfig;
} | null> {
  const rows = await listAutomationRuleRows();
  const row = rows.find(r => r.ruleKey === "health_digest");
  if (!row) return null;
  return {
    enabled: row.enabled,
    config: parseDigestRuleConfig("health_digest", row.config),
  };
}

/**
 * 健康摘要扫描：被 scheduler 每个 interval 调一次。
 * 到点 + 当期无 run 才处理；异常为空写 skipped 不发；否则 PM 个人 + 管理群分发后写 fired。
 */
export async function runHealthDigestScan(
  now: Date,
  deps: HealthDigestDeps = {}
): Promise<void> {
  const isDingtalkDeliveryEnabled =
    deps.isDingtalkDeliveryEnabled ??
    (deps.pushWebhook
      ? () => true
      : defaultIsDingtalkDeliveryEnabled);
  const getConfigRow = deps.getConfigRow ?? defaultGetConfigRow;
  const cfgRow = await getConfigRow();
  if (!cfgRow || !cfgRow.enabled) return;
  const config = cfgRow.config;

  const { periodKey, reached } = computeDigestTiming(now, config);
  if (!reached) return;

  const hasRun =
    deps.hasRun ??
    ((pk: string) =>
      hasAutomationRunForEntity({ ruleKey: "health_digest", entityId: pk }));
  if (await hasRun(periodKey)) return;

  const writeRun =
    deps.writeRun ??
    ((status: "fired" | "partial" | "skipped", pk: string, detail: string) =>
      createAutomationRun({
        ruleKey: "health_digest",
        projectId: null,
        eventType: "scheduled",
        entityType: "portfolio",
        entityId: pk,
        status,
        recipients: [],
        detail: detail.slice(0, 1000),
      }));

  const { todayISO } = shanghaiParts(now);
  const getHealth = deps.getHealth ?? defaultGetHealth;
  const getActiveProjectIds =
    deps.getActiveProjectIds ??
    (async (projectIds: string[]) => {
      const wanted = new Set(projectIds);
      return new Set(
        (await getAutomationActiveProjects())
          .filter(project => wanted.has(project.id))
          .map(project => project.id)
      );
    });
  const loadedRows = (await getHealth(todayISO)).filter(
    row => !isAutomationSuppressedProject(row)
  );
  const activeProjectIds =
    loadedRows.length > 0
      ? await getActiveProjectIds(loadedRows.map(row => row.id))
      : new Set<string>();
  const rows = loadedRows.filter(row => activeProjectIds.has(row.id));
  const { abnormal, greenCount } = scorePortfolio(rows);

  if (abnormal.length === 0) {
    await writeRun("skipped", periodKey, `no abnormal (green ${greenCount})`);
    return;
  }

  const pushWebhook = deps.pushWebhook ?? defaultPushWebhook;
  const runProjectOperation =
    deps.runProjectOperation ??
    (deps.pushWebhook
      ? async <T>(
          _projectIds: readonly string[],
          _kind: string,
          operation: () => Promise<T>
        ) => operation()
      : withProjectExternalOperation);
  let delivered = 0;
  const deliveryErrors: string[] = [];

  if (config.pushPmPersonal) {
    for (const [pmUserId, loadedScored] of Array.from(
      groupByPm(abnormal).entries()
    )) {
      const currentActiveIds = await getActiveProjectIds(
        loadedScored.map(item => item.row.id)
      );
      const scored = loadedScored.filter(item =>
        currentActiveIds.has(item.row.id)
      );
      if (scored.length === 0) continue;
      const { title, markdown } = buildPmMarkdown(scored, config.cadence);
      const result = await notifyPersonal(
        {
          eventKey: "health_digest",
          projectIds: scored.map(item => item.row.id),
          userIds: [pmUserId],
          title,
          body: `${scored.length} 个项目需关注`,
          entityType: "portfolio",
          entityId: periodKey,
          markdown,
          actionPath: "/",
        },
        {
          ...deps,
          now: deps.now ?? now,
          isProjectActive:
            deps.isProjectActive ??
            (async (projectId: string) =>
              (await getActiveProjectIds([projectId])).has(projectId)),
        }
      );
      delivered += result.site + result.dingtalk;
      deliveryErrors.push(...result.errors);
    }
  }

  if (config.pushManagerGroup && isDingtalkDeliveryEnabled()) {
    const currentActiveIds = await getActiveProjectIds(rows.map(row => row.id));
    const currentPortfolio = scorePortfolio(
      rows.filter(row => currentActiveIds.has(row.id))
    );
    if (currentPortfolio.abnormal.length > 0) {
      const { title, markdown, text } = buildGroupMarkdown(
        currentPortfolio.abnormal,
        currentPortfolio.greenCount,
        config.cadence
      );
      try {
        await runProjectOperation(
          currentPortfolio.abnormal.map(item => item.row.id),
          "health_digest_group",
          async () => {
            const ids = currentPortfolio.abnormal.map(item => item.row.id);
            const stillActive = await getActiveProjectIds(ids);
            if (stillActive.size !== new Set(ids).size)
              throw new ProjectExternalOperationBlockedError();
            const result = await pushWebhook(text, { title, markdown });
            if (result === false)
              deliveryErrors.push("健康摘要群 webhook 发送失败或未配置");
            else delivered += 1;
          }
        );
      } catch (error) {
        if (!(error instanceof ProjectExternalOperationBlockedError))
          throw error;
      }
    }
  }

  if (delivered === 0 && deliveryErrors.length === 0) {
    await writeRun(
      "skipped",
      periodKey,
      "no abnormal project remained active before delivery"
    );
    return;
  }
  if (delivered === 0)
    throw new Error(deliveryErrors.join("；") || "健康摘要没有渠道实际送达");
  const red = abnormal.filter(s => s.level === "red").length;
  await writeRun(
    deliveryErrors.length > 0 ? "partial" : "fired",
    periodKey,
    `red ${red} amber ${abnormal.length - red} green ${greenCount}${deliveryErrors.length ? `; ${deliveryErrors.join("; ")}` : ""}`
  );
}
