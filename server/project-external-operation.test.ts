import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import {
  projectDeletionLeases,
  projectExternalOperations,
  projects,
} from "../drizzle/schema";
import { getDb, setProjectLifecycle } from "./db";
import {
  hasActiveProjectExternalOperations,
  hasUncertainProjectExternalOperations,
  ProjectExternalOperationLeaseLostError,
  quarantineCurrentProjectExternalOperation,
  releaseProjectExternalOperation,
  renewProjectExternalOperation,
  reserveProjectExternalOperation,
  startProjectExternalOperationHeartbeat,
  waitForProjectExternalOperations,
  withProjectExternalOperation,
} from "./project-external-operation";
import {
  quiesceProjectPushes,
  renewProjectDeletionLease,
  restoreProjectPushes,
} from "./project-delete-quiesce";
import { fetchWithTimeout } from "./_core/fetchWithTimeout";

const PROJECT = `external-op-${Date.now().toString().slice(-8)}`;
const USER = 986711;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "外部操作删除屏障",
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
  await db
    .delete(projectExternalOperations)
    .where(eq(projectExternalOperations.projectId, PROJECT));
  await db
    .delete(projectDeletionLeases)
    .where(eq(projectDeletionLeases.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

beforeEach(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db
    .delete(projectExternalOperations)
    .where(eq(projectExternalOperations.projectId, PROJECT));
  await db
    .delete(projectDeletionLeases)
    .where(eq(projectDeletionLeases.projectId, PROJECT));
  await db
    .update(projects)
    .set({ lifecycle: "active", archived: false })
    .where(eq(projects.id, PROJECT));
});

describe("project external-operation barrier", () => {
  it("makes pre-delete work visible and refuses every reservation after delete owns the lease", async () => {
    const operation = await reserveProjectExternalOperation(
      [PROJECT],
      "test_send"
    );
    expect(await hasActiveProjectExternalOperations(PROJECT)).toBe(true);

    const deletion = await quiesceProjectPushes(PROJECT);
    await expect(
      reserveProjectExternalOperation([PROJECT], "late_send")
    ).rejects.toThrow(/正在删除|已停止/);
    await expect(
      setProjectLifecycle({
        projectId: PROJECT,
        lifecycle: "active",
        actor: { id: USER, role: "admin" },
      })
    ).rejects.toThrow(/正在删除/);
    expect(
      await waitForProjectExternalOperations(PROJECT, { timeoutMs: 0 })
    ).toBe(false);

    await releaseProjectExternalOperation(operation.token);
    expect(
      await waitForProjectExternalOperations(PROJECT, { timeoutMs: 100 })
    ).toBe(true);
    await restoreProjectPushes(PROJECT, deletion);

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db
      .select({ lifecycle: projects.lifecycle })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(project.lifecycle).toBe("active");
  });

  it("automatically renews a long-running wrapped operation and releases it afterward", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    let initialExpiry = 0;

    await withProjectExternalOperation(
      [PROJECT],
      "slow_send",
      async () => {
        const [initial] = await db
          .select({ expiresAt: projectExternalOperations.expiresAt })
          .from(projectExternalOperations)
          .where(eq(projectExternalOperations.projectId, PROJECT));
        initialExpiry = initial.expiresAt.getTime();

        await vi.waitFor(
          async () => {
            const [renewed] = await db
              .select({ expiresAt: projectExternalOperations.expiresAt })
              .from(projectExternalOperations)
              .where(eq(projectExternalOperations.projectId, PROJECT));
            expect(renewed.expiresAt.getTime()).toBeGreaterThan(initialExpiry);
          },
          { timeout: 2_000, interval: 10 }
        );
      },
      { intervalMs: 5, ttlMs: 30 * 60 * 1000 }
    );

    expect(await hasActiveProjectExternalOperations(PROJECT)).toBe(false);
  });

  it("stops a manual heartbeat and rejects renewal by a stale token", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const reservation = await reserveProjectExternalOperation(
      [PROJECT],
      "manual_send"
    );
    const [initial] = await db
      .select({ expiresAt: projectExternalOperations.expiresAt })
      .from(projectExternalOperations)
      .where(eq(projectExternalOperations.projectId, PROJECT));
    const heartbeat = startProjectExternalOperationHeartbeat(reservation, {
      intervalMs: 5,
      ttlMs: 30 * 60 * 1000,
    });

    await vi.waitFor(
      async () => {
        const [renewed] = await db
          .select({ expiresAt: projectExternalOperations.expiresAt })
          .from(projectExternalOperations)
          .where(eq(projectExternalOperations.projectId, PROJECT));
        expect(renewed.expiresAt.getTime()).toBeGreaterThan(
          initial.expiresAt.getTime()
        );
      },
      { timeout: 2_000, interval: 10 }
    );
    await heartbeat.stop();
    heartbeat.assertHealthy();
    const [renewed] = await db
      .select({ expiresAt: projectExternalOperations.expiresAt })
      .from(projectExternalOperations)
      .where(eq(projectExternalOperations.projectId, PROJECT));
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(
      initial.expiresAt.getTime()
    );

    await expect(
      renewProjectExternalOperation({
        ...reservation,
        token: "stale-token",
      })
    ).rejects.toBeInstanceOf(ProjectExternalOperationLeaseLostError);

    const stoppedExpiry = renewed.expiresAt.getTime();
    await new Promise(resolve => setTimeout(resolve, 20));
    const [stillStopped] = await db
      .select({ expiresAt: projectExternalOperations.expiresAt })
      .from(projectExternalOperations)
      .where(
        and(
          eq(projectExternalOperations.projectId, PROJECT),
          eq(projectExternalOperations.token, reservation.token)
        )
      );
    expect(stillStopped.expiresAt.getTime()).toBe(stoppedExpiry);
    await releaseProjectExternalOperation(reservation.token);
  });

  it("releases a wrapped reservation when the remote operation fails", async () => {
    await expect(
      withProjectExternalOperation(
        [PROJECT],
        "failed_send",
        async () => {
          throw new Error("remote failed");
        },
        { intervalMs: 5 }
      )
    ).rejects.toThrow("remote failed");
    expect(await hasActiveProjectExternalOperations(PROJECT)).toBe(false);
  });

  it("fences at the HTTP boundary so a resumed stale worker never reaches the remote API", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const remoteFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(
      withProjectExternalOperation([PROJECT], "stale_remote_send", async () => {
        await db
          .delete(projectExternalOperations)
          .where(eq(projectExternalOperations.projectId, PROJECT));
        return fetchWithTimeout("https://example.invalid/dingtalk", {}, 50);
      })
    ).rejects.toBeInstanceOf(ProjectExternalOperationLeaseLostError);

    expect(remoteFetch).not.toHaveBeenCalled();
    remoteFetch.mockRestore();
    expect(await hasActiveProjectExternalOperations(PROJECT)).toBe(false);
  });

  it("retains an ambiguous remote POST as a bounded delete-visible quarantine", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");

    await withProjectExternalOperation(
      [PROJECT],
      "ambiguous_group_send",
      async () => {
        await quarantineCurrentProjectExternalOperation("response lost", {
          quarantineMs: 60_000,
        });
      }
    );

    expect(await hasUncertainProjectExternalOperations(PROJECT)).toBe(true);
    await expect(
      reserveProjectExternalOperation([PROJECT], "automatic_retry")
    ).rejects.toThrow(/结果待确认|隔离期/);

    await db
      .update(projectExternalOperations)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(projectExternalOperations.projectId, PROJECT));
    const resumed = await reserveProjectExternalOperation(
      [PROJECT],
      "after_quarantine"
    );
    await releaseProjectExternalOperation(resumed.token);
    expect(await hasActiveProjectExternalOperations(PROJECT)).toBe(false);
  });

  it("releases the reservation if heartbeat startup rejects invalid options", async () => {
    await expect(
      withProjectExternalOperation(
        [PROJECT],
        "invalid_heartbeat",
        async () => undefined,
        { intervalMs: 0 }
      )
    ).rejects.toBeInstanceOf(RangeError);
    expect(await hasActiveProjectExternalOperations(PROJECT)).toBe(false);
  });

  it("automatically reaps an expired delete owner before accepting new work", async () => {
    const owner = await quiesceProjectPushes(PROJECT);
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db
      .update(projectDeletionLeases)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(projectDeletionLeases.projectId, PROJECT));

    const reservation = await reserveProjectExternalOperation(
      [PROJECT],
      "after_crashed_delete"
    );
    const [project] = await db
      .select({ lifecycle: projects.lifecycle })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(project.lifecycle).toBe("active");
    await expect(renewProjectDeletionLease(PROJECT, owner)).rejects.toThrow(
      /租约已失效/
    );
    await releaseProjectExternalOperation(reservation.token);
  });
});
