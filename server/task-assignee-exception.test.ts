import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { activityLogs, projectMembers, projectTasks, projects } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

/**
 * P0：qa/scm/sales/cert/battery_safety 没有 canEditTasks，但 SOP 会把测试/采购等任务
 * 自动派给他们（assignTasksByRole）。被派人必须能完成自己的任务、勾自己的交付物，
 * 否则这五个角色的工作流死锁（只能请 PM 代点）。
 */
const PROJECT = `assignee-exc-${Date.now()}`;
const OWNER = 983001;
const QA_ASSIGNEE = 983002;      // qa：被指派 → 可完成
const SCM_VISIBLE = 983003;      // scm：未指派但任务对 scm 可见 → 可完成
const SALES_UNRELATED = 983004;  // sales：未指派且不可见 → 仍禁止
const VIEWER_ASSIGNED = 983005;  // viewer：即使被指派也保持只读
const QA_SAME_ROLE = 983006;     // qa：同岗位但不是负责人 → 不可代操作

function makeCtx(userId: number): TrpcContext {
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
    name: "指派例外测试",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "evt",
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: QA_ASSIGNEE, role: "qa", invitedBy: OWNER },
    { projectId: PROJECT, userId: SCM_VISIBLE, role: "scm", invitedBy: OWNER },
    { projectId: PROJECT, userId: SALES_UNRELATED, role: "sales", invitedBy: OWNER },
    { projectId: PROJECT, userId: VIEWER_ASSIGNED, role: "viewer", invitedBy: OWNER },
    { projectId: PROJECT, userId: QA_SAME_ROLE, role: "qa", invitedBy: OWNER },
  ]);
  await db.insert(projectTasks).values([
    {
      projectId: PROJECT, phaseId: "evt", taskId: "e2",
      completed: false, assigneeUserId: QA_ASSIGNEE,
      visibleRoles: ["qa", "rd_hw", "pm", "manager", "owner"],
      deliverables: { "功能测试报告 (FT)": false },
    },
    {
      projectId: PROJECT, phaseId: "evt", taskId: "e3",
      completed: false, assigneeUserId: null,
      visibleRoles: ["scm", "pm", "manager", "owner"],
    },
    {
      projectId: PROJECT, phaseId: "evt", taskId: "e4",
      completed: false, assigneeUserId: VIEWER_ASSIGNED,
      visibleRoles: [],
    },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

async function taskRow(taskId: string) {
  const db = await getDb();
  const [row] = await db!.select().from(projectTasks).where(and(
    eq(projectTasks.projectId, PROJECT),
    eq(projectTasks.phaseId, "evt"),
    eq(projectTasks.taskId, taskId),
  ));
  return row;
}

describe("被指派人任务完成例外（qa/scm 等无 canEditTasks 角色）", () => {
  it("qa 被指派人可以完成自己的任务", async () => {
    const caller = appRouter.createCaller(makeCtx(QA_ASSIGNEE));
    await caller.tasks.setCompleted({ projectId: PROJECT, phaseId: "evt", taskId: "e2", completed: true });
    expect((await taskRow("e2")).completed).toBe(true);
    // 还原，后续用例复用
    await caller.tasks.setCompleted({ projectId: PROJECT, phaseId: "evt", taskId: "e2", completed: false });
  });

  it("qa 被指派人可以勾选自己任务的交付物", async () => {
    const caller = appRouter.createCaller(makeCtx(QA_ASSIGNEE));
    await caller.tasks.setDeliverable({
      projectId: PROJECT, phaseId: "evt", taskId: "e2",
      name: "功能测试报告 (FT)", done: true,
    });
    expect((await taskRow("e2")).deliverables?.["功能测试报告 (FT)"]).toBe(true);
  });

  it("scm 未被指派但任务对 scm 角色可见，同样可以完成", async () => {
    const caller = appRouter.createCaller(makeCtx(SCM_VISIBLE));
    await caller.tasks.setCompleted({ projectId: PROJECT, phaseId: "evt", taskId: "e3", completed: true });
    expect((await taskRow("e3")).completed).toBe(true);
  });

  it("sales 与任务无关（未指派、角色不可见）仍被拒绝", async () => {
    const caller = appRouter.createCaller(makeCtx(SALES_UNRELATED));
    await expect(
      caller.tasks.setCompleted({ projectId: PROJECT, phaseId: "evt", taskId: "e2", completed: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("任务已有负责人时，同岗位其他人和管理者都不能代替本人点开始", async () => {
    const caller = appRouter.createCaller(makeCtx(QA_SAME_ROLE));
    await expect(
      caller.tasks.setCompleted({ projectId: PROJECT, phaseId: "evt", taskId: "e2", completed: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.tasks.start({ projectId: PROJECT, phaseId: "evt", taskId: "e2" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      appRouter.createCaller(makeCtx(OWNER)).tasks.start({
        projectId: PROJECT,
        phaseId: "evt",
        taskId: "e2",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("viewer 即使被指派也保持只读", async () => {
    const caller = appRouter.createCaller(makeCtx(VIEWER_ASSIGNED));
    await expect(
      caller.tasks.setCompleted({ projectId: PROJECT, phaseId: "evt", taskId: "e4", completed: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
