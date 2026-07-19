import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { Client } from "pg";
import {
  projectDeletionLeases,
  projectExternalOperations,
  projects,
} from "../drizzle/schema";
import { deleteProject, getDb } from "./db";
import {
  ProjectDeletionLeaseLostError,
  quiesceProjectPushes,
  restoreProjectPushes,
} from "./project-delete-quiesce";

const PROJECT_IDS: string[] = [];
const USER = 986702;

function nextProjectId(label: string): string {
  const id = `${label}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  PROJECT_IDS.push(id);
  return id;
}

async function seedProject(projectId: string) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: projectId,
    name: projectId,
    projectNumber: projectId,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "active",
  });
}

async function waitForAdvisoryLockWaiter(client: Client) {
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
    if (Number(result.rows[0]?.waiting ?? 0) >= 1) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Expected the fenced project delete to wait on its advisory lock");
}

afterEach(async () => {
  const db = await getDb();
  if (!db || PROJECT_IDS.length === 0) return;
  await db
    .delete(projectDeletionLeases)
    .where(inArray(projectDeletionLeases.projectId, PROJECT_IDS));
  await db.delete(projects).where(inArray(projects.id, PROJECT_IDS));
  PROJECT_IDS.length = 0;
});

describe("atomic project deletion lease fencing", () => {
  it("holds the project barrier from token validation through the real project delete", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const projectId = nextProjectId("delete-fence");
    await seedProject(projectId);
    const owner = await quiesceProjectPushes(projectId);
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let lockHeld = false;
    let deletion: ReturnType<typeof deleteProject> | undefined;

    try {
      await blocker.query("select pg_advisory_lock(hashtext($1))", [
        `project-external:${projectId}`,
      ]);
      lockHeld = true;

      deletion = deleteProject(projectId, { deletionLeaseToken: owner.token });
      await waitForAdvisoryLockWaiter(blocker);

      const db = await getDb();
      if (!db) throw new Error("no db");
      const [projectWhileBlocked] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId));
      expect(projectWhileBlocked?.id).toBe(projectId);
    } finally {
      if (lockHeld) {
        await blocker.query("select pg_advisory_unlock(hashtext($1))", [
          `project-external:${projectId}`,
        ]);
      }
      await blocker.end();
    }

    await expect(deletion).resolves.toEqual({ storageKeys: [] });
    const db = await getDb();
    if (!db) throw new Error("no db");
    const [deletedProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(deletedProject).toBeUndefined();
  });

  it("rejects a stale token without deleting the project", async () => {
    const projectId = nextProjectId("delete-stale");
    await seedProject(projectId);
    const owner = await quiesceProjectPushes(projectId);

    await expect(
      deleteProject(projectId, { deletionLeaseToken: "stale-owner" })
    ).rejects.toBeInstanceOf(ProjectDeletionLeaseLostError);

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(project?.id).toBe(projectId);
    await restoreProjectPushes(projectId, owner);
  });

  it("rechecks active remote intents inside the final fenced delete transaction", async () => {
    const projectId = nextProjectId("del-remote");
    await seedProject(projectId);
    const owner = await quiesceProjectPushes(projectId);
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db.insert(projectExternalOperations).values({
      projectId,
      token: randomUUID(),
      kind: "uncertain:work_notice",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      deleteProject(projectId, { deletionLeaseToken: owner.token })
    ).rejects.toThrow(/钉钉发送正在处理/);

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(project?.id).toBe(projectId);
    await db
      .delete(projectExternalOperations)
      .where(eq(projectExternalOperations.projectId, projectId));
    await restoreProjectPushes(projectId, owner);
  });
});
