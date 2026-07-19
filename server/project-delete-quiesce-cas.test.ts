import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { projectDeletionLeases, projects } from "../drizzle/schema";
import { getDb } from "./db";
import {
  assertProjectDeletionLeaseOwnership,
  markProjectDeletionCleanupStarted,
  ProjectDeletionLeaseLostError,
  quiesceProjectPushes,
  reapExpiredProjectDeletionLease,
  renewProjectDeletionLease,
  restoreProjectPushes,
  startProjectDeletionLeaseHeartbeat,
} from "./project-delete-quiesce";

const PROJECT = `quiet-cas-${Date.now().toString().slice(-8)}`;
const USER = 986701;

async function waitForAdvisoryLockWaiters(client: Client, minimum: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await client.query<{ waiting: number }>(`
      select count(distinct waiting.pid)::int as waiting
      from pg_locks held
      join pg_locks waiting
        on waiting.locktype = held.locktype
       and waiting.database is not distinct from held.database
       and waiting.classid is not distinct from held.classid
       and waiting.objid is not distinct from held.objid
       and waiting.objsubid is not distinct from held.objsubid
      where held.pid = pg_backend_pid()
        and held.locktype = 'advisory'
        and held.granted
        and not waiting.granted
    `);
    if (Number(result.rows[0]?.waiting ?? 0) >= minimum) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Expected at least ${minimum} deletion-lease lock waiter(s)`);
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "删除静默 CAS",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "active",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

beforeEach(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db
    .delete(projectDeletionLeases)
    .where(eq(projectDeletionLeases.projectId, PROJECT));
  await db
    .update(projects)
    .set({ lifecycle: "active", archived: false })
    .where(eq(projects.id, PROJECT));
});

describe("project delete push quiesce lease", () => {
  it("allows only one concurrent delete owner and restores only that token", async () => {
    const results = await Promise.allSettled([
      quiesceProjectPushes(PROJECT),
      quiesceProjectPushes(PROJECT),
    ]);
    const fulfilled = results.filter(result => result.status === "fulfilled");
    const rejected = results.filter(result => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({ name: "ProjectDeleteInProgressError" }),
    });

    const owner = (
      fulfilled[0] as PromiseFulfilledResult<
        Awaited<ReturnType<typeof quiesceProjectPushes>>
      >
    ).value;
    const db = await getDb();
    if (!db) throw new Error("no db");
    let [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(project.lifecycle).toBe("paused");

    await restoreProjectPushes(PROJECT, { ...owner, token: "not-the-owner" });
    [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(project.lifecycle).toBe("paused");

    await restoreProjectPushes(PROJECT, owner);
    [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(project.lifecycle).toBe("active");
  });

  it("renews the deletion lease while cleanup is still running", async () => {
    const owner = await quiesceProjectPushes(PROJECT);
    const db = await getDb();
    if (!db) throw new Error("no db");
    const [initial] = await db
      .select({ expiresAt: projectDeletionLeases.expiresAt })
      .from(projectDeletionLeases)
      .where(eq(projectDeletionLeases.projectId, PROJECT));
    const heartbeat = startProjectDeletionLeaseHeartbeat(PROJECT, owner, {
      intervalMs: 5,
      ttlMs: 60 * 60 * 1000,
    });

    await vi.waitFor(
      async () => {
        const [renewed] = await db
          .select({ expiresAt: projectDeletionLeases.expiresAt })
          .from(projectDeletionLeases)
          .where(eq(projectDeletionLeases.projectId, PROJECT));
        expect(renewed.expiresAt.getTime()).toBeGreaterThan(
          initial.expiresAt.getTime()
        );
      },
      { timeout: 2_000, interval: 10 }
    );
    await heartbeat.stop();
    heartbeat.assertHealthy();
    const [renewed] = await db
      .select({ expiresAt: projectDeletionLeases.expiresAt })
      .from(projectDeletionLeases)
      .where(eq(projectDeletionLeases.projectId, PROJECT));
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(
      initial.expiresAt.getTime()
    );
    await restoreProjectPushes(PROJECT, owner);
  });

  it("serializes renewal and irreversible-cleanup marking on the project barrier", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const owner = await quiesceProjectPushes(PROJECT);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let lockHeld = false;
    let renewal: Promise<void> | undefined;
    let marking: Promise<void> | undefined;

    try {
      await blocker.query("select pg_advisory_lock(hashtext($1))", [
        `project-external:${PROJECT}`,
      ]);
      lockHeld = true;

      renewal = renewProjectDeletionLease(PROJECT, owner);
      marking = markProjectDeletionCleanupStarted(PROJECT, owner);
      await waitForAdvisoryLockWaiters(blocker, 2);

      const db = await getDb();
      if (!db) throw new Error("no db");
      const [leaseWhileBlocked] = await db
        .select({ previousLifecycle: projectDeletionLeases.previousLifecycle })
        .from(projectDeletionLeases)
        .where(eq(projectDeletionLeases.projectId, PROJECT));
      expect(leaseWhileBlocked.previousLifecycle).toBe("active");
    } finally {
      if (lockHeld) {
        await blocker.query("select pg_advisory_unlock(hashtext($1))", [
          `project-external:${PROJECT}`,
        ]);
      }
      await Promise.allSettled([renewal, marking].filter(Boolean));
      await blocker.end();
      await restoreProjectPushes(PROJECT, owner, { restoreLifecycle: false });
    }

    await expect(renewal).resolves.toBeUndefined();
    await expect(marking).resolves.toBeUndefined();
  });

  it("rejects a stale token at renewal and at the final fencing check", async () => {
    const owner = await quiesceProjectPushes(PROJECT);
    const staleOwner = { ...owner, token: "not-the-owner" };

    await expect(
      renewProjectDeletionLease(PROJECT, staleOwner)
    ).rejects.toBeInstanceOf(ProjectDeletionLeaseLostError);
    await expect(
      assertProjectDeletionLeaseOwnership(PROJECT, staleOwner)
    ).rejects.toBeInstanceOf(ProjectDeletionLeaseLostError);
    await expect(
      assertProjectDeletionLeaseOwnership(PROJECT, owner, {
        ttlMs: 60 * 60 * 1000,
      })
    ).resolves.toBeUndefined();

    await restoreProjectPushes(PROJECT, owner);
  });

  it("can release a failed-delete lease without reactivating a partially cleaned project", async () => {
    const owner = await quiesceProjectPushes(PROJECT);

    await restoreProjectPushes(PROJECT, owner, {
      restoreLifecycle: false,
    });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db
      .select({ lifecycle: projects.lifecycle })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    const [lease] = await db
      .select({ token: projectDeletionLeases.token })
      .from(projectDeletionLeases)
      .where(eq(projectDeletionLeases.projectId, PROJECT));
    expect(project.lifecycle).toBe("paused");
    expect(lease).toBeUndefined();
  });

  it("reaps only an expired owner and never lets its old token regain ownership", async () => {
    const owner = await quiesceProjectPushes(PROJECT);
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db
      .update(projectDeletionLeases)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(projectDeletionLeases.projectId, PROJECT));

    await expect(reapExpiredProjectDeletionLease(PROJECT)).resolves.toBe(true);
    await expect(reapExpiredProjectDeletionLease(PROJECT)).resolves.toBe(false);
    const [project] = await db
      .select({ lifecycle: projects.lifecycle })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    const [lease] = await db
      .select({ token: projectDeletionLeases.token })
      .from(projectDeletionLeases)
      .where(eq(projectDeletionLeases.projectId, PROJECT));
    expect(project.lifecycle).toBe("active");
    expect(lease).toBeUndefined();

    await expect(
      renewProjectDeletionLease(PROJECT, owner)
    ).rejects.toBeInstanceOf(ProjectDeletionLeaseLostError);
    await expect(
      assertProjectDeletionLeaseOwnership(PROJECT, owner)
    ).rejects.toBeInstanceOf(ProjectDeletionLeaseLostError);
  });

  it("does not let an expired owner restore lifecycle or remove the lease", async () => {
    const owner = await quiesceProjectPushes(PROJECT);
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db
      .update(projectDeletionLeases)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(projectDeletionLeases.projectId, PROJECT));

    await restoreProjectPushes(PROJECT, owner);

    const [project] = await db
      .select({ lifecycle: projects.lifecycle })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    const [lease] = await db
      .select({ token: projectDeletionLeases.token })
      .from(projectDeletionLeases)
      .where(eq(projectDeletionLeases.projectId, PROJECT));
    expect(project.lifecycle).toBe("paused");
    expect(lease.token).toBe(owner.token);

    await expect(reapExpiredProjectDeletionLease(PROJECT)).resolves.toBe(true);
  });

  it("keeps a partially cleaned project paused when a crashed owner is reaped", async () => {
    const owner = await quiesceProjectPushes(PROJECT);
    await markProjectDeletionCleanupStarted(PROJECT, owner);
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db
      .update(projectDeletionLeases)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(projectDeletionLeases.projectId, PROJECT));

    await expect(reapExpiredProjectDeletionLease(PROJECT)).resolves.toBe(true);
    const [project] = await db
      .select({ lifecycle: projects.lifecycle })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(project.lifecycle).toBe("paused");
  });
});
