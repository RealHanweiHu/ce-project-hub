import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projectMembers, projects, users } from "../drizzle/schema";
import { appRouter } from "./routers";
import { ensureProjectMember, getDb, getProjectMember } from "./db";
import type { TrpcContext } from "./_core/context";

const PROJECT = `member-multi-${Date.now()}`;
const OWNER = 996200;
const MEMBER = 996201;

function ctx(userId: number): TrpcContext {
  return {
    user: {
      id: userId, openId: `member-multi-${userId}`, username: null, passwordHash: null,
      name: `Member${userId}`, email: null, loginMethod: null, role: "member",
      canCreateProject: false, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(users).values([
    { id: OWNER, openId: `member-multi-${OWNER}`, name: "Owner", role: "member" },
    { id: MEMBER, openId: `member-multi-${MEMBER}`, name: "Member", role: "member" },
  ]).onConflictDoNothing();
  await db.insert(projects).values({
    id: PROJECT, name: "成员多岗", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "concept", createdBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(users).where(eq(users.id, MEMBER));
  await db.delete(users).where(eq(users.id, OWNER));
});

describe("project member multi-role persistence", () => {
  it("appends repeated staffing roles and persists a creator's working role", async () => {
    await expect(ensureProjectMember(PROJECT, MEMBER, "qa", OWNER)).resolves.toBe(true);
    await expect(ensureProjectMember(PROJECT, MEMBER, "scm", OWNER)).resolves.toBe(false);
    expect(await getProjectMember(PROJECT, MEMBER)).toMatchObject({ role: "qa", extraRoles: ["scm"] });

    await expect(ensureProjectMember(PROJECT, OWNER, "rd_sw", OWNER)).resolves.toBe(true);
    expect(await getProjectMember(PROJECT, OWNER)).toMatchObject({ role: "rd_sw", extraRoles: [] });
  });

  it("inviting an existing member appends roles without replacing the primary role", async () => {
    const caller = appRouter.createCaller(ctx(OWNER));
    await caller.members.invite({ projectId: PROJECT, userId: MEMBER, role: "cert", extraRoles: ["battery_safety"] });
    expect(await getProjectMember(PROJECT, MEMBER)).toMatchObject({
      role: "qa",
      extraRoles: ["scm", "cert", "battery_safety"],
    });
  });

  it("explicit editing controls primary and normalized extra roles separately", async () => {
    const caller = appRouter.createCaller(ctx(OWNER));
    await caller.members.updateRole({
      projectId: PROJECT,
      userId: MEMBER,
      role: "scm",
      extraRoles: ["qa", "scm", "owner"],
      jobTitle: "兼职供应链",
    });
    expect(await getProjectMember(PROJECT, MEMBER)).toMatchObject({
      role: "scm",
      extraRoles: ["qa"],
      jobTitle: "兼职供应链",
    });
  });
});
