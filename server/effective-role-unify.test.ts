import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getProjectById } from "./db";
import { appRouter } from "./routers";
import { getEffectiveProjectRole } from "./project-access";
import { projects, projectMembers, users } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

/**
 * P1-10：三处 effective-role 解析必须一致。
 * - pmUserId 用 rank 取高：qa 兼 PM → pm（原 members.ts 只在 viewer/null 时升）。
 * - 系统 admin 即使被显式加为低角色成员，也不得被降到该低角色之下（至少 manager）。
 */
const PROJECT = `role-unify-${Date.now()}`;
const OWNER = 985001;
const QA_PM = 985002;   // 既是 qa 成员，又是项目 pmUserId
const ADMIN_VIEWER = 985003; // 全局 admin，但被加为 viewer 成员

function makeCtx(userId: number, role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id: userId, openId: `u${userId}`, username: null, passwordHash: null,
      name: `U${userId}`, email: null, loginMethod: null, role,
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
  await db.insert(users).values({
    id: ADMIN_VIEWER, openId: `u${ADMIN_VIEWER}`, name: "AdminViewer", role: "admin",
  }).onConflictDoNothing();
  await db.insert(projects).values({
    id: PROJECT, name: "角色统一", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "design", createdBy: OWNER, pmUserId: QA_PM,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: QA_PM, role: "qa", invitedBy: OWNER },
    { projectId: PROJECT, userId: ADMIN_VIEWER, role: "viewer", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(users).where(eq(users.id, ADMIN_VIEWER));
});

describe("effective-role 三处一致", () => {
  it("qa 兼 pmUserId → 解析为 pm（rank 取高）", async () => {
    const project = await getProjectById(PROJECT);
    await expect(getEffectiveProjectRole(project!, QA_PM)).resolves.toBe("pm");
  });

  it("members.myRole 对 qa 兼 pmUserId 也返回 pm（第三处解析一致）", async () => {
    const caller = appRouter.createCaller(makeCtx(QA_PM));
    const res = await caller.members.myRole({ projectId: PROJECT });
    expect(res.role).toBe("pm");
  });

  it("admin 即使是 viewer 成员，也至少为 manager（不被降级）", async () => {
    const project = await getProjectById(PROJECT);
    await expect(getEffectiveProjectRole(project!, ADMIN_VIEWER)).resolves.toBe("manager");
  });

  it("admin-viewer 可完成任务（getEffectiveRole 路径不再卡在 viewer）", async () => {
    const caller = appRouter.createCaller(makeCtx(ADMIN_VIEWER, "admin"));
    // 不抛 FORBIDDEN 即证明其有效角色 ≥ 可编辑任务
    await expect(
      caller.tasks.setCompleted({ projectId: PROJECT, phaseId: "design", taskId: "d1", completed: false })
    ).resolves.toBeTruthy();
  });
});
