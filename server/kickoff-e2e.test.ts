/**
 * 立项向导端到端：按 UI 真实调用顺序「projects.create → projects.kickoff」，
 * 验证任务负责人按向导分工派发、排期生成。覆盖创建时已填/未填开始日两种路径。
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb, getProjectTasks } from "./db";
import { appRouter } from "./routers";
import { activityLogs, projectMembers, projectPhases, projectTasks, projects, users } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const PROJ_A = `kickoff-e2e-a-${Date.now()}`; // 创建时已填开始日(向导跳过第1步,提交同日期)
const PROJ_B = `kickoff-e2e-b-${Date.now()}`; // 创建时未填开始日(向导第1步设日期)
const CREATOR = 983001;
const PM_USER = 983002;

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
      role: "admin",
      canCreateProject: true,
      mobile: null,
      dingtalkUserId: null,
      dingtalkCorpUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const ids = [PROJ_A, PROJ_B];
  await db.delete(activityLogs).where(inArray(activityLogs.projectId, ids));
  await db.delete(projectTasks).where(inArray(projectTasks.projectId, ids));
  await db.delete(projectPhases).where(inArray(projectPhases.projectId, ids));
  await db.delete(projectMembers).where(inArray(projectMembers.projectId, ids));
  await db.delete(projects).where(inArray(projects.id, ids));
  await db.delete(users).where(inArray(users.openId, [`test-user-${CREATOR}`, `test-user-${PM_USER}`]));
});

describe("立项向导端到端(create → kickoff)", () => {
  it("创建时已填开始日:kickoff 提交同日期,任务仍应有负责人和排期", async () => {
    const caller = appRouter.createCaller(makeCtx(CREATOR));
    await caller.projects.create({
      id: PROJ_A, name: "E2E-A", projectNumber: PROJ_A, category: "npd",
      risk: "low", currentPhase: "concept", progress: 0,
      startDate: "2026-07-07", targetDate: null, pmUserId: null,
    });
    // 向导:已有开始日 → 跳过第1步,提交时 startDate 与 project.startDate 相同
    const r = await caller.projects.kickoff({
      projectId: PROJ_A,
      startDate: "2026-07-07",
      staffing: [{ role: "pm", userId: PM_USER }],
      notify: false,
    });
    expect(r.success).toBe(true);

    const tasks = await getProjectTasks(PROJ_A);
    const c1 = tasks.find((t) => t.taskId === "c1");
    expect(c1?.assigneeUserId).toBe(PM_USER); // visibleRoles 首位 pm → 派给产品经理
    expect(c1?.dueDate).toBeTruthy();          // 创建时已生成排期
  });

  it("创建时未填开始日:kickoff 设开始日,生成排期并派任务(含创建者兼任)", async () => {
    const caller = appRouter.createCaller(makeCtx(CREATOR));
    await caller.projects.create({
      id: PROJ_B, name: "E2E-B", projectNumber: PROJ_B, category: "npd",
      risk: "low", currentPhase: "concept", progress: 0,
      startDate: null, targetDate: null, pmUserId: null,
    });
    const r = await caller.projects.kickoff({
      projectId: PROJ_B,
      startDate: "2026-07-07",
      staffing: [
        { role: "pm", userId: CREATOR },          // 创建者兼任产品经理
        { role: "rd_hw", userId: PM_USER },
      ],
      notify: false,
    });
    expect(r.success).toBe(true);

    const tasks = await getProjectTasks(PROJ_B);
    const c1 = tasks.find((t) => t.taskId === "c1");
    const d3 = tasks.find((t) => t.taskId === "d3"); // 电子原理图 → rd_hw
    expect(c1?.assigneeUserId).toBe(CREATOR);  // 创建者兼任也要派到
    expect(d3?.assigneeUserId).toBe(PM_USER);
    expect(c1?.dueDate).toBeTruthy();           // kickoff 设开始日 → 生成排期
    expect(d3?.dueDate).toBeTruthy();
  });

  it("从未排期的项目:日期未变重跑向导也应自愈补排", async () => {
    const db = await getDb();
    // 模拟历史项目:有开始日但任务从未排期
    await db!.update(projectTasks)
      .set({ startDate: null, dueDate: null })
      .where(eq(projectTasks.projectId, PROJ_A));

    const caller = appRouter.createCaller(makeCtx(CREATOR));
    await caller.projects.kickoff({
      projectId: PROJ_A,
      startDate: "2026-07-07", // 与 project.startDate 相同
      staffing: [],
      notify: false,
    });
    const tasks = await getProjectTasks(PROJ_A);
    expect(tasks.find((t) => t.taskId === "c1")?.dueDate).toBeTruthy();
  });
});
