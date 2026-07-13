import { ENV } from "../_core/env";
import { sendToGroupChat } from "../_core/dingtalkGroup";
import {
  createAutomationRun,
  finishAutomationClaim,
  getGroupWeeklyDigestProjects as defaultGetProjects,
  listAutomationRuleRows,
  tryClaimAutomation,
  type GroupWeeklyDigestProject as DbGroupWeeklyDigestProject,
} from "../db";
import { addDays, shanghaiDateKey, shanghaiParts } from "../../shared/shanghai-date";
import {
  resolvePhaseName,
  resolveProjectPhase,
  resolveTaskName,
} from "../../shared/sop-template-resolution";
import {
  parseDigestRuleConfig,
  type GroupWeeklyDigestConfig,
} from "./digestRules";
import { isAutomationSuppressedProject } from "./project-filter";

export type GroupWeeklyDigestProject = DbGroupWeeklyDigestProject;

type ClaimFinish = {
  claimKey: string;
  token: string;
  status: "fired" | "skipped" | "error";
  error?: string | null;
};

export type GroupWeeklyDigestDeps = {
  getConfigRow?: () => Promise<{ enabled: boolean; config: GroupWeeklyDigestConfig } | null>;
  getProjects?: (input: { weekStartISO: string; todayISO: string }) => Promise<GroupWeeklyDigestProject[]>;
  claim?: (claimKey: string, projectId: string, entityId: string) => Promise<{ token: string } | null>;
  finishClaim?: (input: ClaimFinish) => Promise<void>;
  sendToGroup?: (chatId: string, title: string, markdown: string) => Promise<boolean>;
  writeRun?: (
    status: "fired" | "error",
    projectId: string,
    entityId: string,
    detail: string,
    recipients?: unknown,
  ) => Promise<void>;
};

async function defaultGetConfigRow(): Promise<{ enabled: boolean; config: GroupWeeklyDigestConfig } | null> {
  const rows = await listAutomationRuleRows();
  const row = rows.find((candidate) => candidate.ruleKey === "group_weekly_digest");
  if (!row) return null;
  return {
    enabled: row.enabled,
    config: parseDigestRuleConfig("group_weekly_digest", row.config),
  };
}

/** Strict configured-weekday timing; a Wednesday tick never backfills Monday. */
export function computeGroupWeeklyDigestTiming(
  now: Date,
  config: GroupWeeklyDigestConfig,
): { todayISO: string; weekStartISO: string; periodKey: string; reached: boolean } {
  const { todayISO, hour, isoWeekday } = shanghaiParts(now);
  const weekStartISO = addDays(todayISO, 1 - isoWeekday);
  return {
    todayISO,
    weekStartISO,
    periodKey: `w:${isoWeekKey(weekStartISO)}`,
    reached: isoWeekday === config.weekday && hour >= config.sendHour,
  };
}

export function buildGroupWeeklyDigestMarkdown(
  source: GroupWeeklyDigestProject,
  input: { todayISO: string; weekStartISO: string },
): { title: string; markdown: string; detail: string } {
  const { project, tasks } = source;
  const nextWeekStartISO = addDays(input.weekStartISO, 7);
  const nextWeekEndISO = addDays(input.weekStartISO, 13);
  const completed = tasks.filter((task) => {
    const completedISO = shanghaiDateKey(task.completedAt);
    return completedISO !== null && completedISO >= input.weekStartISO && completedISO <= input.todayISO;
  });
  const overdue = tasks.filter((task) =>
    !isClosedTaskStatus(task.status) && task.dueDate !== null && task.dueDate < input.todayISO
  );
  const nextWeek = tasks.filter((task) =>
    !isClosedTaskStatus(task.status) && task.dueDate !== null &&
    task.dueDate >= nextWeekStartISO && task.dueDate <= nextWeekEndISO
  );
  const phase = resolveProjectPhase(project, project.currentPhase);
  const gateTask = phase
    ? tasks.find((task) => task.phaseId === phase.id && task.taskId === phase.gateTaskId)
    : undefined;
  const gateLabel = phase?.gate
    ? `${phase.gate} · ${taskStatusLabel(gateTask?.status)}`
    : "未配置";
  const title = `${project.name} · 项目周摘要`;
  const lines = [
    `#### ${title}`,
    `当前阶段：${resolvePhaseName(project, project.currentPhase)} · Gate：${gateLabel}`,
    "",
    `- 本周完成 ${completed.length}`,
    `- 当前逾期 ${overdue.length}`,
    ...taskLines(overdue, project, "逾期"),
    `- 下周到期 ${nextWeek.length}`,
    ...taskLines(nextWeek, project, "到期"),
  ];
  if (ENV.appBaseUrl) lines.push("", `[打开 CE Project Hub](${ENV.appBaseUrl}/)`);
  return {
    title,
    markdown: lines.join("\n"),
    detail: `completed ${completed.length}; overdue ${overdue.length}; next_week ${nextWeek.length}; gate ${gateTask?.status ?? "missing"}`,
  };
}

/**
 * Send one weekly summary per active project group. The batch loader has a
 * fixed query budget, while the atomic claim closes cross-instance duplicates.
 */
export async function runGroupWeeklyDigestScan(
  now: Date,
  deps: GroupWeeklyDigestDeps = {},
): Promise<void> {
  const configRow = await (deps.getConfigRow ?? defaultGetConfigRow)();
  if (!configRow?.enabled) return;
  const timing = computeGroupWeeklyDigestTiming(now, configRow.config);
  if (!timing.reached) return;

  const getProjects = deps.getProjects ?? defaultGetProjects;
  const projects = (await getProjects({
    weekStartISO: timing.weekStartISO,
    todayISO: timing.todayISO,
  })).filter((source) => !isAutomationSuppressedProject(source.project));
  const claim = deps.claim ?? ((claimKey: string, projectId: string, entityId: string) =>
    tryClaimAutomation({ claimKey, ruleKey: "group_weekly_digest", projectId, entityId }));
  const finishClaim = deps.finishClaim ?? finishAutomationClaim;
  const sendToGroup = deps.sendToGroup ?? sendToGroupChat;
  const writeRun = deps.writeRun ?? defaultWriteRun;

  for (const source of projects) {
    const { project } = source;
    const chatId = project.dingtalkChatId?.trim();
    if (!chatId) continue;
    const entityId = `${timing.periodKey}:${project.id}`;
    const claimKey = `group_weekly_digest:${project.id}:${entityId}`;
    const acquired = await claim(claimKey, project.id, entityId);
    if (!acquired) continue;

    let message: ReturnType<typeof buildGroupWeeklyDigestMarkdown>;
    try {
      message = buildGroupWeeklyDigestMarkdown(source, timing);
      const delivered = await sendToGroup(chatId, message.title, message.markdown);
      if (!delivered) throw new Error("项目群发送失败或钉钉企业会话未配置");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await finishClaim({ claimKey, token: acquired.token, status: "error", error: detail });
      try {
        await writeRun("error", project.id, entityId, detail, []);
      } catch (auditError) {
        console.warn("[automation] group weekly digest error audit failed (non-fatal):", auditError);
      }
      continue;
    }
    // The external side effect has happened. Mark the claim fired before the
    // audit insert so a transient audit failure cannot duplicate a group post.
    await finishClaim({ claimKey, token: acquired.token, status: "fired" });
    try {
      await writeRun("fired", project.id, entityId, message.detail, [
        { chatId, channel: "project_group" },
      ]);
    } catch (error) {
      console.warn("[automation] group weekly digest run audit failed (non-fatal):", error);
    }
  }
}

async function defaultWriteRun(
  status: "fired" | "error",
  projectId: string,
  entityId: string,
  detail: string,
  recipients: unknown = [],
): Promise<void> {
  await createAutomationRun({
    ruleKey: "group_weekly_digest",
    projectId,
    eventType: "scheduled",
    entityType: "project",
    entityId,
    status,
    recipients,
    detail: detail.slice(0, 1000),
  });
}

function taskLines(
  tasks: GroupWeeklyDigestProject["tasks"],
  project: GroupWeeklyDigestProject["project"],
  dateLabel: string,
): string[] {
  const visible = tasks.slice(0, 5).map((task) => {
    const assignee = task.assigneeName?.trim() || "待分派";
    return `  - ${resolveTaskName(project, task.taskId, task.phaseId)}（${assignee}，${dateLabel} ${task.dueDate ?? "-"}）`;
  });
  if (tasks.length > visible.length) visible.push(`  - 另有 ${tasks.length - visible.length} 项，请进入项目查看`);
  return visible;
}

function isClosedTaskStatus(status: string): boolean {
  return status === "done" || status === "skipped";
}

function taskStatusLabel(status: string | undefined): string {
  if (status === "done") return "已完成";
  if (status === "in_progress") return "进行中";
  if (status === "blocked") return "阻塞";
  if (status === "pending_approval") return "待审批";
  if (status === "skipped") return "已跳过";
  if (status === "todo") return "待开始";
  return "未建立";
}

function isoWeekKey(mondayISO: string): string {
  const thursday = new Date(`${addDays(mondayISO, 3)}T00:00:00Z`);
  const weekYear = thursday.getUTCFullYear();
  const jan4ISO = `${weekYear}-01-04`;
  const jan4Weekday = new Date(`${jan4ISO}T00:00:00Z`).getUTCDay() || 7;
  const firstMonday = addDays(jan4ISO, 1 - jan4Weekday);
  const week = Math.floor((Date.parse(`${mondayISO}T00:00:00Z`) - Date.parse(`${firstMonday}T00:00:00Z`)) / 604_800_000) + 1;
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}
