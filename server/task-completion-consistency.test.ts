/**
 * 任务「完成」单一事实源不变量测试。
 * status 是唯一主状态;completed/completedAt 必须随 status 派生,
 * 避免「卡片勾选」与系统状态写入改到不同列导致进度/看板不一致。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setTaskCompletion, updateTaskMeta, getProjectTasks, getDb, refreshProjectTaskStatuses, applyAutomaticTaskStatuses } from "./db";
import { projectTasks, projects, type ProjectTask } from "../drizzle/schema";
import { DERIVATIVE_REUSE_MODULE_RULES, PROJECT_CATEGORIES } from "../shared/sop-templates";
import { and, eq } from "drizzle-orm";

const P = `test-sot-${Date.now()}`;
const PH = "concept";
const T = "c1";
const U = 999997;
const P_AUTO = `${P}-auto`;

async function row() {
  const tasks = await getProjectTasks(P, PH);
  return tasks.find((x) => x.taskId === T)!;
}

function makeTask(over: Partial<ProjectTask>): ProjectTask {
  return {
    id: 1,
    projectId: "p1",
    phaseId: "concept",
    taskId: "c1",
    completed: false,
    instructions: "",
    deliverables: {},
    visibleRoles: [],
    assigneeUserId: null,
    dueDate: null,
    startDate: null,
    actualStartedAt: null,
    completionNote: null,
    status: "todo",
    statusChangedAt: new Date(),
    priority: "medium",
    completedAt: null,
    updatedBy: null,
    requiresApproval: false,
    approverUserId: null,
    approvalStatus: "none",
    approvalNote: null,
    approvalRequestedBy: null,
    approvalRequestedAt: null,
    approvalDecidedBy: null,
    approvalDecidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as ProjectTask;
}

beforeAll(async () => {
  // project_tasks 有外键兜底后，任务必须挂在真实项目上
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: P, name: "完成态一致性测试", projectNumber: P, category: "npd",
    risk: "low", currentPhase: PH, createdBy: U,
  });
  // 起始:勾选一次再清空,确保存在一行
  await setTaskCompletion(P, PH, T, false, U);
});

afterAll(async () => {
  const db = await getDb();
  if (db) {
    await db.delete(projectTasks).where(eq(projectTasks.projectId, P_AUTO));
    await db.delete(projects).where(eq(projects.id, P_AUTO));
    await db.delete(projectTasks).where(and(eq(projectTasks.projectId, P), eq(projectTasks.phaseId, PH), eq(projectTasks.taskId, T)));
    await db.delete(projects).where(eq(projects.id, P));
  }
});

describe("task completion single source of truth", () => {
  it("卡片勾选完成 → status=done, completed=true, completedAt 非空", async () => {
    await setTaskCompletion(P, PH, T, true, U);
    const r = await row();
    expect(r.status).toBe("done");
    expect(r.completed).toBe(true);
    expect(r.completedAt).not.toBeNull();
  });

  it("卡片取消完成 → status=todo, completed=false, completedAt=null", async () => {
    await setTaskCompletion(P, PH, T, false, U);
    const r = await row();
    expect(r.status).toBe("todo");
    expect(r.completed).toBe(false);
    expect(r.completedAt).toBeNull();
  });

  it("系统写入 done → completed 镜像同步为 true", async () => {
    await updateTaskMeta(P, PH, T, { status: "done", updatedBy: U });
    const r = await row();
    expect(r.completed).toBe(true);
    expect(r.completedAt).not.toBeNull();
  });

  it("系统写入 in_progress → completed=false, completedAt=null", async () => {
    await updateTaskMeta(P, PH, T, { status: "in_progress", updatedBy: U });
    const r = await row();
    expect(r.status).toBe("in_progress");
    expect(r.completed).toBe(false);
    expect(r.completedAt).toBeNull();
  });

  it("系统写入 skipped → completed 镜像为 false(字面未完成),但 status 保留 skipped", async () => {
    await updateTaskMeta(P, PH, T, { status: "skipped", updatedBy: U });
    const r = await row();
    expect(r.status).toBe("skipped");
    expect(r.completed).toBe(false);
  });

  it("仅改优先级不影响完成状态", async () => {
    await updateTaskMeta(P, PH, T, { status: "done", updatedBy: U });
    await updateTaskMeta(P, PH, T, { priority: "high", updatedBy: U });
    const r = await row();
    expect(r.status).toBe("done");
    expect(r.completed).toBe(true);
    expect(r.priority).toBe("high");
  });

  it("未启动项目在所有项目类型 SOP 中保持待开始,不因依赖图变成阻塞", () => {
    for (const category of PROJECT_CATEGORIES) {
      const rows = category.phases.flatMap((phase, phaseIndex) =>
        phase.tasks.map((task, taskIndex) =>
          makeTask({
            id: phaseIndex * 100 + taskIndex + 1,
            projectId: `pending-${category.id}`,
            phaseId: phase.id,
            taskId: task.id,
          })
        )
      );

      const out = applyAutomaticTaskStatuses(rows, category.id, "2026-06-25", {
        projectStartDate: null,
      });
      expect(out.map((task) => task.status), category.id).not.toContain("blocked");
      expect(new Set(out.map((task) => task.status)), category.id).toEqual(new Set(["todo"]));
    }
  });

  it("状态派生与开始守卫共用裁剪后的项目有效依赖图", () => {
    const derivativeReuseStrategy = Object.fromEntries(
      DERIVATIVE_REUSE_MODULE_RULES.map((rule) => [rule.id, "direct_reuse"]),
    );
    const projectLike = {
      category: "derivative",
      customFields: { derivativeReuseStrategy },
    };
    const rows = [
      makeTask({
        id: 1,
        projectId: "contracted-status",
        phaseId: "intake",
        taskId: "di6",
        status: "done",
        completed: true,
        completedAt: new Date(),
      }),
      makeTask({
        id: 2,
        projectId: "contracted-status",
        phaseId: "design",
        taskId: "dd6",
        actualStartedAt: new Date(),
      }),
    ];

    const out = applyAutomaticTaskStatuses(rows, "derivative", "2026-07-12", {
      projectStartDate: "2026-07-01",
      projectLike,
    });
    expect(out.find((task) => task.taskId === "dd6")?.status).toBe("in_progress");
  });

  it("项目启动后依赖未完成的任务保持待开始(不标阻塞),依赖完成后按排期推进", async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    if (!db) return;

    await db.insert(projects).values({
      id: P_AUTO,
      name: "auto status",
      projectNumber: "AUTO-1",
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      startDate: "2026-06-01",
      progress: 0,
      createdBy: U,
      archived: false,
    });
    await db.insert(projectTasks).values([
      { projectId: P_AUTO, phaseId: "concept", taskId: "c1", status: "todo", completed: false },
      { projectId: P_AUTO, phaseId: "concept", taskId: "c2", status: "todo", completed: false },
      // c3 计划开始日已过但前置 c1/c2 未完成：还没轮到 = 待开始，不是阻塞
      { projectId: P_AUTO, phaseId: "concept", taskId: "c3", status: "todo", completed: false, startDate: "2026-06-05", dueDate: "2026-06-12" },
      { projectId: P_AUTO, phaseId: "concept", taskId: "c4", status: "todo", completed: false, startDate: "2099-01-01", dueDate: "2099-01-08" },
    ]);

    await refreshProjectTaskStatuses(P_AUTO, "2026-06-25");
    let rows = await getProjectTasks(P_AUTO, "concept");
    expect(rows.find((task) => task.taskId === "c3")?.status).toBe("todo");
    expect(rows.find((task) => task.taskId === "c4")?.status).toBe("todo");
    expect(rows.map((task) => task.status)).not.toContain("blocked");

    // 前置完成后，排期已经开始也仍保持 todo；只有人工开始动作才产生 in_progress。
    await updateTaskMeta(P_AUTO, "concept", "c1", { status: "done", updatedBy: U });
    await updateTaskMeta(P_AUTO, "concept", "c2", { status: "done", updatedBy: U });
    await refreshProjectTaskStatuses(P_AUTO, "2026-06-25");
    rows = await getProjectTasks(P_AUTO, "concept");
    expect(rows.find((task) => task.taskId === "c3")?.status).toBe("todo");

    await db.update(projectTasks)
      .set({ actualStartedAt: new Date("2026-06-25T01:00:00.000Z") })
      .where(and(eq(projectTasks.projectId, P_AUTO), eq(projectTasks.taskId, "c3")));
    await refreshProjectTaskStatuses(P_AUTO, "2026-06-25");
    rows = await getProjectTasks(P_AUTO, "concept");
    expect(rows.find((task) => task.taskId === "c3")?.status).toBe("in_progress");
  });
});
