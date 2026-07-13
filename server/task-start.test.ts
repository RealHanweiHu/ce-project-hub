import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import {
  actionItems,
  activityLogs,
  projectTasks,
  projects,
  users,
  type User,
} from "../drizzle/schema";
import { getDb, refreshProjectTaskStatuses } from "./db";
import { executeActionCardPayload } from "./action-card-route";
import { appRouter } from "./routers";
import { tasksRouter } from "./routers/tasks";

const PROJECT = `task-start-${Date.now()}`;
const PHASE = "concept";
const SCHEDULE_ONLY = "schedule-only";
const MANUAL_START = "manual-start";
const DONE = "already-done";
const SKIPPED = "already-skipped";
const CARD_START = "card-start";
const CONCURRENT_COMPLETE = "concurrent-complete";
let owner: User;
let actionItemId: number;

function caller() {
  return tasksRouter.createCaller({ user: owner } as never);
}

async function task(taskId: string) {
  const db = await getDb();
  const [row] = await db!.select().from(projectTasks).where(and(
    eq(projectTasks.projectId, PROJECT),
    eq(projectTasks.phaseId, PHASE),
    eq(projectTasks.taskId, taskId),
  ));
  return row;
}

async function actionItem(id: number) {
  const db = await getDb();
  const [row] = await db!.select().from(actionItems).where(eq(actionItems.id, id));
  return row;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  [owner] = await db.insert(users).values({
    openId: `task-start-owner-${Date.now()}`,
    name: "Task Start Owner",
    role: "member",
  }).returning();
  await db.insert(projects).values({
    id: PROJECT,
    name: "人工开始任务测试",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: PHASE,
    createdBy: owner.id,
  });
  await db.insert(projectTasks).values([
    {
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: SCHEDULE_ONLY,
      assigneeUserId: owner.id,
      startDate: "2026-01-01",
      dueDate: "2026-01-02",
    },
    {
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: MANUAL_START,
      assigneeUserId: owner.id,
      // 人可以早于计划开始；人工动作不得改写这列。
      startDate: "2099-01-01",
      dueDate: "2099-01-02",
    },
    {
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: DONE,
      status: "done",
      completed: true,
      completedAt: new Date(),
    },
    {
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: SKIPPED,
      status: "skipped",
    },
    {
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: CARD_START,
      assigneeUserId: owner.id,
    },
    {
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: CONCURRENT_COMPLETE,
      assigneeUserId: owner.id,
    },
  ]);
  [{ id: actionItemId }] = await db.insert(actionItems).values({
    kind: "task_ready",
    projectId: PROJECT,
    entityType: "task",
    entityId: `${PROJECT}:${PHASE}:${CARD_START}`,
    dedupeKey: `${PROJECT}:task-start-card`,
    recipientUserId: owner.id,
    title: "可以开始了",
    actionUrl: "/",
  }).returning({ id: actionItems.id });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(actionItems).where(eq(actionItems.projectId, PROJECT));
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  if (owner) await db.delete(users).where(eq(users.id, owner.id));
});

describe("tasks.start", () => {
  it("计划、负责人和到期日都不会自动把任务变成进行中", async () => {
    await refreshProjectTaskStatuses(PROJECT, "2026-07-12");
    expect((await task(SCHEDULE_ONLY)).status).toBe("todo");
  });

  it("只写实际开始时间并派生 in_progress；重复调用幂等", async () => {
    const db = await getDb();
    const [{ id: directStartActionItemId }] = await db!.insert(actionItems).values({
      kind: "task_ready",
      projectId: PROJECT,
      entityType: "task",
      entityId: `${PROJECT}:${PHASE}:${MANUAL_START}`,
      dedupeKey: `${PROJECT}:task-start-direct`,
      recipientUserId: owner.id,
      title: "可以开始了",
      actionUrl: "/",
    }).returning({ id: actionItems.id });
    const start = caller().start;
    const firstResult = await start({ projectId: PROJECT, phaseId: PHASE, taskId: MANUAL_START });
    expect(firstResult.already).not.toBe(true);
    const first = await task(MANUAL_START);
    expect(first.actualStartedAt).toBeInstanceOf(Date);
    expect(first.startDate).toBe("2099-01-01");
    expect(first.status).toBe("in_progress");
    expect(await actionItem(directStartActionItemId)).toMatchObject({
      status: "closed",
      handledAt: expect.any(Date),
      closedAt: expect.any(Date),
    });

    const secondResult = await start({ projectId: PROJECT, phaseId: PHASE, taskId: MANUAL_START });
    const second = await task(MANUAL_START);
    expect(secondResult.already).toBe(true);
    expect(second.actualStartedAt!.getTime()).toBe(first.actualStartedAt!.getTime());
  });

  it("done/skipped 任务拒绝开始", async () => {
    const start = caller().start;
    await expect(start({ projectId: PROJECT, phaseId: PHASE, taskId: DONE }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(start({ projectId: PROJECT, phaseId: PHASE, taskId: SKIPPED }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("task_start 卡片复用人工开始规则并闭环行动项", async () => {
    const result = await executeActionCardPayload({
      kind: "task_start",
      userId: owner.id,
      actionItemId,
      projectId: PROJECT,
      phaseId: PHASE,
      taskId: CARD_START,
    }, appRouter, {} as Request, {} as Response);

    expect(result.title).toBe("任务已开始");
    expect(result.actionPath).toContain(PROJECT);
    expect((await task(CARD_START)).status).toBe("in_progress");
    const item = await actionItem(actionItemId);
    // 任务路由按同一实体关闭所有 task_ready；卡片随后幂等确认，不再把 closed 改写成 done。
    expect(item).toMatchObject({
      status: "closed",
      handledAt: expect.any(Date),
      closedAt: expect.any(Date),
    });
  });

  it("start 把终态检查、CAS、refresh 和日志放在同一事务，emit 留到提交后", () => {
    const source = readFileSync(new URL("./routers/tasks.ts", import.meta.url), "utf8");
    const startSource = source.slice(source.indexOf("start: protectedProcedure"), source.indexOf("setApprovalConfig:"));
    expect(startSource).toContain("db.transaction");
    expect(startSource).toContain("eq(projectTasks.completed, false)");
    expect(startSource).toContain("notInArray(projectTasks.status");
    expect(startSource).toMatch(/refreshProjectTaskStatuses\(input\.projectId, undefined, tx\)/);
    expect(startSource).toMatch(/createActivityLog\([\s\S]*?, tx\)/);
    expect(startSource.indexOf("emitAutomationEvent")).toBeGreaterThan(startSource.lastIndexOf("db.transaction"));
  });

  it("终态更新先提交时，CAS 不写 actualStartedAt", async () => {
    const locker = new Client({ connectionString: process.env.DATABASE_URL });
    const contender = new Client({ connectionString: process.env.DATABASE_URL });
    await locker.connect();
    await contender.connect();
    const db = await getDb();
    await db!.update(projectTasks).set({
      status: "todo",
      completed: false,
      completedAt: null,
      actualStartedAt: null,
    }).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.phaseId, PHASE),
      eq(projectTasks.taskId, CONCURRENT_COMPLETE),
    ));
    await locker.query("BEGIN");
    try {
      await locker.query(
        `SELECT id FROM project_tasks WHERE "projectId" = $1 AND "phaseId" = $2 AND "taskId" = $3 FOR UPDATE`,
        [PROJECT, PHASE, CONCURRENT_COMPLETE],
      );

      let casSettled = false;
      const cas = contender.query(
        `UPDATE project_tasks
         SET "actualStartedAt" = now()
         WHERE "projectId" = $1 AND "phaseId" = $2 AND "taskId" = $3
           AND "actualStartedAt" IS NULL
           AND completed = false
           AND status NOT IN ('done', 'skipped', 'pending_approval')
         RETURNING id`,
        [PROJECT, PHASE, CONCURRENT_COMPLETE],
      );
      void cas.finally(() => { casSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(casSettled).toBe(false);

      await locker.query(
        `UPDATE project_tasks
         SET status = 'done', completed = true, "completedAt" = now()
         WHERE "projectId" = $1 AND "phaseId" = $2 AND "taskId" = $3`,
        [PROJECT, PHASE, CONCURRENT_COMPLETE],
      );
      await locker.query("COMMIT");

      const result = await cas;
      expect(result.rowCount).toBe(0);
      const row = await task(CONCURRENT_COMPLETE);
      expect(row.status).toBe("done");
      expect(row.actualStartedAt).toBeNull();
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      await locker.end();
      await contender.end();
    }
  }, 10_000);
});
