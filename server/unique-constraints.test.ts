/**
 * Tests for unique constraints and indexes added in migration 0003.
 *
 * Verifies:
 * - project_phases: UNIQUE(projectId, phaseId)
 * - project_tasks:  UNIQUE(projectId, phaseId, taskId)
 * - project_issues, project_gate_reviews, project_changelog: indexes exist in DB
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
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

let conn: mysql.Connection;

beforeAll(async () => {
  // Create raw mysql connection for SHOW INDEX queries
  const url = new URL(process.env.DATABASE_URL!);
  conn = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port || "3306"),
    user: url.username,
    password: url.password,
    database: url.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
  });

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
    const [rows] = await conn.execute(
      "SHOW INDEX FROM `project_phases` WHERE Key_name = 'uniq_project_phase'"
    ) as [any[], any];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].Non_unique).toBe(0); // 0 = unique
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
    const [rows] = await conn.execute(
      "SHOW INDEX FROM `project_tasks` WHERE Key_name = 'uniq_project_phase_task'"
    ) as [any[], any];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].Non_unique).toBe(0);
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
    const [rows] = await conn.execute(
      "SHOW INDEX FROM `project_issues` WHERE Key_name = 'idx_issues_project_phase_status_severity'"
    ) as [any[], any];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].Non_unique).toBe(1); // non-unique index
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
    const [rows] = await conn.execute(
      "SHOW INDEX FROM `project_gate_reviews` WHERE Key_name = 'idx_gate_reviews_project_phase'"
    ) as [any[], any];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].Non_unique).toBe(1);
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
    const [rows] = await conn.execute(
      "SHOW INDEX FROM `project_changelog` WHERE Key_name = 'idx_changelog_project_type_status'"
    ) as [any[], any];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].Non_unique).toBe(1);
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
