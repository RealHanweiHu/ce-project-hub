import { ENV } from "../_core/env";
import { getAutomationDueIssues, getAutomationDueTasks, getAutomationGatePrereqs } from "../db";
import { runAutomation } from "./engine";

let timer: NodeJS.Timeout | null = null;

export async function runScheduledAutomationScan(now = new Date()): Promise<void> {
  const [tasks, issues, gates] = await Promise.all([
    getAutomationDueTasks(),
    getAutomationDueIssues(),
    getAutomationGatePrereqs(),
  ]);

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

  // Gate 前置未完提醒（gate 任务事件带 isGate + 未完成前置数）
  for (const g of gates) {
    await runAutomation({
      action: "scheduled",
      entityType: "task",
      projectId: g.projectId,
      entityId: `gate:${g.projectId}:${g.taskId}`,
      now,
      after: { isGate: true, taskId: g.taskId, title: g.title, dueDate: g.dueDate, status: g.status, incompletePrereqCount: g.incompletePrereqCount },
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
