import {
  createAutomationRun,
  getPersonalDailyDigestItems as defaultGetItems,
  hasAutomationRunForEntity,
  listAutomationRuleRows,
  type PersonalDailyDigestItem,
} from "../db";
import {
  buildDeliverableReviewActionPath,
  buildIssueValidationActionPath,
  buildProjectActionPath,
  buildTaskCompletionActionPath,
} from "../../shared/action-links";
import { notifyPersonal, type NotifyPersonalDeps } from "../notification-gateway";
import { taskDisplayTitle } from "../task-title";
import {
  parseDigestRuleConfig,
  type PersonalDailyDigestConfig,
} from "./digestRules";
import { shanghaiParts } from "./healthDigest";

export type PersonalDailyDigestDeps = {
  getConfigRow?: () => Promise<{ enabled: boolean; config: PersonalDailyDigestConfig } | null>;
  getItems?: (input: {
    todayISO: string;
    dueSoonDays: number;
    includePendingReviews: boolean;
    includeProjectExceptions: boolean;
  }) => Promise<PersonalDailyDigestItem[]>;
  hasRun?: (entityId: string) => Promise<boolean>;
  writeRun?: (status: "fired" | "skipped", entityId: string, detail: string, recipients?: unknown) => Promise<void>;
} & NotifyPersonalDeps;

async function defaultGetConfigRow(): Promise<{ enabled: boolean; config: PersonalDailyDigestConfig } | null> {
  const rows = await listAutomationRuleRows();
  const row = rows.find((r) => r.ruleKey === "personal_daily_digest");
  if (!row) return null;
  return {
    enabled: row.enabled,
    config: parseDigestRuleConfig("personal_daily_digest", row.config),
  };
}

export function computePersonalDailyDigestTiming(now: Date, config: PersonalDailyDigestConfig): {
  todayISO: string;
  periodKey: string;
  reached: boolean;
} {
  const { todayISO, hour } = shanghaiParts(now);
  return { todayISO, periodKey: `d:${todayISO}`, reached: hour >= config.sendHour };
}

export function groupPersonalDigestItems(items: PersonalDailyDigestItem[]): Map<number, PersonalDailyDigestItem[]> {
  const grouped = new Map<number, PersonalDailyDigestItem[]>();
  for (const item of items) {
    const list = grouped.get(item.recipientUserId) ?? [];
    list.push(item);
    grouped.set(item.recipientUserId, list);
  }
  return grouped;
}

export function buildPersonalDailyDigestMarkdown(
  items: PersonalDailyDigestItem[],
  todayISO: string,
): { title: string; body: string; markdown: string } {
  const counts = {
    critical: items.filter((item) => item.kind === "issue_critical").length,
    blocked: items.filter((item) => item.kind === "task_blocked").length,
    overdue: items.filter((item) => item.kind === "task_overdue" || item.kind === "issue_overdue").length,
    reviews: items.filter((item) => item.kind === "deliverable_review").length,
    dueSoon: items.filter((item) => item.kind === "task_due_soon" || item.kind === "issue_due_soon").length,
  };
  const title = "我的每日摘要";
  const body = [
    counts.critical ? `P0/P1 ${counts.critical}` : null,
    counts.blocked ? `阻塞 ${counts.blocked}` : null,
    counts.overdue ? `逾期 ${counts.overdue}` : null,
    counts.reviews ? `待审核 ${counts.reviews}` : null,
    counts.dueSoon ? `临期 ${counts.dueSoon}` : null,
  ].filter(Boolean).join(" · ") || "暂无异常";
  const visible = items.slice(0, 10);
  const lines = visible.map((item) => `- ${itemKindLabel(item)} ${item.projectName}：${itemTitle(item)}${dateSuffix(item)}`);
  if (items.length > visible.length) {
    lines.push(`- 还有 ${items.length - visible.length} 项，请到我的工作台查看`);
  }
  return {
    title,
    body,
    markdown: `#### ${title}（${todayISO}）\n${body}\n${lines.join("\n")}`,
  };
}

export async function runPersonalDailyDigestScan(now: Date, deps: PersonalDailyDigestDeps = {}): Promise<void> {
  const getConfigRow = deps.getConfigRow ?? defaultGetConfigRow;
  const cfgRow = await getConfigRow();
  if (!cfgRow || !cfgRow.enabled) return;
  const config = cfgRow.config;
  const { todayISO, periodKey, reached } = computePersonalDailyDigestTiming(now, config);
  if (!reached) return;

  const getItems = deps.getItems ?? defaultGetItems;
  const items = await getItems({
    todayISO,
    dueSoonDays: config.dueSoonDays,
    includePendingReviews: config.includePendingReviews,
    includeProjectExceptions: config.includeProjectExceptions,
  });
  const hasRun = deps.hasRun ?? ((entityId: string) => hasAutomationRunForEntity({ ruleKey: "personal_daily_digest", entityId }));
  const writeRun = deps.writeRun ?? ((status: "fired" | "skipped", entityId: string, detail: string, recipients: unknown = []) =>
    createAutomationRun({
      ruleKey: "personal_daily_digest",
      projectId: null,
      eventType: "scheduled",
      entityType: "portfolio",
      entityId,
      status,
      recipients,
      detail: detail.slice(0, 1000),
    }));

  const grouped = groupPersonalDigestItems(items);
  if (grouped.size === 0) {
    const emptyEntityId = `${periodKey}:empty`;
    if (!(await hasRun(emptyEntityId))) {
      await writeRun("skipped", emptyEntityId, "no personal digest items");
    }
    return;
  }

  for (const [userId, userItems] of Array.from(grouped.entries())) {
    const entityId = `${periodKey}:${userId}`;
    if (await hasRun(entityId)) continue;
    const { title, body, markdown } = buildPersonalDailyDigestMarkdown(userItems, todayISO);
    await notifyPersonal({
      eventKey: "personal_daily_digest",
      userIds: [userId],
      title,
      body,
      markdown,
      entityType: "portfolio",
      entityId,
      actionPath: "/?view=overview",
      bestEffortDingtalk: !config.pushDingtalk,
    }, {
      ...deps,
      notifyDingtalk: config.pushDingtalk ? deps.notifyDingtalk : async () => {},
    });
    await writeRun("fired", entityId, `items ${userItems.length}`, [{ userId, channel: "digest" }]);
  }
}

function itemKindLabel(item: PersonalDailyDigestItem): string {
  if (item.kind === "issue_critical") return "P0/P1";
  if (item.kind === "task_blocked") return "阻塞";
  if (item.kind === "task_overdue" || item.kind === "issue_overdue") return "逾期";
  if (item.kind === "deliverable_review") return "待审核";
  return "临期";
}

function itemTitle(item: PersonalDailyDigestItem): string {
  if (item.entityType === "task") {
    return taskDisplayTitle({
      taskId: item.title,
      phaseId: item.phaseId,
      projectCategory: item.projectCategory,
    });
  }
  return item.title;
}

function dateSuffix(item: PersonalDailyDigestItem): string {
  if (item.kind === "deliverable_review" || !item.dueDate) return "";
  return `（${item.dueDate}）`;
}

export function actionPathForDigestItem(item: PersonalDailyDigestItem): string {
  if (item.entityType === "task") {
    const parts = item.entityId.split(":");
    const phaseId = item.phaseId ?? parts[1];
    const taskId = parts[2];
    if (phaseId && taskId) {
      return buildTaskCompletionActionPath({
        projectId: item.projectId,
        phaseId,
        taskId,
      });
    }
    return buildProjectActionPath({
      projectId: item.projectId,
      tab: "tasks",
      phaseId,
      taskId,
    });
  }
  if (item.entityType === "deliverable_review") {
    if (item.phaseId && item.title) {
      return buildDeliverableReviewActionPath({
        projectId: item.projectId,
        phaseId: item.phaseId,
        deliverableName: item.title,
      });
    }
    return buildProjectActionPath({ projectId: item.projectId, tab: "reviews", phaseId: item.phaseId ?? undefined });
  }
  if (item.entityType === "issue" && item.phaseId && item.status === "resolved") {
    return buildIssueValidationActionPath({
      projectId: item.projectId,
      phaseId: item.phaseId,
      issueId: item.entityId,
    });
  }
  return buildProjectActionPath({ projectId: item.projectId, tab: "issues", phaseId: item.phaseId ?? undefined });
}
