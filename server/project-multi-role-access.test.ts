import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projectMembers, projects } from "../drizzle/schema";
import { appRouter } from "./routers";
import { getDb, getProjectById } from "./db";
import {
  getEffectiveProjectRole,
  getEffectiveProjectRoles,
  getUnionPermissions,
} from "./project-access";
import type { TrpcContext } from "./_core/context";

const PROJECT = `multi-role-access-${Date.now()}`;
const OWNER = 996100;
const QA_SCM = 996101;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `multi-role-${userId}`,
      username: null,
      passwordHash: null,
      name: `MultiRole${userId}`,
      email: null,
      loginMethod: null,
      role: "user",
      canCreateProject: false,
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
  await db.insert(projects).values({
    id: PROJECT,
    name: "多角色权限并集",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values({
    projectId: PROJECT,
    userId: QA_SCM,
    role: "qa",
    extraRoles: ["scm", "qa", "owner"] as never,
    invitedBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("multi-role project access", () => {
  it("keeps the primary display role while unioning QA and SCM permissions", async () => {
    const project = await getProjectById(PROJECT);
    const roles = await getEffectiveProjectRoles(project!, QA_SCM);
    expect([...roles]).toEqual(["qa", "scm"]);
    await expect(getEffectiveProjectRole(project!, QA_SCM)).resolves.toBe("qa");

    const permissions = getUnionPermissions(roles);
    expect(permissions.canCloseIssues).toBe(true);
    expect(permissions.canEditChangelog).toBe(true);
    expect(permissions.canViewCommercials).toBe(true);
    expect(permissions.canManageMembers).toBe(false);
  });

  it("returns roles plus union permissions from the canonical members endpoint", async () => {
    const result = await appRouter.createCaller(makeCtx(QA_SCM)).members.myRole({ projectId: PROJECT });
    expect(result?.role).toBe("qa");
    expect(result?.roles).toEqual(["qa", "scm"]);
    expect(result?.permissions.canCloseIssues).toBe(true);
    expect(result?.permissions.canEditChangelog).toBe(true);
  });
});
