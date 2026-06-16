import { ENV } from "../_core/env";
import { getAutomationDueIssues, getAutomationDueTasks, getApproachingGates, getGateReadiness } from "../db";
import { runAutomation } from "./engine";
import { runHealthDigestScan } from "./healthDigest";

let timer: NodeJS.Timeout | null = null;

export async function runScheduledAutomationScan(now = new Date()): Promise<void> {
  const [tasks, issues] = await Promise.all([
    getAutomationDueTasks(),
    getAutomationDueIssues(),
  ]);
  const approachingGates = await getApproachingGates();

  // 逾期催办 + 截止前提醒 共用这批 task/issue 事件（规则各自过滤）
  for (const task of tasks) {
    await runAutomation({
      action: "scheduled",
      entityType: "task",
      projectId: task.projectId,
      entityId: `${task.projectId}:${task.phaseId}:${task.taskId}`,
      now,
      after: { ...task, title: task.taskId },
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
