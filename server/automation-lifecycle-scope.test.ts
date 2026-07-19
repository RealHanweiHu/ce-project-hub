import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  actionItems,
  projectDeliverableReviews,
  projectIssues,
  projectMembers,
  projectTasks,
  projects,
} from "../drizzle/schema";
import {
  canReceiveProjectNotification,
  getAutomationActiveProjects,
  getAutomationCriticalIssues,
  getAutomationPendingDeliverableReviews,
  getBlockedTasks,
  getDb,
  getPersonalDailyDigestItems,
  getPortfolioHealthForDigest,
  getProjectMember,
  getProjectTasks,
  getUnassignedActiveTasks,
  listActionItemsForSla,
  removeProjectMember,
} from "./db";

const SUFFIX = Date.now().toString().slice(-8);
const ACTIVE = `auto-scope-a-${SUFFIX}`;
const PAUSED = `auto-scope-p-${SUFFIX}`;
const OWNER = 992001;
const REMOVED = 992002;

async function cleanupProject(projectId: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(actionItems).where(eq(actionItems.projectId, projectId));
  await db.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, projectId));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, projectId));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, projectId));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await cleanupProject(ACTIVE);
  await cleanupProject(PAUSED);
  await db.insert(projects).values([
    { id: ACTIVE, name: "Active automation scope", projectNumber: ACTIVE, category: "npd", currentPhase: "concept", risk: "low", createdBy: OWNER },
    { id: PAUSED, name: "Paused automation scope", projectNumber: PAUSED, category: "npd", currentPhase: "concept", risk: "low", createdBy: OWNER, lifecycle: "paused" },
  ]);
  await db.insert(projectTasks).values([
    { projectId: ACTIVE, phaseId: "concept", taskId: "active-block", status: "blocked", assigneeUserId: OWNER },
    { projectId: PAUSED, phaseId: "concept", taskId: "paused-block", status: "blocked", assigneeUserId: OWNER },
    { projectId: ACTIVE, phaseId: "concept", taskId: "active-unassigned", status: "todo" },
    { projectId: ACTIVE, phaseId: "design", taskId: "future-phase", status: "todo" },
    { projectId: ACTIVE, phaseId: "concept", taskId: "future-date", status: "todo", startDate: "2099-01-01" },
    { projectId: PAUSED, phaseId: "concept", taskId: "paused-unassigned", status: "todo" },
  ]);
  await db.insert(projectIssues).values([
    { projectId: ACTIVE, phaseId: "concept", title: "active P0", severity: "P0", status: "open", category: "other", creatorId: OWNER },
    { projectId: PAUSED, phaseId: "concept", title: "paused P0", severity: "P0", status: "open", category: "other", creatorId: OWNER },
  ]);
  await db.insert(projectDeliverableReviews).values([
    { projectId: ACTIVE, phaseId: "concept", deliverableName: "active review", reviewerUserId: OWNER, submittedBy: OWNER },
    { projectId: PAUSED, phaseId: "concept", deliverableName: "paused review", reviewerUserId: OWNER, submittedBy: OWNER },
  ]);
  await db.insert(actionItems).values([
    { kind: "critical_issue", projectId: ACTIVE, entityType: "issue", entityId: "1", dedupeKey: `${ACTIVE}:sla`, recipientUserId: OWNER, title: "active action", actionUrl: "/" },
    { kind: "critical_issue", projectId: PAUSED, entityType: "issue", entityId: "2", dedupeKey: `${PAUSED}:sla`, recipientUserId: OWNER, title: "paused action", actionUrl: "/" },
  ]);
});

afterAll(async () => {
  await cleanupProject(ACTIVE);
  await cleanupProject(PAUSED);
});

describe("automation lifecycle scope", () => {
  it("excludes paused projects from every automation aggregate", async () => {
    const [all, blocked, unassigned, critical, reviews, sla, health, digest] = await Promise.all([
      getAutomationActiveProjects(),
      getBlockedTasks([ACTIVE, PAUSED]),
      getUnassignedActiveTasks([ACTIVE, PAUSED]),
      getAutomationCriticalIssues(),
      getAutomationPendingDeliverableReviews(),
      listActionItemsForSla(),
      getPortfolioHealthForDigest("2026-07-10"),
      getPersonalDailyDigestItems({ todayISO: "2026-07-10", dueSoonDays: 14 }),
    ]);
    expect(all.some((row) => row.id === PAUSED)).toBe(false);
    expect(blocked.some((row) => row.projectId === PAUSED)).toBe(false);
    expect(unassigned.filter((row) => row.projectId === ACTIVE).map((row) => row.taskId)).toEqual(["active-unassigned"]);
    expect(unassigned.some((row) => row.projectId === PAUSED)).toBe(false);
    expect(critical.some((row) => row.projectId === PAUSED)).toBe(false);
    expect(reviews.some((row) => row.projectId === PAUSED)).toBe(false);
    expect(sla.some((row) => row.projectId === PAUSED)).toBe(false);
    expect(health.some((row) => row.id === PAUSED)).toBe(false);
    expect(digest.some((row) => row.projectId === PAUSED)).toBe(false);
  });
});

describe("member removal privacy", () => {
  it("clears responsibilities and closes pending notifications atomically", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db.insert(projectMembers).values({ projectId: ACTIVE, userId: REMOVED, role: "rd_hw", invitedBy: OWNER });
    await db.insert(projectTasks).values({
      projectId: ACTIVE, phaseId: "concept", taskId: "removed-owner",
      assigneeUserId: REMOVED, approverUserId: REMOVED, requiresApproval: true,
      approvalStatus: "pending", status: "pending_approval",
    });
    await db.insert(projectDeliverableReviews).values({
      projectId: ACTIVE, phaseId: "concept", deliverableName: "removed review",
      reviewerUserId: REMOVED, submittedBy: OWNER,
    });
    await db.insert(actionItems).values({
      kind: "critical_issue", projectId: ACTIVE, entityType: "issue", entityId: "removed",
      dedupeKey: `${ACTIVE}:removed`, recipientUserId: REMOVED, title: "secret title", actionUrl: "/",
    });

    await removeProjectMember(ACTIVE, REMOVED);

    expect(await getProjectMember(ACTIVE, REMOVED)).toBeUndefined();
    const task = (await getProjectTasks(ACTIVE, "concept")).find((row) => row.taskId === "removed-owner");
    expect(task).toMatchObject({ assigneeUserId: null, approverUserId: null, requiresApproval: false, status: "todo" });
    const [review] = await db.select().from(projectDeliverableReviews).where(eq(projectDeliverableReviews.deliverableName, "removed review"));
    expect(review.reviewerUserId).toBe(OWNER);
    const [action] = await db.select().from(actionItems).where(eq(actionItems.dedupeKey, `${ACTIVE}:removed`));
    expect(action.status).toBe("closed");
    expect(await canReceiveProjectNotification(ACTIVE, REMOVED)).toBe(false);
  });
});
