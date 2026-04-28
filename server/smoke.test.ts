/**
 * Clean-DB Smoke Test
 *
 * Simulates the full lifecycle on a real database:
 *   1. Verify all 12 tables exist (migration applied)
 *   2. Seed an admin user (upsertUser)
 *   3. Create a project (createProject)
 *   4. Seed phases & tasks (seedProjectPhasesAndTasks)
 *   5. Open project detail: load phases, tasks, issues, gate reviews, changelog
 *   6. Create one issue, one gate review, one change record
 *   7. Verify counts match expectations
 *   8. Clean up test data
 *
 * This test validates the entire DB layer end-to-end, from migration to
 * project detail retrieval, using the same functions the tRPC routers call.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb,
  upsertUser,
  getUserByOpenId,
  createProject,
  getProjectById,
  seedProjectPhasesAndTasks,
  getProjectPhases,
  getProjectTasks,
  getProjectIssues,
  createProjectIssue,
  getProjectGateReviews,
  createProjectGateReview,
  getProjectChangelog,
  createProjectChangeRecord,
  deleteProjectChangeRecord,
  deleteProjectGateReview,
  deleteProjectIssue,
  hardDeleteProjectForTest,
} from "./db";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEST_OPEN_ID = "smoke_test_admin_openid";
const TEST_PROJECT_ID = "smoke_test_proj_01";

async function getTableNames(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.execute(sql`SHOW TABLES`);
  // mysql2 returns rows as array of objects; key is "Tables_in_<dbname>"
  return (rows[0] as Record<string, string>[]).map(
    (r) => Object.values(r)[0] as string
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup & Cleanup
// ─────────────────────────────────────────────────────────────────────────────

/** Ensure a clean slate before running (handles leftover data from prior runs) */
beforeAll(async () => {
  try {
    await hardDeleteProjectForTest(TEST_PROJECT_ID);
  } catch {
    // nothing to clean up
  }
});

/** Hard-delete all test data after the suite completes */
afterAll(async () => {
  try {
    await hardDeleteProjectForTest(TEST_PROJECT_ID);
  } catch {
    // ignore cleanup errors
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────
describe("Clean-DB Smoke Test", () => {
  it("Step 1: all 12 tables exist (migration applied)", async () => {
    const tables = await getTableNames();
    const expected = [
      "organizations",
      "users",
      "projects",
      "project_members",
      "project_phases",
      "project_tasks",
      "project_issues",
      "project_gate_reviews",
      "project_changelog",
      "project_files",
      "activity_logs",
    ];
    for (const t of expected) {
      expect(tables, `Table "${t}" should exist`).toContain(t);
    }
  });

  it("Step 2: seed admin user (upsertUser)", async () => {
    await upsertUser({
      openId: TEST_OPEN_ID,
      name: "Smoke Test Admin",
      email: "smoke@test.local",
      role: "admin",
      loginMethod: "test",
    });
    const user = await getUserByOpenId(TEST_OPEN_ID);
    expect(user).toBeDefined();
    expect(user!.name).toBe("Smoke Test Admin");
    expect(user!.role).toBe("admin");
  });

  it("Step 3: create a project", async () => {
    const user = await getUserByOpenId(TEST_OPEN_ID);
    expect(user).toBeDefined();

    await createProject({
      id: TEST_PROJECT_ID,
      name: "Smoke Test Project",
      projectNumber: "SMOKE-001",
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      createdBy: user!.id,
    });

    const project = await getProjectById(TEST_PROJECT_ID);
    expect(project).toBeDefined();
    expect(project!.name).toBe("Smoke Test Project");
    expect(project!.category).toBe("npd");
    expect(project!.currentPhase).toBe("concept");
  });

  it("Step 4: seed phases & tasks (seedProjectPhasesAndTasks)", async () => {
    const user = await getUserByOpenId(TEST_OPEN_ID);
    expect(user).toBeDefined();
    await seedProjectPhasesAndTasks(TEST_PROJECT_ID, "npd", user!.id);

    const phases = await getProjectPhases(TEST_PROJECT_ID);
    expect(phases.length).toBeGreaterThan(0);

    const tasks = await getProjectTasks(TEST_PROJECT_ID);
    expect(tasks.length).toBeGreaterThan(0);

    // Every task should belong to our project
    for (const task of tasks) {
      expect(task.projectId).toBe(TEST_PROJECT_ID);
    }
  });

  it("Step 5: open project detail — load phases, tasks, issues, gate reviews, changelog", async () => {
    const [phases, tasks, issues, gateReviews, changelog] = await Promise.all([
      getProjectPhases(TEST_PROJECT_ID),
      getProjectTasks(TEST_PROJECT_ID),
      getProjectIssues(TEST_PROJECT_ID),
      getProjectGateReviews(TEST_PROJECT_ID),
      getProjectChangelog(TEST_PROJECT_ID),
    ]);

    expect(phases.length).toBeGreaterThan(0);
    expect(tasks.length).toBeGreaterThan(0);
    // Fresh project has no issues / gate reviews / changelog yet
    expect(issues).toHaveLength(0);
    expect(gateReviews).toHaveLength(0);
    expect(changelog).toHaveLength(0);
  });

  it("Step 6: create one issue, one gate review, one change record", async () => {
    const issueId = await createProjectIssue({
      projectId: TEST_PROJECT_ID,
      phaseId: "concept",
      title: "Smoke issue",
      description: "Auto-created by smoke test",
      severity: "P2",
      status: "open",
      category: "other",
      owner: "Tester",
      reporter: "Smoke Bot",
      foundDate: "2026-01-01",
      targetDate: "2026-02-01",
    });
    expect(issueId).toBeGreaterThan(0);

    const gateId = await createProjectGateReview({
      projectId: TEST_PROJECT_ID,
      phaseId: "concept",
      phaseName: "概念阶段",
      gateName: "立项评审",
      reviewDate: "2026-01-15",
      participants: "Alice, Bob",
      decision: "approved",
      conditions: "",
      notes: "Smoke test gate review",
    });
    expect(gateId).toBeGreaterThan(0);

    const changeId = await createProjectChangeRecord({
      projectId: TEST_PROJECT_ID,
      number: "ECR-S001",
      type: "decision",
      title: "Smoke decision",
      description: "Test change record",
      reason: "Smoke test",
      decisionMaker: "Smoke Admin",
      affectedPhases: JSON.stringify(["concept"]),
      status: "proposed",
      createdDate: "2026-01-01",
    });
    expect(changeId).toBeGreaterThan(0);

    // Verify counts
    const [issues, gateReviews, changelog] = await Promise.all([
      getProjectIssues(TEST_PROJECT_ID),
      getProjectGateReviews(TEST_PROJECT_ID),
      getProjectChangelog(TEST_PROJECT_ID),
    ]);
    expect(issues).toHaveLength(1);
    expect(gateReviews).toHaveLength(1);
    expect(changelog).toHaveLength(1);

    // Step 7: clean up sub-records (project deleted in afterAll)
    await deleteProjectIssue(issueId);
    await deleteProjectGateReview(gateId);
    await deleteProjectChangeRecord(changeId);
  });

  it("Step 7: verify sub-records cleaned up", async () => {
    const [issues, gateReviews, changelog] = await Promise.all([
      getProjectIssues(TEST_PROJECT_ID),
      getProjectGateReviews(TEST_PROJECT_ID),
      getProjectChangelog(TEST_PROJECT_ID),
    ]);
    expect(issues).toHaveLength(0);
    expect(gateReviews).toHaveLength(0);
    expect(changelog).toHaveLength(0);
  });
});
