import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getProjectById } from "./db";
import { appRouter } from "./routers";
import { getEffectiveProjectRole } from "./project-access";
import {
  activityLogs,
  projectGateReviews,
  projectMembers,
  projects,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const MANAGER_PROJECT = `role-rank-m-${Date.now()}`;
const VIEWER_PROJECT = `role-rank-v-${Date.now()}`;
const OWNER = 980001;
const MANAGER_PM = 980002;
const VIEWER_PM = 980003;

function makeCtx(userId: number, canCreateProject = false): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-user-${userId}`,
      username: null,
      passwordHash: null,
      name: `TestUser${userId}`,
      email: null,
      loginMethod: null,
      role: "user",
      canCreateProject,
      mobile: null,
      dingtalkUserId: null,
      dingtalkCorpUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");

  await db.insert(projects).values([
    {
      id: MANAGER_PROJECT,
      name: "角色不降权测试",
      projectNumber: MANAGER_PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "design",
      createdBy: OWNER,
      pmUserId: MANAGER_PM,
    },
    {
      id: VIEWER_PROJECT,
      name: "PM 兜底测试",
      projectNumber: VIEWER_PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "design",
      createdBy: OWNER,
      pmUserId: VIEWER_PM,
    },
  ]);

  await db.insert(projectMembers).values([
    { projectId: MANAGER_PROJECT, userId: MANAGER_PM, role: "manager", invitedBy: OWNER },
    { projectId: VIEWER_PROJECT, userId: VIEWER_PM, role: "viewer", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;

  for (const projectId of [MANAGER_PROJECT, VIEWER_PROJECT]) {
    await db.delete(activityLogs).where(eq(activityLogs.projectId, projectId));
    await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, projectId));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
});

describe("project access role resolution", () => {
  it("pmUserId 不会把已有 manager 降成 pm", async () => {
    const project = await getProjectById(MANAGER_PROJECT);
    expect(project).not.toBeNull();

    await expect(getEffectiveProjectRole(project!, MANAGER_PM)).resolves.toBe("manager");
  });

  it("pmUserId 只在成员角色更低时补成 pm", async () => {
    const project = await getProjectById(VIEWER_PROJECT);
    expect(project).not.toBeNull();

    await expect(getEffectiveProjectRole(project!, VIEWER_PM)).resolves.toBe("pm");
  });

  it("同时是 pmUserId 的 manager 仍可创建 Gate 评审", async () => {
    const caller = appRouter.createCaller(makeCtx(MANAGER_PM));

    await expect(
      caller.gateReviews.create({
        projectId: MANAGER_PROJECT,
        phaseId: "design",
        phaseName: "Design",
        gateName: "Design Gate",
        reviewDate: "2026-06-18",
        decision: "approved",
      }),
    ).resolves.toMatchObject({ success: true });
  });
});

describe("project create validation", () => {
  it("创建项目时拒绝非法开始日期,避免坏日期落库后重排 500", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER, true));

    await expect(caller.projects.create({
      id: `bad-date-${Date.now()}`,
      name: "bad date",
      projectNumber: "BAD-DATE",
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      startDate: "2026-13-99",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
