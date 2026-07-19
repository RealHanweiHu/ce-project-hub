import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLogs, projects, projectTasks } from "../drizzle/schema";
import { getDb } from "./db";
import { tasksRouter } from "./routers/tasks";

const OWNER = 7_991_001;
const PROJECT = `completion-note-${Date.now()}`;
const PHASE = "concept";
const TASK = "light-evidence";

const caller = tasksRouter.createCaller({
  user: {
    id: OWNER,
    role: "member",
    name: "Completion Note Owner",
    email: null,
    username: null,
    passwordHash: null,
    canCreateProject: false,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
  },
} as never);

async function completionNote(): Promise<string | null> {
  const db = await getDb();
  const [row] = await db!
    .select({ completionNote: projectTasks.completionNote })
    .from(projectTasks)
    .where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.phaseId, PHASE),
      eq(projectTasks.taskId, TASK),
    ));
  return row?.completionNote ?? null;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "轻证据一句话结论测试",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: PHASE,
    createdBy: OWNER,
  });
  await db.insert(projectTasks).values({
    projectId: PROJECT,
    phaseId: PHASE,
    taskId: TASK,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("tasks.setCompleted completionNote", () => {
  it("完成时保存去空白的一句话结论，取消完成时清空", async () => {
    await caller.setCompleted({
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: TASK,
      completed: true,
      completionNote: "  已对齐三家竞品，结论见链接  ",
    });
    expect(await completionNote()).toBe("已对齐三家竞品，结论见链接");

    await caller.setCompleted({
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: TASK,
      completed: false,
    });
    expect(await completionNote()).toBeNull();
  });

  it("拒绝超过 500 字的一句话结论", async () => {
    await expect(caller.setCompleted({
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: TASK,
      completed: true,
      completionNote: "结".repeat(501),
    })).rejects.toThrow();
  });

  it("结论写入失败时，完成状态和活动日志一起回滚", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const trigger = "test_completion_note_atomicity_guard";
    const fn = "test_completion_note_atomicity_guard_fn";
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON project_tasks`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${fn}()`));
    await db.execute(sql.raw(`
      CREATE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        IF NEW."projectId" = '${PROJECT}' AND NEW.completion_note = '触发回滚' THEN
          RAISE EXCEPTION 'forced completion note failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER ${trigger}
      BEFORE UPDATE OF completion_note ON project_tasks
      FOR EACH ROW EXECUTE FUNCTION ${fn}()
    `));

    const beforeLogs = await db.select({ id: activityLogs.id }).from(activityLogs).where(and(
      eq(activityLogs.projectId, PROJECT),
      eq(activityLogs.action, "task.complete"),
    ));
    try {
      await expect(caller.setCompleted({
        projectId: PROJECT,
        phaseId: PHASE,
        taskId: TASK,
        completed: true,
        completionNote: "触发回滚",
      })).rejects.toThrow();
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON project_tasks`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${fn}()`));
    }

    const [row] = await db.select().from(projectTasks).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.phaseId, PHASE),
      eq(projectTasks.taskId, TASK),
    ));
    expect(row.status).toBe("todo");
    expect(row.completed).toBe(false);
    expect(row.completionNote).toBeNull();
    const afterLogs = await db.select({ id: activityLogs.id }).from(activityLogs).where(and(
      eq(activityLogs.projectId, PROJECT),
      eq(activityLogs.action, "task.complete"),
    ));
    expect(afterLogs).toHaveLength(beforeLogs.length);
  });
});
