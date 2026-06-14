import { ENV } from "../_core/env";
import { getAutomationOverdueIssues, getAutomationOverdueTasks } from "../db";
import { runAutomation } from "./engine";

let timer: NodeJS.Timeout | null = null;

export async function runScheduledAutomationScan(now = new Date()): Promise<void> {
  const [tasks, issues] = await Promise.all([
    getAutomationOverdueTasks(),
    getAutomationOverdueIssues(),
  ]);

  for (const task of tasks) {
    await runAutomation({
      action: "scheduled",
      entityType: "task",
      projectId: task.projectId,
      entityId: `${task.projectId}:${task.phaseId}:${task.taskId}`,
      now,
      after: {
        ...task,
        title: task.taskId,
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
