import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import {
  mpReleases,
  projectIssues,
  projectPhases,
  projectTasks,
  projects,
} from "../drizzle/schema";
import {
  createProjectIssue,
  getDb,
  updateProject,
  upsertProjectTask,
} from "./db";

const PROJECT_ID = `release-barrier-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const BARRIER_TABLES = [
  "project_change_scope_declarations",
  "project_changelog",
  "project_deliverable_overrides",
  "project_deliverable_reviews",
  "project_gate_blockers",
  "project_gate_reviews",
  "project_gate_signoff_additions",
  "project_gate_signoff_rounds",
  "project_gate_signoffs",
  "project_issues",
  "project_members",
  "project_module_baselines",
  "project_npi_readiness_checks",
  "project_phases",
  "project_sample_signoffs",
  "project_tailoring",
  "project_tasks",
  "project_test_cases",
  "project_test_plans",
  "project_test_reports",
] as const;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT_ID,
    name: "Release state barrier test",
    projectNumber: PROJECT_ID,
    category: "npd",
    currentPhase: "concept",
    createdBy: 990076,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(mpReleases).where(eq(mpReleases.projectId, PROJECT_ID));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJECT_ID));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT_ID));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, PROJECT_ID));
  await db.delete(projects).where(eq(projects.id, PROJECT_ID));
});

describe("project-scoped release state barrier", () => {
  it("installs row triggers on release-visible child tables only", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query<{ table_name: string }>(`
        select table_class.relname as table_name
        from pg_trigger trigger
        join pg_class table_class on table_class.oid = trigger.tgrelid
        join pg_namespace namespace on namespace.oid = table_class.relnamespace
        where trigger.tgname = 'project_release_state_barrier'
          and not trigger.tgisinternal
          and namespace.nspname = current_schema()
        order by table_class.relname
      `);

      expect(result.rows.map((row) => row.table_name)).toEqual(BARRIER_TABLES);
      expect(result.rows.map((row) => row.table_name)).not.toEqual(expect.arrayContaining([
        "projects",
        "project_files",
        "bom_items",
        "project_product_module_bindings",
      ]));
    } finally {
      await client.end();
    }
  });

  it("blocks a direct child-table write while release owns the project barrier, then allows it", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    const writer = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    await writer.connect();
    let barrierHeld = false;

    try {
      await blocker.query("select pg_advisory_lock(hashtext($1))", [`release-state:${PROJECT_ID}`]);
      barrierHeld = true;
      await writer.query("begin");
      await writer.query("set local lock_timeout = '150ms'");

      let lockError: unknown;
      try {
        await writer.query(
          `insert into project_phases ("projectId", "phaseId") values ($1, $2)`,
          [PROJECT_ID, "blocked-phase"],
        );
      } catch (error) {
        lockError = error;
      }
      expect(lockError).toMatchObject({ code: "55P03" });
      await writer.query("rollback");

      await blocker.query("select pg_advisory_unlock(hashtext($1))", [`release-state:${PROJECT_ID}`]);
      barrierHeld = false;
      await writer.query(
        `insert into project_phases ("projectId", "phaseId") values ($1, $2)`,
        [PROJECT_ID, "blocked-phase"],
      );

      const inserted = await writer.query<{ phase_id: string }>(
        `select "phaseId" as phase_id from project_phases where "projectId" = $1`,
        [PROJECT_ID],
      );
      expect(inserted.rows).toEqual([{ phase_id: "blocked-phase" }]);
    } finally {
      await writer.query("rollback").catch(() => undefined);
      if (barrierHeld) {
        await blocker.query("select pg_advisory_unlock(hashtext($1))", [`release-state:${PROJECT_ID}`]);
      }
      await writer.end();
      await blocker.end();
    }
  });

  it("takes the release barrier before issue/task writer DML", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let barrierHeld = false;

    try {
      await blocker.query("select pg_advisory_lock(hashtext($1))", [`release-state:${PROJECT_ID}`]);
      barrierHeld = true;
      let issueSettled = false;
      let taskSettled = false;
      const issueWrite = createProjectIssue({
        projectId: PROJECT_ID,
        phaseId: "concept",
        title: "Barrier issue",
        severity: "P2",
        status: "open",
        category: "other",
        reporter: "Barrier test",
        creatorId: 990076,
      }).finally(() => { issueSettled = true; });
      const taskWrite = upsertProjectTask(PROJECT_ID, "concept", "barrier-task", {
        status: "todo",
        updatedBy: 990076,
      }).finally(() => { taskSettled = true; });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(issueSettled).toBe(false);
      expect(taskSettled).toBe(false);
      const issuesBeforeUnlock = await blocker.query<{ count: string }>(
        `select count(*)::text as count from project_issues where "projectId" = $1`,
        [PROJECT_ID],
      );
      const tasksBeforeUnlock = await blocker.query<{ count: string }>(
        `select count(*)::text as count from project_tasks where "projectId" = $1 and "taskId" = 'barrier-task'`,
        [PROJECT_ID],
      );
      expect(issuesBeforeUnlock.rows[0]?.count).toBe("0");
      expect(tasksBeforeUnlock.rows[0]?.count).toBe("0");

      await blocker.query("select pg_advisory_unlock(hashtext($1))", [`release-state:${PROJECT_ID}`]);
      barrierHeld = false;
      await Promise.all([issueWrite, taskWrite]);
    } finally {
      if (barrierHeld) {
        await blocker.query("select pg_advisory_unlock(hashtext($1))", [`release-state:${PROJECT_ID}`]);
      }
      await blocker.end();
    }
  });

  it("re-reads release state after waiting and rejects a stale controlled project update", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let barrierHeld = false;

    try {
      await blocker.query("select pg_advisory_lock(hashtext($1))", [`release-state:${PROJECT_ID}`]);
      barrierHeld = true;
      let updateSettled = false;
      const staleUpdate = updateProject(PROJECT_ID, {
        productId: "mutated-product",
        currentPhase: "design",
      }).finally(() => { updateSettled = true; });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(updateSettled).toBe(false);
      await blocker.query(
        `insert into mp_releases ("productId", "projectId", "releasedBy") values ($1, $2, $3)`,
        ["released-product", PROJECT_ID, 990076],
      );
      await blocker.query("select pg_advisory_unlock(hashtext($1))", [`release-state:${PROJECT_ID}`]);
      barrierHeld = false;

      await expect(staleUpdate).rejects.toThrow("项目已发布");
      const db = await getDb();
      if (!db) throw new Error("no db");
      const [project] = await db.select({
        productId: projects.productId,
        currentPhase: projects.currentPhase,
      }).from(projects).where(eq(projects.id, PROJECT_ID)).limit(1);
      expect(project).toEqual({ productId: null, currentPhase: "concept" });
    } finally {
      if (barrierHeld) {
        await blocker.query("select pg_advisory_unlock(hashtext($1))", [`release-state:${PROJECT_ID}`]);
      }
      await blocker.end();
    }
  });
});
