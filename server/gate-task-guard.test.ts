import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getProjectTasks } from "./db";
import { tasksRouter } from "./routers/tasks";
import { activityLogs, projects, projectTasks } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

/**
 * Gate task 封堵：gate 任务不能经普通任务接口（tasks.setCompleted）勾选完成，
 * 否则绕过 Gate 评审直接解锁下一阶段（评审记录、追溯快照、自动化全部缺失）。
 * 完成与撤销 gate 状态的唯一路径都是正式 Gate 流程，避免评审记录、阶段与
 * Gate task 三者分叉；Gate 也不能配置普通任务审批。
 */

const PROJECT = `gate-task-guard-${Date.now()}`;
const OWNER = 987001;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId, openId: `test-user-${userId}`, username: null, passwordHash: null,
      name: `TestUser${userId}`, email: null, loginMethod: null, role: "member",
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
  await db.insert(projects).values({
    id: PROJECT, name: "GateTaskGuard", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "concept", createdBy: OWNER,
  });
  await db.insert(projectTasks).values([
    { projectId: PROJECT, phaseId: "concept", taskId: "c1" },
    { projectId: PROJECT, phaseId: "concept", taskId: "c6" },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT)); // cascade 清 tasks
});

describe("gate task guard on tasks.setCompleted", () => {
  it("gate 任务不能直接勾选完成（npd concept 的 gate 是 c6）", async () => {
    const caller = tasksRouter.createCaller(makeCtx(OWNER));
    await expect(
      caller.setCompleted({ projectId: PROJECT, phaseId: "concept", taskId: "c6", completed: true })
    ).rejects.toThrow(/正式评审/);
    const task = (await getProjectTasks(PROJECT, "concept")).find((t) => t.taskId === "c6");
    expect(task?.completed ?? false).toBe(false);
  });

  it("普通任务勾选完成不受影响", async () => {
    const caller = tasksRouter.createCaller(makeCtx(OWNER));
    await caller.setCompleted({ projectId: PROJECT, phaseId: "concept", taskId: "c1", completed: true });
    const task = (await getProjectTasks(PROJECT, "concept")).find((t) => t.taskId === "c1");
    expect(task?.completed).toBe(true);
  });

  it("gate 任务不能从普通任务入口撤销完成", async () => {
    const db = await getDb();
    // 直接造一个已完成的 gate task 行（模拟历史上经评审完成的状态）
    await db!.update(projectTasks).set({
      status: "done", completed: true, completedAt: new Date(),
    }).where(and(eq(projectTasks.projectId, PROJECT), eq(projectTasks.taskId, "c6")));
    const caller = tasksRouter.createCaller(makeCtx(OWNER));
    await expect(caller.setCompleted({
      projectId: PROJECT,
      phaseId: "concept",
      taskId: "c6",
      completed: false,
    })).rejects.toThrow(/Gate/);
    const task = (await getProjectTasks(PROJECT, "concept")).find((t) => t.taskId === "c6");
    expect(task?.completed).toBe(true);
  });

  it("gate 任务不能配置普通任务审批", async () => {
    const caller = tasksRouter.createCaller(makeCtx(OWNER));
    await expect(caller.setApprovalConfig({
      projectId: PROJECT,
      phaseId: "concept",
      taskId: "c6",
      requiresApproval: true,
      approverUserId: OWNER,
    })).rejects.toThrow(/Gate/);
  });
});
