import { ENV } from "../_core/env";
import { getAutomationDueIssues, getAutomationDueTasks, getApproachingGates, getGateReadiness } from "../db";
import { runAutomation } from "./engine";
import { runHealthDigestScan, shanghaiParts } from "./healthDigest";

let timer: NodeJS.Timeout | null = null;
let schedulerIntervalMs = 0;
let isScanning = false;

const AUTOMATION_SCAN_BATCH_SIZE = 500;

export async function runScheduledAutomationScan(now = new Date()): Promise<void> {
  if (isScanning) {
    console.warn("[automation] scheduled scan skipped because a previous scan is still running");
    return;
  }

  isScanning = true;
  try {
    const { todayISO } = shanghaiParts(now);

    // 逾期催办 + 截止前提醒 共用这批 task/issue 事件（规则各自过滤）
    await scanBatches((offset) => getAutomationDueTasks({ todayISO, limit: AUTOMATION_SCAN_BATCH_SIZE, offset }), async (task) => {
      await runAutomation({
        action: "scheduled",
        entityType: "task",
        projectId: task.projectId,
        entityId: `${task.projectId}:${task.phaseId}:${task.taskId}`,
        now,
        after: { ...task, title: task.taskId },
      });
    });

    await scanBatches((offset) => getAutomationDueIssues({ todayISO, limit: AUTOMATION_SCAN_BATCH_SIZE, offset }), async (issue) => {
      await runAutomation({
        action: "scheduled",
        entityType: "issue",
        projectId: issue.projectId,
        entityId: issue.id,
        now,
        after: issue,
      });
    });

    // Gate 就绪度提醒：对临近 gate 算就绪度，未就绪才发（规则再按 leadDays 精确过滤）
    const approachingGates = await getApproachingGates();
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
  } finally {
    isScanning = false;
  }
}

export function startAutomationScheduler(): void {
  if (timer || schedulerIntervalMs > 0) return;
  schedulerIntervalMs = Math.max(1, ENV.automationScanIntervalMin) * 60 * 1000;
  scheduleNextScan();
}

export function stopAutomationScheduler(): void {
  schedulerIntervalMs = 0;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function scanBatches<T>(load: (offset: number) => Promise<T[]>, handle: (item: T) => Promise<void>): Promise<void> {
  for (let offset = 0; ; offset += AUTOMATION_SCAN_BATCH_SIZE) {
    const rows = await load(offset);
    for (const row of rows) {
      await handle(row);
    }
    if (rows.length < AUTOMATION_SCAN_BATCH_SIZE) return;
  }
}

function scheduleNextScan(): void {
  if (schedulerIntervalMs <= 0 || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void runScheduledAutomationScan()
      .catch((error) => {
        console.warn("[automation] scheduled scan failed (non-fatal):", error);
      })
      .finally(() => {
        scheduleNextScan();
      });
  }, schedulerIntervalMs);
}
