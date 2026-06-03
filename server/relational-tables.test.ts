/**
 * Integration tests for the relational tables refactor.
 * Tests that db.ts helper functions work correctly with the new schema.
 *
 * NOTE: These tests call the DB helpers directly (not via HTTP) to avoid
 * needing a running server or auth session.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createProject,
  getProjectById,
  updateProject,
  deleteProject,
  seedProjectPhasesAndTasks,
  getProjectTasks,
  upsertProjectTask,
  getProjectIssues,
  createProjectIssue,
  updateProjectIssue,
  deleteProjectIssue,
  getProjectGateReviews,
  createProjectGateReview,
  getProjectChangelog,
  createProjectChangeRecord,
  getProjectPhases,
  upsertProjectPhase,
} from "./db";

const TEST_PROJECT_ID = `test-relational-${Date.now()}`;
const TEST_USER_ID = 999999;

beforeAll(async () => {
  // Create a test project
  await createProject({
    id: TEST_PROJECT_ID,
    name: "Test Relational Project",
    projectNumber: "TEST-001",
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
  // Clean up test project (cascades to all related tables)
  await deleteProject(TEST_PROJECT_ID);
});

describe("projects", () => {
  it("can create and retrieve a project", async () => {
    const project = await getProjectById(TEST_PROJECT_ID);
    expect(project).toBeDefined();
    expect(project!.name).toBe("Test Relational Project");
    expect(project!.category).toBe("npd");
    expect(project!.pmUserId).toBeNull();
  });

  it("can update a project", async () => {
    await updateProject(TEST_PROJECT_ID, { name: "Updated Name", risk: "high" });
    const updated = await getProjectById(TEST_PROJECT_ID);
    expect(updated!.name).toBe("Updated Name");
    expect(updated!.risk).toBe("high");
    // Restore
    await updateProject(TEST_PROJECT_ID, { name: "Test Relational Project", risk: "low" });
  });
});

describe("seedProjectPhasesAndTasks", () => {
  it("seeds NPD phases and tasks without error", async () => {
    await expect(
      seedProjectPhasesAndTasks(TEST_PROJECT_ID, "npd", TEST_USER_ID)
    ).resolves.not.toThrow();

    const tasks = await getProjectTasks(TEST_PROJECT_ID);
    expect(tasks.length).toBeGreaterThan(0);
    // All tasks should be uncompleted by default
    expect(tasks.every((t) => !t.completed)).toBe(true);
  });
});

describe("project_tasks", () => {
  it("can upsert task completion", async () => {
    const tasks = await getProjectTasks(TEST_PROJECT_ID);
    expect(tasks.length).toBeGreaterThan(0);

    const firstTask = tasks[0];
    await upsertProjectTask(TEST_PROJECT_ID, firstTask.phaseId, firstTask.taskId, {
      completed: true,
      updatedBy: TEST_USER_ID,
    });

    const updated = await getProjectTasks(TEST_PROJECT_ID, firstTask.phaseId);
    const found = updated.find((t) => t.taskId === firstTask.taskId);
    expect(found?.completed).toBe(true);
  });

  it("can upsert task instructions", async () => {
    const tasks = await getProjectTasks(TEST_PROJECT_ID);
    const firstTask = tasks[0];

    await upsertProjectTask(TEST_PROJECT_ID, firstTask.phaseId, firstTask.taskId, {
      instructions: "Test instructions",
      updatedBy: TEST_USER_ID,
    });

    const updated = await getProjectTasks(TEST_PROJECT_ID, firstTask.phaseId);
    const found = updated.find((t) => t.taskId === firstTask.taskId);
    expect(found?.instructions).toBe("Test instructions");
  });

  it("can upsert task visibleRoles", async () => {
    const tasks = await getProjectTasks(TEST_PROJECT_ID);
    const firstTask = tasks[0];

    await upsertProjectTask(TEST_PROJECT_ID, firstTask.phaseId, firstTask.taskId, {
      visibleRoles: ["pm", "rd_hw"],
      updatedBy: TEST_USER_ID,
    });

    const updated = await getProjectTasks(TEST_PROJECT_ID, firstTask.phaseId);
    const found = updated.find((t) => t.taskId === firstTask.taskId);
    expect(found?.visibleRoles).toEqual(["pm", "rd_hw"]);
  });
});

describe("project_issues", () => {
  let issueId: number;

  it("can create an issue", async () => {
    issueId = await createProjectIssue({
      projectId: TEST_PROJECT_ID,
      phaseId: "concept",
      title: "Test Issue",
      description: "A test issue",
      severity: "P2",
      status: "open",
      category: "hardware",
      owner: "Test Owner",
      reporter: "Test Reporter",
      foundDate: "2026-01-01",
      targetDate: "2026-02-01",
      closedDate: null,
      rootCause: null,
      solution: null,
      relatedTaskId: null,
      creatorId: TEST_USER_ID,
    });
    expect(issueId).toBeGreaterThan(0);
  });

  it("can list issues for a project", async () => {
    const issues = await getProjectIssues(TEST_PROJECT_ID);
    expect(issues.length).toBeGreaterThan(0);
    const found = issues.find((i) => i.id === issueId);
    expect(found?.title).toBe("Test Issue");
    expect(found?.severity).toBe("P2");
  });

  it("can update an issue", async () => {
    await updateProjectIssue(issueId, { status: "closed", solution: "Fixed it" });
    const issues = await getProjectIssues(TEST_PROJECT_ID);
    const found = issues.find((i) => i.id === issueId);
    expect(found?.status).toBe("closed");
    expect(found?.solution).toBe("Fixed it");
  });

  it("can delete an issue", async () => {
    await deleteProjectIssue(issueId);
    const issues = await getProjectIssues(TEST_PROJECT_ID);
    expect(issues.find((i) => i.id === issueId)).toBeUndefined();
  });
});

describe("project_gate_reviews", () => {
  let reviewId: number;

  it("can create a gate review", async () => {
    reviewId = await createProjectGateReview({
      projectId: TEST_PROJECT_ID,
      phaseId: "concept",
      phaseName: "Concept",
      gateName: "Gate 1",
      reviewDate: "2026-01-15",
      participants: "PM, RD",
      decision: "approved",
      conditions: null,
      notes: "All good",
      roundNumber: 1,
      createdBy: TEST_USER_ID,
    });
    expect(reviewId).toBeGreaterThan(0);
  });

  it("can list gate reviews for a project", async () => {
    const reviews = await getProjectGateReviews(TEST_PROJECT_ID);
    expect(reviews.length).toBeGreaterThan(0);
    const found = reviews.find((r) => r.id === reviewId);
    expect(found?.decision).toBe("approved");
    expect(found?.gateName).toBe("Gate 1");
  });
});

describe("project_changelog", () => {
  let recordId: number;

  it("can create a changelog record", async () => {
    recordId = await createProjectChangeRecord({
      projectId: TEST_PROJECT_ID,
      number: "ECR-001",
      type: "decision",
      title: "Test Decision",
      description: "A key decision",
      reason: "Cost reduction",
      decisionMaker: "CEO",
      affectedPhases: ["concept", "design"],
      status: "approved",
      costImpact: "-10%",
      scheduleImpact: "0",
      notes: null,
      createdDate: "2026-01-10",
      implementedDate: null,
      creatorId: TEST_USER_ID,
    });
    expect(recordId).toBeGreaterThan(0);
  });

  it("can list changelog records for a project", async () => {
    const records = await getProjectChangelog(TEST_PROJECT_ID);
    expect(records.length).toBeGreaterThan(0);
    const found = records.find((r) => r.id === recordId);
    expect(found?.title).toBe("Test Decision");
    expect(found?.type).toBe("decision");
    expect(found?.affectedPhases).toEqual(["concept", "design"]);
  });
});

describe("project_phases", () => {
  it("can upsert phase dates and notes", async () => {
    await upsertProjectPhase(TEST_PROJECT_ID, "concept", {
      startDate: "2026-01-01",
      endDate: "2026-02-28",
      notes: "Concept phase notes",
    });

    const phases = await getProjectPhases(TEST_PROJECT_ID);
    const found = phases.find((p) => p.phaseId === "concept");
    expect(found?.startDate).toBe("2026-01-01");
    expect(found?.endDate).toBe("2026-02-28");
    expect(found?.notes).toBe("Concept phase notes");
  });
});
