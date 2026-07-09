import { ENV } from "../_core/env";
import {
  createAutomationRun,
  AUTOMATION_SCHEDULER_KEY,
  finishAutomationHeartbeat,
  getAllActiveProjects,
  getAutomationCriticalIssues,
  getAutomationDueIssues,
  getAutomationDueTasks,
  getAutomationPendingDeliverableReviews,
  getApproachingGates,
  getBlockedTasks,
  getGateReadiness,
  getUnassignedActiveTasks,
  hasAutomationRunForEntity,
  tryStartAutomationHeartbeat,
} from "../db";
import { pushWebhook } from "../_core/notify";
import { sendToGroupChat } from "../_core/dingtalkGroup";
import { taskDisplayTitle } from "../task-title";
import { runActionItemSlaScan } from "./actionItemSla";
import { ensureAutomationRuleDefaults, runAutomation } from "./engine";
import { runHealthDigestScan } from "./healthDigest";
import { runPersonalDailyDigestScan } from "./personalDailyDigest";
import { isAutomationSuppressedProject } from "./project-filter";

let timer: NodeJS.Timeout | null = null;

export async function runScheduledAutomationScan(now = new Date()): Promise<void> {
  await ensureAutomationRuleDefaults();
  const [tasks, issues, blockedTasks, criticalIssues, pendingReviews, unassignedTasks] = await Promise.all([
    getAutomationDueTasks(),
    getAutomationDueIssues(),
    getBlockedTasks(),
    getAutomationCriticalIssues(),
    getAutomationPendingDeliverableReviews(),
    getUnassignedActiveTasks(),
  ]);
  const approachingGates = await getApproachingGates();
  const today = toShanghaiISODate(now);

  // 逾期催办 + 截止前提醒 共用这批 task/issue 事件（规则各自过滤）
  for (const task of tasks) {
    const overdueDays = task.dueDate ? ageDays(today, task.dueDate) : null;
    const shouldEscalateAsOverdue = task.status !== "blocked" && overdueDays !== null && overdueDays > 0;
    await runAutomation({
      action: "scheduled",
      entityType: "task",
      projectId: task.projectId,
      entityId: `${task.projectId}:${task.phaseId}:${task.taskId}`,
      now,
      after: {
        ...task,
        title: taskDisplayTitle(task),
        ...(shouldEscalateAsOverdue
          ? { exceptionType: "overdue_task", exceptionAgeDays: overdueDays }
          : {}),
      },
    });
  }

  for (const issue of issues) {
    await runAutomation({
      action: "scheduled",
      entityType: "issue",
      projectId: issue.projectId,
      entityId: issue.id,
      now,
      after: issue,
    });
  }

  for (const task of blockedTasks) {
    await runAutomation({
      action: "scheduled",
      entityType: "task",
      projectId: task.projectId,
      entityId: `${task.projectId}:${task.phaseId}:${task.taskId}:blocked`,
      now,
      after: {
        ...task,
        dueDate: null,
        title: taskDisplayTitle(task),
        exceptionType: "blocked_task",
        exceptionAgeDays: ageDays(today, toShanghaiISODate(task.statusChangedAt ?? task.updatedAt)),
      },
    });
  }

  for (const task of unassignedTasks) {
    await runAutomation({
      action: "scheduled",
      entityType: "task",
      projectId: task.projectId,
      entityId: `${task.projectId}:${task.phaseId}:${task.taskId}:unassigned`,
      now,
      after: {
        ...task,
        title: taskDisplayTitle(task),
        unassigned: true,
        assignmentAction: true,
      },
    });
  }

  for (const issue of criticalIssues) {
    await runAutomation({
      action: "scheduled",
      entityType: "issue",
      projectId: issue.projectId,
      entityId: `${issue.id}:critical`,
      now,
      after: {
        ...issue,
        targetDate: null,
        exceptionType: "critical_issue",
        exceptionAgeDays: ageDays(today, issue.foundDate || toShanghaiISODate(issue.createdAt)),
      },
    });
  }

  for (const review of pendingReviews) {
    await runAutomation({
      action: "scheduled",
      entityType: "deliverable_review",
      projectId: review.projectId,
      entityId: `${review.id}:pending`,
      now,
      after: {
        ...review,
        title: review.deliverableName,
        assigneeUserId: review.reviewerUserId,
        exceptionType: "pending_review",
        exceptionAgeDays: ageDays(today, toShanghaiISODate(review.submittedAt)),
      },
    });
  }

  // Gate 就绪度提醒：对临近 gate 算就绪度，未就绪才发（规则再按 leadDays 精确过滤）
  for (const g of approachingGates) {
    const readiness = await getGateReadiness(g.projectId, g.phaseId);
    if (!readiness) continue;
    await runAutomation({
      action: "scheduled",
      entityType: "task",
      projectId: g.projectId,
      entityId: `gate:${g.projectId}:${g.gateTaskId}`,
      now,
      after: {
        isGate: true,
        taskId: g.gateTaskId,
        gateName: g.gateName,
        title: g.gateName,
        dueDate: g.dueDate,
        status: g.status,
        notReady: !readiness.ready,
        blockerSummaries: readiness.dimensions.filter((d) => !d.ok).map((d) => d.summary),
      },
    });
  }

  // 健康度摘要（聚合型，自带到点/去重；失败不影响其他扫描）
  try {
    await runHealthDigestScan(now);
  } catch (error) {
    console.warn("[automation] health digest failed (non-fatal):", error);
  }

  try {
    await runPersonalDailyDigestScan(now);
  } catch (error) {
    console.warn("[automation] personal daily digest failed (non-fatal):", error);
  }

  try {
    await runActionItemSlaScan(now);
  } catch (error) {
    console.warn("[automation] action item SLA scan failed (non-fatal):", error);
  }

  try {
    await runWeeklyMeetingFallbackScan(now);
  } catch (error) {
    console.warn("[automation] weekly meeting fallback failed (non-fatal):", error);
  }
}

export function startAutomationScheduler(): void {
  if (timer) return;
  const intervalMs = Math.max(1, ENV.automationScanIntervalMin) * 60 * 1000;
  timer = setInterval(() => {
    void runScheduledAutomationTick().catch((error) => {
      console.warn("[automation] scheduled scan failed (non-fatal):", error);
    });
  }, intervalMs);
}

async function runScheduledAutomationTick(): Promise<void> {
  const startedAt = Date.now();
  const locked = await tryStartAutomationHeartbeat(AUTOMATION_SCHEDULER_KEY);
  if (!locked) return;
  try {
    await runScheduledAutomationScan();
    await finishAutomationHeartbeat({
      schedulerKey: AUTOMATION_SCHEDULER_KEY,
      status: "success",
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    await finishAutomationHeartbeat({
      schedulerKey: AUTOMATION_SCHEDULER_KEY,
      status: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function stopAutomationScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function toShanghaiISODate(value: Date | string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

function ageDays(todayISO: string, startISO: string): number {
  const today = new Date(`${todayISO}T00:00:00Z`);
  const start = new Date(`${startISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(today.getTime()) || Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86_400_000));
}

type MeetingConfig = { enabled: boolean; weekday: number; time: string; durationMin: number; title: string };

function getMeetingConfig(value: unknown): MeetingConfig | null {
  if (!value || typeof value !== "object") return null;
  const cfg = value as Partial<MeetingConfig>;
  if (!cfg.enabled || typeof cfg.weekday !== "number" || typeof cfg.time !== "string") return null;
  return cfg as MeetingConfig;
}

function shanghaiWeekday(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts);
}

function weekKey(now: Date): string {
  const today = new Date(`${toShanghaiISODate(now)}T00:00:00Z`);
  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  today.setUTCDate(today.getUTCDate() + mondayOffset);
  return today.toISOString().slice(0, 10);
}

async function runWeeklyMeetingFallbackScan(now: Date): Promise<void> {
  const todayWeekday = shanghaiWeekday(now);
  if (todayWeekday < 0) return;
  const projects = await getAllActiveProjects();
  for (const project of projects) {
    if (isAutomationSuppressedProject(project)) continue;
    const config = getMeetingConfig(project.meetingConfig);
    if (!config?.enabled) continue;
    if (config.weekday !== todayWeekday) continue;
    if (project.dingtalkMeetingSyncStatus === "synced") continue;

    const entityId = `${project.id}:${weekKey(now)}`;
    const ruleKey = "weekly_meeting_reminder";
    if (await hasAutomationRunForEntity({ ruleKey, entityId })) continue;

    const title = "项目周会提醒";
    const text = `【${project.name}】项目周会：今天 ${config.time}（${config.durationMin} 分钟）`;
    const markdown = `### ${title}\n${text}`;
    try {
      let sentToProjectGroup = false;
      if (project.dingtalkChatId) {
        sentToProjectGroup = await sendToGroupChat(project.dingtalkChatId, title, markdown);
      }
      if (!sentToProjectGroup) await pushWebhook(text, { title, markdown });
      await createAutomationRun({
        ruleKey,
        projectId: project.id,
        eventType: "scheduled",
        entityType: "task",
        entityId,
        status: "fired",
        recipients: { group: project.dingtalkChatId ?? "webhook" },
        detail: text,
      });
    } catch (error) {
      await createAutomationRun({
        ruleKey,
        projectId: project.id,
        eventType: "scheduled",
        entityType: "task",
        entityId,
        status: "error",
        recipients: [],
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
