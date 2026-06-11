/**
 * Tests for unique constraints and indexes added in migration 0003.
 *
 * Verifies:
 * - project_phases: UNIQUE(projectId, phaseId)
 * - project_tasks:  UNIQUE(projectId, phaseId, taskId)
 * - project_issues, project_gate_reviews, project_changelog: indexes exist in DB
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  createProject,
  deleteProject,
  upsertProjectPhase,
  upsertProjectTask,
  createProjectIssue,
  createProjectGateReview,
  createProjectChangeRecord,
  getDb,
} from "./db";
import {
  projectPhases,
  projectTasks,
} from "../drizzle/schema";

const TEST_PROJECT_ID = `test-constraints-${Date.now()}`;
const TEST_USER_ID = 999998;

let conn: Client;

/** Look up an index definition in pg_indexes; returns [] if it doesn't exist */
async function getIndexDefs(table: string, indexName: string): Promise<string[]> {
  const res = await conn.query(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2",
    [table, indexName]
  );
  return res.rows.map((r: { indexdef: string }) => r.indexdef);
}

beforeAll(async () => {
  // Create raw pg connection for index catalog queries
  conn = new Client({ connectionString: process.env.DATABASE_URL });
  await conn.connect();

  await createProject({
    id: TEST_PROJECT_ID,
    name: "Constraint Test Project",
    projectNumber: "CONST-001",
    category: "npd",
    pmUserId: null,
    risk: "low",
    currentPhase: "concept",
    progress: 0,
    startDate: null,
    targetDate: null,
    createdBy: TEST_USER_ID,
    archived: false,
    orgId: null,
  });
});

afterAll(async () => {
  await deleteProject(TEST_PROJECT_ID);
  await conn.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// project_phases: UNIQUE(projectId, phaseId)
// ─────────────────────────────────────────────────────────────────────────────

describe("project_phases unique constraint", () => {
  it("unique index uniq_project_phase exists in DB", async () => {
    const defs = await getIndexDefs("project_phases", "uniq_project_phase");
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0]).toContain("UNIQUE");
  });

  it("allows inserting a phase row via upsertProjectPhase", async () => {
    await expect(
      upsertProjectPhase(TEST_PROJECT_ID, "concept", {})
    ).resolves.not.toThrow();
  });

  it("allows upserting the same phase (idempotent)", async () => {
    await expect(
      upsertProjectPhase(TEST_PROJECT_ID, "concept", { notes: "updated" })
    ).resolves.not.toThrow();
  });

  it("rejects a raw duplicate INSERT into project_phases", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");

    // First insert
    try {
      await db.insert(projectPhases).values({
        projectId: TEST_PROJECT_ID,
        phaseId: "dup-phase-test",
      });
    } catch (_) {
      // May already exist from a prior run
    }

    // Second insert of same (projectId, phaseId) must violate UNIQUE constraint
    await expect(
      db.insert(projectPhases).values({
        projectId: TEST_PROJECT_ID,
        phaseId: "dup-phase-test",
      })
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// project_tasks: UNIQUE(projectId, phaseId, taskId)
// ─────────────────────────────────────────────────────────────────────────────

describe("project_tasks unique constraint", () => {
  it("unique index uniq_project_phase_task exists in DB", async () => {
    const defs = await getIndexDefs("project_tasks", "uniq_project_phase_task");
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0]).toContain("UNIQUE");
  });

  it("allows inserting a task row via upsertProjectTask", async () => {
    await expect(
      upsertProjectTask(TEST_PROJECT_ID, "concept", "c1", {
        completed: false,
        updatedBy: TEST_USER_ID,
      })
    ).resolves.not.toThrow();
  });

  it("allows upserting the same task (idempotent)", async () => {
    await expect(
      upsertProjectTask(TEST_PROJECT_ID, "concept", "c1", {
        completed: true,
        updatedBy: TEST_USER_ID,
      })
    ).resolves.not.toThrow();
  });

  it("rejects a raw duplicate INSERT into project_tasks", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");

    try {
      await db.insert(projectTasks).values({
        projectId: TEST_PROJECT_ID,
        phaseId: "concept",
        taskId: "dup-task-test",
        completed: false,
      });
    } catch (_) {}

    await expect(
      db.insert(projectTasks).values({
        projectId: TEST_PROJECT_ID,
        phaseId: "concept",
        taskId: "dup-task-test",
        completed: false,
      })
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// project_issues: INDEX(projectId, phaseId, status, severity)
// ─────────────────────────────────────────────────────────────────────────────

describe("project_issues index", () => {
  it("index idx_issues_project_phase_status_severity exists in DB", async () => {
    const defs = await getIndexDefs("project_issues", "idx_issues_project_phase_status_severity");
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0]).not.toContain("UNIQUE"); // non-unique index
  });

  it("can create and query issues using the indexed columns", async () => {
    const issueId = await createProjectIssue({
      projectId: TEST_PROJECT_ID,
      phaseId: "concept",
      title: "Index test issue",
      severity: "P1",
      status: "open",
      category: "other",
      creatorId: TEST_USER_ID,
    });
    expect(issueId).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// project_gate_reviews: INDEX(projectId, phaseId)
// ─────────────────────────────────────────────────────────────────────────────

describe("project_gate_reviews index", () => {
  it("index idx_gate_reviews_project_phase exists in DB", async () => {
    const defs = await getIndexDefs("project_gate_reviews", "idx_gate_reviews_project_phase");
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0]).not.toContain("UNIQUE");
  });

  it("can create a gate review using the indexed columns", async () => {
    const reviewId = await createProjectGateReview({
      projectId: TEST_PROJECT_ID,
      phaseId: "concept",
      phaseName: "立项评审",
      gateName: "G1",
      reviewDate: "2026-01-01",
      decision: "approved",
      roundNumber: 1,
      createdBy: TEST_USER_ID,
    });
    expect(reviewId).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// project_changelog: INDEX(projectId, type, status)
// ─────────────────────────────────────────────────────────────────────────────

describe("project_changelog index", () => {
  it("index idx_changelog_project_type_status exists in DB", async () => {
    const defs = await getIndexDefs("project_changelog", "idx_changelog_project_type_status");
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0]).not.toContain("UNIQUE");
  });

  it("can create a change record using the indexed columns", async () => {
    const recordId = await createProjectChangeRecord({
      projectId: TEST_PROJECT_ID,
      number: "ECR-001",
      type: "eco",
      title: "Index test change",
      status: "proposed",
      creatorId: TEST_USER_ID,
    });
    expect(recordId).toBeGreaterThan(0);
  });
});
