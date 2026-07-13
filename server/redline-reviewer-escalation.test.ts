import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  projectMembers,
  projectRoleDelegations,
  projectRoleFallbackReviewers,
  projects,
  users,
} from "../drizzle/schema";
import { addDays, todayShanghai } from "../shared/shanghai-date";
import { getDb } from "./db";
import { findRedlineReviewerEscalation } from "./redline-four-eyes-service";

const PROJECT = `redline-escalation-${Date.now()}`;
const SUBMITTER = 996500;
const MANAGER = 996501;
const DELEGATE = 996502;
const FALLBACK = 996503;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(users).values([SUBMITTER, MANAGER, DELEGATE, FALLBACK].map((id) => ({
    id, openId: `redline-escalation-${id}`, name: `User${id}`, role: "member" as const,
  }))).onConflictDoNothing();
  await db.insert(projects).values({
    id: PROJECT, name: "红线升级", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "concept", createdBy: SUBMITTER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: MANAGER, role: "manager", invitedBy: SUBMITTER },
    { projectId: PROJECT, userId: DELEGATE, role: "qa", invitedBy: SUBMITTER },
  ]);
  const today = todayShanghai();
  await db.insert(projectRoleDelegations).values({
    projectId: PROJECT, role: "cert", fromUserId: null, toUserId: DELEGATE,
    startDate: addDays(today, -1), endDate: addDays(today, 1), reason: "认证代理", createdBy: SUBMITTER,
  });
  await db.insert(projectRoleFallbackReviewers).values({ role: "cert", userId: FALLBACK, createdBy: SUBMITTER });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectRoleDelegations).where(eq(projectRoleDelegations.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(projectRoleFallbackReviewers).where(eq(projectRoleFallbackReviewers.userId, FALLBACK));
  for (const id of [SUBMITTER, MANAGER, DELEGATE, FALLBACK]) await db.delete(users).where(eq(users.id, id));
});

describe("redline reviewer escalation", () => {
  it("uses management, then active delegation, then the system fallback", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expect(findRedlineReviewerEscalation({ projectId: PROJECT, role: "cert", submitterUserId: SUBMITTER }))
      .resolves.toMatchObject({ userId: MANAGER, actedAsRole: "cert", source: "management" });

    await db.delete(projectMembers).where(eq(projectMembers.userId, MANAGER));
    await expect(findRedlineReviewerEscalation({ projectId: PROJECT, role: "cert", submitterUserId: SUBMITTER }))
      .resolves.toMatchObject({ userId: DELEGATE, actedAsRole: "cert", source: "delegation" });

    await db.update(projectRoleDelegations).set({ active: false }).where(eq(projectRoleDelegations.projectId, PROJECT));
    await expect(findRedlineReviewerEscalation({ projectId: PROJECT, role: "cert", submitterUserId: SUBMITTER }))
      .resolves.toMatchObject({ userId: FALLBACK, actedAsRole: "cert", source: "fallback" });
  });
});
