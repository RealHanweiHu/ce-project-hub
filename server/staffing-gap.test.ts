import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projectMembers, projectTasks, projects } from "../drizzle/schema";
import {
  addProjectMember,
  assignTasksByRole,
  getDb,
  getProjectTasks,
  listProjectStaffingGaps,
  transferProjectStaffingGap,
  upsertProjectTask,
} from "./db";

const PROJECT = `staffing-gap-${Date.now()}`;
const OWNER = 996400;
const PM = 996401;
const CERT = 996402;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT, name: "空岗承接", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "concept", createdBy: OWNER, pmUserId: PM,
  });
  await addProjectMember({ projectId: PROJECT, userId: PM, role: "project_manager", invitedBy: OWNER });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("staffing gap continuity", () => {
  it("temporarily assigns a vacant role to PM and records the original role", async () => {
    await upsertProjectTask(PROJECT, "dvt", "cert-gap", { visibleRoles: ["cert"] });
    await assignTasksByRole(PROJECT, OWNER);
    const task = (await getProjectTasks(PROJECT)).find((row) => row.taskId === "cert-gap");
    expect(task).toMatchObject({ assigneeUserId: PM, staffingGapRole: "cert" });
    expect(await listProjectStaffingGaps(PROJECT)).toEqual([
      { role: "cert", taskCount: 1, candidateUserId: null },
    ]);
  });

  it("offers the new role holder and transfers only unfinished acting tasks", async () => {
    await addProjectMember({ projectId: PROJECT, userId: CERT, role: "cert", invitedBy: OWNER });
    expect(await listProjectStaffingGaps(PROJECT)).toEqual([
      { role: "cert", taskCount: 1, candidateUserId: CERT },
    ]);
    await expect(transferProjectStaffingGap(PROJECT, "cert", CERT, OWNER)).resolves.toBe(1);
    const task = (await getProjectTasks(PROJECT)).find((row) => row.taskId === "cert-gap");
    expect(task).toMatchObject({ assigneeUserId: CERT, staffingGapRole: null });
    expect(await listProjectStaffingGaps(PROJECT)).toEqual([]);
  });
});
