/**
 * 任务「完成」单一事实源不变量测试。
 * status 是唯一主状态;completed/completedAt 必须随 status 派生,
 * 避免「卡片勾选」与系统状态写入改到不同列导致进度/看板不一致。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setTaskCompletion, updateTaskMeta, getProjectTasks, getDb, refreshProjectTaskStatuses } from "./db";
import { projectTasks, projects } from "../drizzle/schema";
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

  it("依赖未完成时自动标记 blocked,依赖完成后回到待处理", async () => {
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
      progress: 0,
      createdBy: U,
      archived: false,
    });
    await db.insert(projectTasks).values([
      { projectId: P_AUTO, phaseId: "concept", taskId: "c1", status: "todo", completed: false },
      { projectId: P_AUTO, phaseId: "concept", taskId: "c2", status: "todo", completed: false },
      { projectId: P_AUTO, phaseId: "concept", taskId: "c3", status: "todo", completed: false },
      { projectId: P_AUTO, phaseId: "concept", taskId: "c4", status: "todo", completed: false, startDate: "2099-01-01", dueDate: "2099-01-08" },
    ]);

    await refreshProjectTaskStatuses(P_AUTO);
    let rows = await getProjectTasks(P_AUTO, "concept");
    expect(rows.find((task) => task.taskId === "c3")?.status).toBe("blocked");
    expect(rows.find((task) => task.taskId === "c4")?.status).toBe("todo");

    await updateTaskMeta(P_AUTO, "concept", "c1", { status: "done", updatedBy: U });
    await updateTaskMeta(P_AUTO, "concept", "c2", { status: "done", updatedBy: U });
    await refreshProjectTaskStatuses(P_AUTO);
    rows = await getProjectTasks(P_AUTO, "concept");
    expect(rows.find((task) => task.taskId === "c3")?.status).toBe("todo");
  });
});
