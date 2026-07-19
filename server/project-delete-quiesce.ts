import { randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { projectDeletionLeases, projects } from "../drizzle/schema";
import { getDb } from "./db";
import {
  ProjectDeletionLeaseLostError,
  projectExternalOperationLockKey,
} from "./project-deletion-lease";

export { ProjectDeletionLeaseLostError } from "./project-deletion-lease";

const DELETION_LEASE_TTL_MS = 30 * 60 * 1000;
const DELETION_HEARTBEAT_INTERVAL_MS = DELETION_LEASE_TTL_MS / 3;

export type ProjectPushQuiesceState = {
  lifecycle: "active" | "paused" | "terminated";
  token: string;
};

export class ProjectDeleteInProgressError extends Error {
  constructor() {
    super("该项目已有删除操作正在进行，请勿重复提交");
    this.name = "ProjectDeleteInProgressError";
  }
}

export type ProjectDeletionLeaseHeartbeatOptions = {
  intervalMs?: number;
  ttlMs?: number;
};

export type ProjectDeletionLeaseHeartbeat = {
  stop: () => Promise<void>;
  assertHealthy: () => void;
};

function positiveDuration(value: number | undefined, fallback: number): number {
  const duration = value ?? fallback;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError("Lease duration must be a positive finite number");
  }
  return duration;
}

/** Claim deletion ownership and stop new project-scoped remote reservations. */
export async function quiesceProjectPushes(
  projectId: string
): Promise<ProjectPushQuiesceState> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const lockKey = projectExternalOperationLockKey(projectId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const now = new Date();
    const [existingLease] = await tx
      .select({
        token: projectDeletionLeases.token,
        previousLifecycle: projectDeletionLeases.previousLifecycle,
        expiresAt: projectDeletionLeases.expiresAt,
      })
      .from(projectDeletionLeases)
      .where(eq(projectDeletionLeases.projectId, projectId))
      .limit(1);
    if (existingLease && existingLease.expiresAt > now) {
      throw new ProjectDeleteInProgressError();
    }
    const [project] = await tx
      .select({ lifecycle: projects.lifecycle })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new Error("Project not found");
    const previousLifecycle =
      existingLease?.previousLifecycle ?? project.lifecycle;
    if (existingLease) {
      const removed = await tx
        .delete(projectDeletionLeases)
        .where(
          and(
            eq(projectDeletionLeases.projectId, projectId),
            eq(projectDeletionLeases.token, existingLease.token),
            lte(projectDeletionLeases.expiresAt, now)
          )
        )
        .returning({ token: projectDeletionLeases.token });
      if (removed.length !== 1) {
        throw new ProjectDeletionLeaseLostError(
          "项目删除租约已被其他操作更新，请重试"
        );
      }
    }
    const token = randomUUID();
    await tx.insert(projectDeletionLeases).values({
      projectId,
      token,
      previousLifecycle,
      expiresAt: new Date(now.getTime() + DELETION_LEASE_TTL_MS),
    });
    if (project.lifecycle === "active") {
      await tx
        .update(projects)
        .set({ lifecycle: "paused" })
        .where(
          and(eq(projects.id, projectId), eq(projects.lifecycle, "active"))
        );
    }
    return { lifecycle: previousLifecycle, token };
  });
}

/** Extend the current deletion lease without allowing an expired token back in. */
export async function renewProjectDeletionLease(
  projectId: string,
  state: Pick<ProjectPushQuiesceState, "token">,
  options: Pick<ProjectDeletionLeaseHeartbeatOptions, "ttlMs"> = {}
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ttlMs = positiveDuration(options.ttlMs, DELETION_LEASE_TTL_MS);
  await db.transaction(async tx => {
    const lockKey = projectExternalOperationLockKey(projectId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const now = new Date();
    const renewed = await tx
      .update(projectDeletionLeases)
      .set({ expiresAt: new Date(now.getTime() + ttlMs) })
      .where(
        and(
          eq(projectDeletionLeases.projectId, projectId),
          eq(projectDeletionLeases.token, state.token),
          gt(projectDeletionLeases.expiresAt, now)
        )
      )
      .returning({ token: projectDeletionLeases.token });
    if (renewed.length !== 1) throw new ProjectDeletionLeaseLostError();
  });
}

/**
 * Persist that irreversible cleanup may have started. If this worker crashes,
 * the expired-lease reaper must leave the project paused instead of resuming
 * ordinary notifications against a partially cleaned project.
 */
export async function markProjectDeletionCleanupStarted(
  projectId: string,
  state: Pick<ProjectPushQuiesceState, "token">
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const lockKey = projectExternalOperationLockKey(projectId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const now = new Date();
    const marked = await tx
      .update(projectDeletionLeases)
      .set({ previousLifecycle: "paused" })
      .where(
        and(
          eq(projectDeletionLeases.projectId, projectId),
          eq(projectDeletionLeases.token, state.token),
          gt(projectDeletionLeases.expiresAt, now)
        )
      )
      .returning({ token: projectDeletionLeases.token });
    if (marked.length !== 1) throw new ProjectDeletionLeaseLostError();
  });
}

/** Keep deletion ownership alive across slow external cleanup calls. */
export function startProjectDeletionLeaseHeartbeat(
  projectId: string,
  state: Pick<ProjectPushQuiesceState, "token">,
  options: ProjectDeletionLeaseHeartbeatOptions = {}
): ProjectDeletionLeaseHeartbeat {
  const intervalMs = positiveDuration(
    options.intervalMs,
    DELETION_HEARTBEAT_INTERVAL_MS
  );
  const ttlMs = positiveDuration(options.ttlMs, DELETION_LEASE_TTL_MS);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let fatalError: unknown;

  const schedule = () => {
    if (stopped || fatalError) return;
    timer = setTimeout(() => {
      timer = undefined;
      inFlight = renewProjectDeletionLease(projectId, state, { ttlMs })
        .catch(error => {
          // Any database error makes ownership unknowable. Keep the delete
          // fail-closed; a transient heartbeat failure must not be ignored by
          // a worker that may have been overtaken meanwhile.
          fatalError = error;
          console.warn(
            "[project.delete] lease heartbeat renewal failed:",
            projectId,
            state.token,
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
 * Recover a project left paused by a crashed delete owner. The same advisory
 * lock used for ownership changes ensures only an already-expired token is
 * removed, and a prior active lifecycle is restored atomically with removal.
 */
export async function reapExpiredProjectDeletionLease(
  projectId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const lockKey = projectExternalOperationLockKey(projectId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const now = new Date();
    const [lease] = await tx
      .select({
        token: projectDeletionLeases.token,
        previousLifecycle: projectDeletionLeases.previousLifecycle,
      })
      .from(projectDeletionLeases)
      .where(
        and(
          eq(projectDeletionLeases.projectId, projectId),
          lte(projectDeletionLeases.expiresAt, now)
        )
      )
      .limit(1);
    if (!lease) return false;
    const removed = await tx
      .delete(projectDeletionLeases)
      .where(
        and(
          eq(projectDeletionLeases.projectId, projectId),
          eq(projectDeletionLeases.token, lease.token),
          lte(projectDeletionLeases.expiresAt, now)
        )
      )
      .returning({
        token: projectDeletionLeases.token,
        previousLifecycle: projectDeletionLeases.previousLifecycle,
      });
    if (removed.length !== 1) return false;
    if (removed[0].previousLifecycle === "active") {
      await tx
        .update(projects)
        .set({ lifecycle: "active" })
        .where(
          and(eq(projects.id, projectId), eq(projects.lifecycle, "paused"))
        );
    }
    return true;
  });
}

/**
 * Explicitly validate and renew ownership for callers that are not committing
 * the delete. The hard-delete path performs its own validation while holding
 * this advisory lock through the real projects-row delete.
 */
export async function assertProjectDeletionLeaseOwnership(
  projectId: string,
  state: Pick<ProjectPushQuiesceState, "token">,
  options: Pick<ProjectDeletionLeaseHeartbeatOptions, "ttlMs"> = {}
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ttlMs = positiveDuration(options.ttlMs, DELETION_LEASE_TTL_MS);
  await db.transaction(async tx => {
    const lockKey = projectExternalOperationLockKey(projectId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const now = new Date();
    const renewed = await tx
      .update(projectDeletionLeases)
      .set({ expiresAt: new Date(now.getTime() + ttlMs) })
      .where(
        and(
          eq(projectDeletionLeases.projectId, projectId),
          eq(projectDeletionLeases.token, state.token),
          gt(projectDeletionLeases.expiresAt, now)
        )
      )
      .returning({ token: projectDeletionLeases.token });
    if (renewed.length !== 1) throw new ProjectDeletionLeaseLostError();
  });
}

/** Restore only the lifecycle owned by this exact failed delete request. */
export async function restoreProjectPushes(
  projectId: string,
  state: ProjectPushQuiesceState,
  options: { restoreLifecycle?: boolean } = {}
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async tx => {
    const lockKey = projectExternalOperationLockKey(projectId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const now = new Date();
    const removed = await tx
      .delete(projectDeletionLeases)
      .where(
        and(
          eq(projectDeletionLeases.projectId, projectId),
          eq(projectDeletionLeases.token, state.token),
          gt(projectDeletionLeases.expiresAt, now)
        )
      )
      .returning({ token: projectDeletionLeases.token });
    if (removed.length !== 1) return;
    if (options.restoreLifecycle !== false && state.lifecycle === "active") {
      await tx
        .update(projects)
        .set({ lifecycle: "active" })
        .where(
          and(eq(projects.id, projectId), eq(projects.lifecycle, "paused"))
        );
    }
  });
}
