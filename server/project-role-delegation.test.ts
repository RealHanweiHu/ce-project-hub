import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projectMembers, projectRoleDelegations, projects, users } from "../drizzle/schema";
import { addDays, todayShanghai } from "../shared/shanghai-date";
import { appRouter } from "./routers";
import { getDb, getProjectById } from "./db";
import { getEffectiveProjectRoles, resolveProjectActedAsRole } from "./project-access";
import type { TrpcContext } from "./_core/context";

const PROJECT = `delegation-${Date.now()}`;
const OWNER = 996300;
const FROM = 996301;
const TO = 996302;

function ctx(id: number): TrpcContext {
  return {
    user: {
      id, openId: `delegation-${id}`, username: null, passwordHash: null, name: `User${id}`,
      email: null, loginMethod: null, role: "member", canCreateProject: false, mobile: null,
      dingtalkUserId: null, dingtalkCorpUserId: null, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(users).values([OWNER, FROM, TO].map((id) => ({
    id, openId: `delegation-${id}`, name: `User${id}`, role: "member" as const,
  }))).onConflictDoNothing();
  await db.insert(projects).values({
    id: PROJECT, name: "代理测试", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "concept", createdBy: OWNER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: FROM, role: "qa", invitedBy: OWNER },
    { projectId: PROJECT, userId: TO, role: "scm", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectRoleDelegations).where(eq(projectRoleDelegations.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  for (const id of [OWNER, FROM, TO]) await db.delete(users).where(eq(users.id, id));
});

describe("date-bound project role delegation", () => {
  it("is effective on both boundary dates and rejects an overlapping duplicate", async () => {
    const today = todayShanghai();
    const caller = appRouter.createCaller(ctx(OWNER));
    const row = await caller.delegations.create({
      projectId: PROJECT, role: "qa", fromUserId: FROM, toUserId: TO,
      startDate: today, endDate: addDays(today, 1), reason: "QA 休假代理",
    });
    const project = await getProjectById(PROJECT);
    expect(await getEffectiveProjectRoles(project!, TO)).toEqual(new Set(["scm", "qa"]));
    await expect(resolveProjectActedAsRole({
      project: project!, userId: TO, requestedRole: "qa", eligible: () => true,
    })).resolves.toMatchObject({ role: "qa", viaDelegationId: row.id });
    await expect(caller.delegations.create({
      projectId: PROJECT, role: "qa", fromUserId: FROM, toUserId: TO,
      startDate: today, endDate: today, reason: "重复代理",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await caller.delegations.revoke({ projectId: PROJECT, id: row.id });
    expect(await getEffectiveProjectRoles(project!, TO)).toEqual(new Set(["scm"]));
  });

  it("allows a vacant-role delegation and ignores future dates", async () => {
    const today = todayShanghai();
    const caller = appRouter.createCaller(ctx(OWNER));
    await caller.delegations.create({
      projectId: PROJECT, role: "cert", fromUserId: null, toUserId: TO,
      startDate: addDays(today, 1), endDate: addDays(today, 2), reason: "认证岗位待补",
    });
    const project = await getProjectById(PROJECT);
    expect((await getEffectiveProjectRoles(project!, TO)).has("cert")).toBe(false);
  });
});
