/**
 * 任务「完成」单一事实源不变量测试。
 * status 是唯一主状态;completed/completedAt 必须随 status 派生,
 * 避免「卡片勾选」与「状态下拉」改到不同列导致进度/看板不一致。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setTaskCompletion, updateTaskMeta, getProjectTasks, getDb } from "./db";
import { projectTasks } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const P = `test-sot-${Date.now()}`;
const PH = "concept";
const T = "c1";
const U = 999997;

async function row() {
  const tasks = await getProjectTasks(P, PH);
  return tasks.find((x) => x.taskId === T)!;
}

beforeAll(async () => {
  // 起始:勾选一次再清空,确保存在一行
  await setTaskCompletion(P, PH, T, false, U);
});

afterAll(async () => {
  const db = await getDb();
  if (db) await db.delete(projectTasks).where(and(eq(projectTasks.projectId, P), eq(projectTasks.phaseId, PH), eq(projectTasks.taskId, T)));
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

  it("状态下拉改 done → completed 镜像同步为 true", async () => {
    await updateTaskMeta(P, PH, T, { status: "done", updatedBy: U });
    const r = await row();
    expect(r.completed).toBe(true);
    expect(r.completedAt).not.toBeNull();
  });

  it("状态下拉改 in_progress → completed=false, completedAt=null", async () => {
    await updateTaskMeta(P, PH, T, { status: "in_progress", updatedBy: U });
    const r = await row();
    expect(r.status).toBe("in_progress");
    expect(r.completed).toBe(false);
    expect(r.completedAt).toBeNull();
  });

  it("状态下拉改 skipped → completed 镜像为 false(字面未完成),但 status 保留 skipped", async () => {
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
});
