import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import {
  projectDeletionLeases,
  projectExternalOperations,
  projects,
} from "../drizzle/schema";
import { getDb } from "./db";

const OPERATION_TTL_MS = 15 * 60 * 1000;
const OPERATION_HEARTBEAT_INTERVAL_MS = OPERATION_TTL_MS / 3;
const REMOTE_OUTCOME_QUARANTINE_MS = 15 * 60 * 1000;
const uncertainReservationTokens = new Set<string>();

export class ProjectExternalOperationBlockedError extends Error {
  constructor(message = "项目正在删除或已停止，不能再创建新的钉钉操作") {
    super(message);
    this.name = "ProjectExternalOperationBlockedError";
  }
}

export class ProjectExternalOperationLeaseLostError extends Error {
  constructor(message = "项目外部操作租约已失效") {
    super(message);
    this.name = "ProjectExternalOperationLeaseLostError";
  }
}

export class ProjectRemoteOutcomeUncertainError extends Error {
  constructor(message = "钉钉请求结果未知，为避免重复推送已暂时隔离该项目") {
    super(message);
    this.name = "ProjectRemoteOutcomeUncertainError";
  }
}

export type ProjectExternalOperationReservation = {
  token: string;
  projectIds: string[];
  kind?: string;
};

export type ProjectExternalOperationHeartbeatOptions = {
  intervalMs?: number;
  ttlMs?: number;
};

export type ProjectExternalOperationHeartbeat = {
  stop: () => Promise<void>;
  assertHealthy: () => void;
};

type ProjectExternalOperationContext = {
  reservation: ProjectExternalOperationReservation;
  heartbeat?: ProjectExternalOperationHeartbeat;
};

const currentProjectExternalOperation =
  new AsyncLocalStorage<ProjectExternalOperationContext>();

function normalizedProjectIds(projectIds: readonly string[]): string[] {
  return Array.from(new Set(projectIds.filter(Boolean))).sort();
}

function positiveDuration(value: number | undefined, fallback: number): number {
  const duration = value ?? fallback;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError("Lease duration must be a positive finite number");
  }
  return duration;
}

/**
 * Atomically reserve all projects before a remote side effect. The same
 * project-scoped advisory lock is used by hard delete, so either the operation
 * is visible to delete or delete wins and the operation never starts.
 */
export async function reserveProjectExternalOperation(
  projectIds: readonly string[],
  kind: string
): Promise<ProjectExternalOperationReservation> {
  const ids = normalizedProjectIds(projectIds);
  const token = randomUUID();
  if (ids.length === 0) return { token, projectIds: ids, kind };
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async tx => {
    for (const projectId of ids) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`project-external:${projectId}`}))`
      );
    }
    const now = new Date();
    await tx
      .delete(projectExternalOperations)
      .where(
        and(
          inArray(projectExternalOperations.projectId, ids),
          lte(projectExternalOperations.expiresAt, now)
        )
      );
    const expiredDeletionRows = await tx
      .select({
        projectId: projectDeletionLeases.projectId,
        previousLifecycle: projectDeletionLeases.previousLifecycle,
      })
      .from(projectDeletionLeases)
      .where(
        and(
          inArray(projectDeletionLeases.projectId, ids),
          lte(projectDeletionLeases.expiresAt, now)
        )
      );
    const activeBeforeDeleteIds = expiredDeletionRows
      .filter(row => row.previousLifecycle === "active")
      .map(row => row.projectId);
    if (activeBeforeDeleteIds.length > 0) {
      await tx
        .update(projects)
        .set({ lifecycle: "active" })
        .where(
          and(
            inArray(projects.id, activeBeforeDeleteIds),
            eq(projects.lifecycle, "paused")
          )
        );
    }
    if (expiredDeletionRows.length > 0) {
      await tx.delete(projectDeletionLeases).where(
        and(
          inArray(
            projectDeletionLeases.projectId,
            expiredDeletionRows.map(row => row.projectId)
          ),
          lte(projectDeletionLeases.expiresAt, now)
        )
      );
    }
    const uncertainRows = await tx
      .select({ projectId: projectExternalOperations.projectId })
      .from(projectExternalOperations)
      .where(
        and(
          inArray(projectExternalOperations.projectId, ids),
          gt(projectExternalOperations.expiresAt, now),
          sql`${projectExternalOperations.kind} LIKE 'uncertain:%'`
        )
      )
      .limit(1);
    if (uncertainRows.length > 0) {
      throw new ProjectExternalOperationBlockedError(
        "项目存在结果待确认的钉钉发送，隔离期内不会继续推送"
      );
    }
    const [activeRows, deletionRows] = await Promise.all([
      tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            inArray(projects.id, ids),
            eq(projects.archived, false),
            eq(projects.lifecycle, "active")
          )
        ),
      tx
        .select({ projectId: projectDeletionLeases.projectId })
        .from(projectDeletionLeases)
        .where(inArray(projectDeletionLeases.projectId, ids)),
    ]);
    if (activeRows.length !== ids.length || deletionRows.length > 0) {
      throw new ProjectExternalOperationBlockedError();
    }
    const expiresAt = new Date(now.getTime() + OPERATION_TTL_MS);
    await tx.insert(projectExternalOperations).values(
      ids.map(projectId => ({
        projectId,
        token,
        kind,
        expiresAt,
      }))
    );
  });

  return { token, projectIds: ids, kind };
}

export async function releaseProjectExternalOperation(
  token: string
): Promise<void> {
  // A response-lost POST may already have committed remotely. Preserve its
  // durable row until the bounded quarantine expires instead of making delete
  // immediately assume that no message can still arrive.
  if (uncertainReservationTokens.delete(token)) return;
  const db = await getDb();
  if (!db) return;
  await db
    .delete(projectExternalOperations)
    .where(eq(projectExternalOperations.token, token));
}

/**
 * Quarantine a non-idempotent remote POST whose response was lost or
 * ambiguous. The row remains visible to hard delete and blocks automatic
 * fallback/retry for one operation TTL. This is intentionally bounded because
 * webhook/group APIs expose no client idempotency key that can be reconciled.
 */
export async function quarantineCurrentProjectExternalOperation(
  message: string,
  options: { quarantineMs?: number } = {}
): Promise<void> {
  const context = currentProjectExternalOperation.getStore();
  if (!context || context.reservation.projectIds.length === 0) return;
  const quarantineMs = positiveDuration(
    options.quarantineMs,
    REMOTE_OUTCOME_QUARANTINE_MS
  );
  const { reservation } = context;
  uncertainReservationTokens.add(reservation.token);
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const kind = `uncertain:${reservation.kind ?? "remote"}`.slice(0, 64);
  try {
    await db
      .update(projectExternalOperations)
      .set({
        kind,
        expiresAt: new Date(now.getTime() + quarantineMs),
      })
      .where(
        and(
          eq(projectExternalOperations.token, reservation.token),
          inArray(
            projectExternalOperations.projectId,
            reservation.projectIds
          ),
          gt(projectExternalOperations.expiresAt, now)
        )
      );
  } catch (error) {
    // The original row is still retained by the in-memory release guard. Its
    // normal TTL is the conservative fallback if this checkpoint fails.
    console.warn(
      "[project.external-operation] failed to checkpoint uncertain outcome:",
      reservation.token,
      message,
      error
    );
  }
}

export async function hasUncertainProjectExternalOperations(
  projectId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const [row] = await db
    .select({ id: projectExternalOperations.id })
    .from(projectExternalOperations)
    .where(
      and(
        eq(projectExternalOperations.projectId, projectId),
        gt(projectExternalOperations.expiresAt, now),
        sql`${projectExternalOperations.kind} LIKE 'uncertain:%'`
      )
    )
    .limit(1);
  return Boolean(row);
}

/** Extend an existing reservation only while this exact token still owns it. */
export async function renewProjectExternalOperation(
  reservation: ProjectExternalOperationReservation,
  options: Pick<ProjectExternalOperationHeartbeatOptions, "ttlMs"> = {}
): Promise<void> {
  const ids = normalizedProjectIds(reservation.projectIds);
  if (ids.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const ttlMs = positiveDuration(options.ttlMs, OPERATION_TTL_MS);
  const renewed = await db
    .update(projectExternalOperations)
    .set({ expiresAt: new Date(now.getTime() + ttlMs) })
    .where(
      and(
        eq(projectExternalOperations.token, reservation.token),
        inArray(projectExternalOperations.projectId, ids),
        gt(projectExternalOperations.expiresAt, now)
      )
    )
    .returning({ projectId: projectExternalOperations.projectId });
  const renewedIds = new Set(renewed.map(row => row.projectId));
  if (
    renewedIds.size !== ids.length ||
    ids.some(projectId => !renewedIds.has(projectId))
  ) {
    throw new ProjectExternalOperationLeaseLostError();
  }
}

/**
 * Keep a manually reserved operation alive until the caller stops it. Renewal
 * never recreates a missing/expired row, so an old token cannot regain ownership.
 */
export function startProjectExternalOperationHeartbeat(
  reservation: ProjectExternalOperationReservation,
  options: ProjectExternalOperationHeartbeatOptions = {}
): ProjectExternalOperationHeartbeat {
  const intervalMs = positiveDuration(
    options.intervalMs,
    OPERATION_HEARTBEAT_INTERVAL_MS
  );
  const ttlMs = positiveDuration(options.ttlMs, OPERATION_TTL_MS);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let fatalError: unknown;

  const schedule = () => {
    if (stopped || fatalError || reservation.projectIds.length === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      inFlight = renewProjectExternalOperation(reservation, { ttlMs })
        .catch(error => {
          // A database error makes ownership unknowable. Treat every renewal
          // failure as fatal so a worker can never resume remote writes after
          // deletion merely because the failed heartbeat was transient.
          fatalError = error;
          console.warn(
            "[project.external-operation] heartbeat renewal failed:",
            reservation.token,
            error
          );
        })
        .finally(() => {
          inFlight = undefined;
          schedule();
        });
    }, intervalMs);
    timer.unref?.();
  };

  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await inFlight;
    },
    assertHealthy() {
      if (fatalError) throw fatalError;
    },
  };
}

/**
 * Propagate a manually-created reservation to low-level remote transports.
 * This is used by the notification gateway, which reserves work itself so it
 * can preserve its injected test seams.
 */
export async function runWithProjectExternalOperationReservation<T>(
  reservation: ProjectExternalOperationReservation,
  heartbeat: ProjectExternalOperationHeartbeat | undefined,
  operation: () => Promise<T>
): Promise<T> {
  return currentProjectExternalOperation.run(
    { reservation, heartbeat },
    operation
  );
}

/**
 * Synchronously fence the current operation immediately before a remote HTTP
 * side effect. Renewing here closes the SIGSTOP/TTL window that a background
 * heartbeat alone cannot close. No active project context is a deliberate
 * no-op for non-project DingTalk administration calls.
 */
export async function assertCurrentProjectExternalOperationLease(): Promise<void> {
  const context = currentProjectExternalOperation.getStore();
  if (!context || context.reservation.projectIds.length === 0) return;
  context.heartbeat?.assertHealthy();
  await renewProjectExternalOperation(context.reservation);
  context.heartbeat?.assertHealthy();
}

export async function withProjectExternalOperation<T>(
  projectIds: readonly string[],
  kind: string,
  operation: () => Promise<T>,
  heartbeatOptions: ProjectExternalOperationHeartbeatOptions = {}
): Promise<T> {
  const reservation = await reserveProjectExternalOperation(projectIds, kind);
  let heartbeat: ProjectExternalOperationHeartbeat | undefined;
  try {
    heartbeat = startProjectExternalOperationHeartbeat(
      reservation,
      heartbeatOptions
    );
    const result = await runWithProjectExternalOperationReservation(
      reservation,
      heartbeat,
      operation
    );
    await heartbeat.stop();
    heartbeat.assertHealthy();
    return result;
  } finally {
    await heartbeat?.stop();
    await releaseProjectExternalOperation(reservation.token).catch(error => {
      console.warn(
        "[project.external-operation] failed to release reservation:",
        reservation.token,
        error
      );
    });
  }
}

export async function hasActiveProjectExternalOperations(
  projectId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  await db
    .delete(projectExternalOperations)
    .where(
      and(
        eq(projectExternalOperations.projectId, projectId),
        lte(projectExternalOperations.expiresAt, now)
      )
    );
  const [row] = await db
    .select({ id: projectExternalOperations.id })
    .from(projectExternalOperations)
    .where(
      and(
        eq(projectExternalOperations.projectId, projectId),
        gt(projectExternalOperations.expiresAt, now)
      )
    )
    .limit(1);
  return Boolean(row);
}

export async function waitForProjectExternalOperations(
  projectId: string,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollMs = options.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  while (await hasActiveProjectExternalOperations(projectId)) {
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  return true;
}
