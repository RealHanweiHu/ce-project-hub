import type { ActivityLog } from "../../drizzle/schema";
import type { DelayImpact } from "../../shared/delay-impact";
import {
  finishAutomationHeartbeat,
  getAutomationHeartbeat,
  getLatestActivityLogId,
  listActivityLogsAfter,
  tryStartAutomationHeartbeat,
} from "../db";
import { runAutomation } from "./engine";
import type { AutomationEvent } from "./rules";

export const ACTIVITY_LOG_TAILER_KEY = "activity_log_tailer";

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_LIMIT = 100;
const LOCK_STALE_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let ticking = false;

type RunResult = {
  cursorId: number;
  processed: number;
  skipped: number;
  initialized: boolean;
};

type TailerDeps = {
  tryStartAutomationHeartbeat?: typeof tryStartAutomationHeartbeat;
  getAutomationHeartbeat?: typeof getAutomationHeartbeat;
  getLatestActivityLogId?: typeof getLatestActivityLogId;
  listActivityLogsAfter?: typeof listActivityLogsAfter;
  finishAutomationHeartbeat?: typeof finishAutomationHeartbeat;
  runAutomation?: typeof runAutomation;
};

function intervalMs(): number {
  const raw = Number(process.env.ACTIVITY_LOG_TAIL_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_INTERVAL_MS;
}

function batchLimit(): number {
  const raw = Number(process.env.ACTIVITY_LOG_TAIL_BATCH_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 500) : DEFAULT_BATCH_LIMIT;
}

function shouldRunTailer(): boolean {
  if (process.env.AUTOMATION_EVENT_MODE === "inline") return false;
  if (process.env.ACTIVITY_LOG_TAILER_ENABLED === "false") return false;
  if (process.env.NODE_ENV === "test" && process.env.ACTIVITY_LOG_TAILER_IN_TEST !== "true") return false;
  return true;
}

export function startActivityLogTailer(): void {
  if (timer || !shouldRunTailer()) return;
  timer = setInterval(() => {
    void runActivityLogTailerTick().catch((error) => {
      console.warn("[automation] activity log tailer failed (non-fatal):", error);
    });
  }, intervalMs());
  timer.unref?.();
  void runActivityLogTailerTick().catch((error) => {
    console.warn("[automation] activity log tailer failed (non-fatal):", error);
  });
}

export function stopActivityLogTailer(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

async function runActivityLogTailerTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await runActivityLogTailerOnce();
  } finally {
    ticking = false;
  }
}

export async function runActivityLogTailerOnce(deps: TailerDeps = {}): Promise<RunResult | null> {
  const tryStart = deps.tryStartAutomationHeartbeat ?? tryStartAutomationHeartbeat;
  const getHeartbeat = deps.getAutomationHeartbeat ?? getAutomationHeartbeat;
  const getLatestId = deps.getLatestActivityLogId ?? getLatestActivityLogId;
  const listLogs = deps.listActivityLogsAfter ?? listActivityLogsAfter;
  const finishHeartbeat = deps.finishAutomationHeartbeat ?? finishAutomationHeartbeat;
  const dispatch = deps.runAutomation ?? runAutomation;
  const startedAt = Date.now();
  const locked = await tryStart(ACTIVITY_LOG_TAILER_KEY, LOCK_STALE_MS);
  if (!locked) return null;

  try {
    const heartbeat = await getHeartbeat(ACTIVITY_LOG_TAILER_KEY);
    let cursorId = heartbeat?.lastCursorId ?? 0;
    const firstRun = !heartbeat?.lastFinishedAt && cursorId === 0;

    if (firstRun && process.env.ACTIVITY_LOG_TAILER_REPLAY_HISTORY !== "true") {
      cursorId = await getLatestId();
      await finishHeartbeat({
        schedulerKey: ACTIVITY_LOG_TAILER_KEY,
        status: "skipped",
        durationMs: Date.now() - startedAt,
        lastCursorId: cursorId,
        error: null,
      });
      return { cursorId, processed: 0, skipped: 0, initialized: true };
    }

    const logs = await listLogs(cursorId, batchLimit());
    let processed = 0;
    let skipped = 0;
    let lastCursorId = cursorId;

    for (const log of logs) {
      const event = activityLogToAutomationEvent(log);
      if (event) {
        await dispatch(event);
        processed += 1;
      } else {
        skipped += 1;
      }
      lastCursorId = log.id;
    }

    await finishHeartbeat({
      schedulerKey: ACTIVITY_LOG_TAILER_KEY,
      status: "success",
      durationMs: Date.now() - startedAt,
      lastCursorId,
      error: null,
    });
    return { cursorId: lastCursorId, processed, skipped, initialized: false };
  } catch (error) {
    await finishHeartbeat({
      schedulerKey: ACTIVITY_LOG_TAILER_KEY,
      status: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function activityLogToAutomationEvent(log: ActivityLog): AutomationEvent | null {
  const meta = asRecord(log.meta) ?? {};
  const before = asRecord(meta.before);
  const after = asRecord(meta.after);
  const actorId = log.userId ?? null;
  const entityId = log.entityId ?? null;

  switch (log.action) {
    case "issue.create":
      return {
        action: "issue.create",
        projectId: log.projectId,
        entityType: "issue",
        entityId,
        actorId,
        before,
        after: after ?? pickFields(meta, ["id", "phaseId", "title", "severity", "status", "owner", "reporter", "creatorId"]),
      };
    case "issue.update":
    case "issue.close":
      return {
        action: log.action,
        projectId: log.projectId,
        entityType: "issue",
        entityId,
        actorId,
        before,
        after: after ?? mergePatch(before, meta.patch),
      };
    case "task.update_meta":
      return {
        action: "task.update_meta",
        projectId: log.projectId,
        entityType: "task",
        entityId: taskEntityId(log),
        actorId,
        before,
        after: after ?? mergePatch(before, meta.patch),
      };
    case "task.rescheduled":
      return {
        action: "task.rescheduled",
        projectId: log.projectId,
        entityType: "task",
        entityId: taskEntityId(log),
        actorId,
        before,
        after: after ?? pickFields(meta, ["taskId", "title", "projectCategory"]),
        impact: meta.impact as DelayImpact | undefined,
      };
    case "gate.create":
      return {
        action: "gate.create",
        projectId: log.projectId,
        entityType: "gate_review",
        entityId,
        actorId,
        before,
        after: after ?? pickFields(meta, ["id", "phaseId", "phaseName", "gateName", "decision", "roundNumber", "advancedTo"]),
      };
    case "gate.update":
      return {
        action: "gate.update",
        projectId: log.projectId,
        entityType: "gate_review",
        entityId,
        actorId,
        before,
        after: after ?? mergePatch(before, meta.patch),
      };
    case "phase.advance":
      return {
        action: "phase.advanced",
        projectId: log.projectId,
        entityType: "phase",
        entityId: entityId ?? (typeof meta.phaseId === "string" ? meta.phaseId : null),
        actorId,
        before,
        after: after ?? pickFields(meta, ["projectId", "fromPhaseId", "fromPhaseName", "phaseId", "phaseName"]),
      };
    case "mp.release":
      return {
        action: "mp.release",
        projectId: log.projectId,
        entityType: "mp_release",
        entityId,
        actorId,
        before,
        after: after ?? pickFields(meta, ["projectId", "productId", "productName", "revisionId", "revisionLabel"]),
      };
    case "product.definition_confirmed":
      return {
        action: "product.definition_confirmed",
        projectId: log.projectId,
        entityType: "product_definition",
        entityId,
        actorId,
        before,
        after: after ?? pickFields(meta, ["projectId", "productName", "versionNumber"]),
      };
    default:
      return null;
  }
}

function taskEntityId(log: ActivityLog): string | number | null {
  const meta = asRecord(log.meta);
  const phaseId = typeof meta?.phaseId === "string" ? meta.phaseId : null;
  if (phaseId && log.entityId) return `${log.projectId}:${phaseId}:${log.entityId}`;
  return log.entityId ?? null;
}

function mergePatch(before: Record<string, unknown> | null, patch: unknown): Record<string, unknown> | null {
  const patchRecord = asRecord(patch);
  if (!before && !patchRecord) return null;
  return { ...(before ?? {}), ...(patchRecord ?? {}) };
}

function pickFields(value: Record<string, unknown>, fields: string[]): Record<string, unknown> | null {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (value[field] !== undefined) picked[field] = value[field];
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
