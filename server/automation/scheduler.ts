import { ENV } from "../_core/env";
import {
  getAutomationCriticalIssues,
  getAutomationDueIssues,
  getAutomationDueTasks,
  getAutomationPendingDeliverableReviews,
  getApproachingGates,
  getBlockedTasks,
  getGateReadiness,
} from "../db";
import { runAutomation } from "./engine";
import { runHealthDigestScan } from "./healthDigest";

let timer: NodeJS.Timeout | null = null;

export async function runScheduledAutomationScan(now = new Date()): Promise<void> {
  const [tasks, issues, blockedTasks, criticalIssues, pendingReviews] = await Promise.all([
    getAutomationDueTasks(),
    getAutomationDueIssues(),
    getBlockedTasks(),
    getAutomationCriticalIssues(),
    getAutomationPendingDeliverableReviews(),
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
        title: task.taskId,
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
        title: task.taskId,
        exceptionType: "blocked_task",
        exceptionAgeDays: ageDays(today, toShanghaiISODate(task.statusChangedAt ?? task.updatedAt)),
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
}

export function startAutomationScheduler(): void {
  if (timer) return;
  const intervalMs = Math.max(1, ENV.automationScanIntervalMin) * 60 * 1000;
  timer = setInterval(() => {
    void runScheduledAutomationScan().catch((error) => {
      console.warn("[automation] scheduled scan failed (non-fatal):", error);
    });
  }, intervalMs);
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
