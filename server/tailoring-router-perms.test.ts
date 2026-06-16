/**
 * 裁剪路由权限测试（DB-backed，通过 createCaller）
 *
 * 覆盖：
 * 6. 非 admin、非 PM 用户 propose → FORBIDDEN
 * 7. PM（project.pmUserId === user.id）propose → 成功
 * 8. 非 admin 用户 review → FORBIDDEN
 * 9. admin 用户 review → 成功
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import {
  projects,
  projectPhases,
  projectTasks,
  projectTailoring,
  projectMembers,
  projectDeliverableOverrides,
} from "../drizzle/schema";
import { eq } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

// ─── 共享测试数据 ─────────────────────────────────────────────────────────────
const PROJ = `trperm-${Date.now()}`;
// 虚构用户 ID（测试隔离，不依赖 users 表 FK）
const PM_USER_ID = 710001;
const NON_PM_USER_ID = 710002;
const ADMIN_USER_ID = 710003;

/** 构造一个最小合法 TrpcContext（不含真实 req/res，供 createCaller 使用）。 */
function makeCtx(userId: number, role: "user" | "admin"): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-user-${userId}`,
      username: null,
      passwordHash: null,
      name: `TestUser${userId}`,
      email: null,
      loginMethod: null,
      role,
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

  // 创建项目，createdBy 为 ADMIN_USER_ID，pmUserId 为 PM_USER_ID
  await db.insert(projects).values({
    id: PROJ,
    name: "路由权限测试",
    projectNumber: `TRPERM-${Date.now()}`,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: ADMIN_USER_ID,
    pmUserId: PM_USER_ID,
  });

  // 插入 concept 阶段 + 任务，让 propose 时能通过任务校验
  await db.insert(projectPhases).values({ projectId: PROJ, phaseId: "concept" });
  const conceptTaskIds = ["c1", "c2", "c3", "c4", "c5", "c6"];
  for (const taskId of conceptTaskIds) {
    await db.insert(projectTasks).values({
      projectId: PROJ,
      phaseId: "concept",
      taskId,
      completed: false,
      updatedBy: ADMIN_USER_ID,
    });
  }

  // 将 PM_USER_ID 加入 project_members（role='pm'），使其通过 assertCanView
  // assertCanView 调用 getUserProjectRole：
  //   - project.createdBy === userId → "owner"
  //   - getProjectMember(projectId, userId)?.role → 返回成员角色
  // PM_USER_ID 是 pmUserId 但 assertCanView 不检查 pmUserId，
  // 所以需要在 project_members 中有记录才能通过 canView 检查。
  await db.insert(projectMembers).values({
    projectId: PROJ,
    userId: PM_USER_ID,
    role: "pm",
    invitedBy: ADMIN_USER_ID,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  // 清理顺序：子表 → 主表
  await db.delete(projectDeliverableOverrides).where(eq(projectDeliverableOverrides.projectId, PROJ));
  await db.delete(projectTailoring).where(eq(projectTailoring.projectId, PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, PROJ));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

// ─── 测试 6：非 admin、非 PM propose → FORBIDDEN ───────────────────────────
describe("6. 非 admin、非 PM 用户 propose → FORBIDDEN", () => {
  it("普通用户（非项目成员/PM）调用 propose 应抛 FORBIDDEN", async () => {
    const caller = appRouter.createCaller(makeCtx(NON_PM_USER_ID, "user"));
    await expect(
      caller.tailoring.propose({
        projectId: PROJ,
        reasonType: "customer_id",
        targets: [{ scope: "phase", phaseId: "concept" }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── 测试 7：PM propose → 成功 ────────────────────────────────────────────
// proposedId 在 describe 作用域内共享，供后续 review 测试使用
let proposedId: number;

describe("7. PM 用户 propose → 成功", () => {
  it("pmUserId 对应的项目成员（role=pm）调用 propose 应成功", async () => {
    const caller = appRouter.createCaller(makeCtx(PM_USER_ID, "user"));
    const result = await caller.tailoring.propose({
      projectId: PROJ,
      reasonType: "customer_id",
      reasonNote: "PM 提出裁剪",
      targets: [{ scope: "phase", phaseId: "concept" }],
    });
    expect(result.success).toBe(true);
    expect(result.id).toBeGreaterThan(0);
    proposedId = result.id;
  });
});

// ─── 测试 8：非 admin review → FORBIDDEN ────────────────────────────────────
describe("8. 非 admin review → FORBIDDEN", () => {
  it("普通用户调用 review 应抛 FORBIDDEN（利用测试 7 创建的裁剪申请）", async () => {
    // 确保 proposedId 已由 test 7 设定
    if (!proposedId) {
      throw new Error("proposedId 未设置，测试 7 可能失败");
    }
    const caller = appRouter.createCaller(makeCtx(PM_USER_ID, "user"));
    await expect(
      caller.tailoring.review({ id: proposedId, decision: "approved" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── 测试 9：admin review → 成功 ────────────────────────────────────────────
describe("9. admin review → 成功", () => {
  it("admin 用户调用 review 应成功", async () => {
    if (!proposedId) {
      throw new Error("proposedId 未设置，测试 7 可能失败");
    }
    const caller = appRouter.createCaller(makeCtx(ADMIN_USER_ID, "admin"));
    const result = await caller.tailoring.review({
      id: proposedId,
      decision: "approved",
      reviewNote: "管理员批准",
    });
    expect(result.success).toBe(true);
  });
});
