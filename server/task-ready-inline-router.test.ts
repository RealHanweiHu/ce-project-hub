import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  actionItems,
  activityLogs,
  notifications,
  projectFiles,
  projectMembers,
  projectTasks,
  projects,
} from "../drizzle/schema";
import {
  getDb,
  setTaskApprovalConfig,
  setTaskCompletion,
} from "./db";
import { activityLogToAutomationEvent, runActivityLogTailerOnce } from "./automation/activityLogTailer";
import { isAutomationRuleMatch, type AutomationEvent } from "./automation/rules";

const runAutomation = vi.hoisted(() => vi.fn(async (_event: AutomationEvent) => ({
  matched: 0,
  fired: 0,
  partial: 0,
  skipped: 0,
  errors: 0,
})));

vi.mock("./automation/engine", () => ({ runAutomation }));

import { tasksRouter } from "./routers/tasks";
import { applyActionExternalApproval } from "./services/action-approval-apply";

const PROJECT = `inline-ready-${Date.now()}`;
const OWNER = 7_992_101;
const OLD_ASSIGNEE = 7_992_102;
const READY_ASSIGNEE = 7_992_103;
const NOT_READY_ASSIGNEE = 7_992_104;
const originalMode = process.env.AUTOMATION_EVENT_MODE;

const caller = tasksRouter.createCaller({
  user: {
    id: OWNER,
    role: "member",
    name: "Inline Ready Owner",
    email: null,
    username: null,
    passwordHash: null,
    canCreateProject: false,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
  },
} as never);

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "Inline task_ready 路由测试",
    projectNumber: PROJECT,
    category: "npd",
    sopTemplateVersion: "2026-07-v3",
    customFields: { npdTemplate: { tier: "standard", packs: [] } },
    risk: "low",
    currentPhase: "design",
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: OLD_ASSIGNEE, role: "rd_hw", invitedBy: OWNER },
    { projectId: PROJECT, userId: READY_ASSIGNEE, role: "rd_hw", invitedBy: OWNER },
    { projectId: PROJECT, userId: NOT_READY_ASSIGNEE, role: "rd_hw", invitedBy: OWNER },
  ]);
  await db.insert(projectTasks).values([
    { projectId: PROJECT, phaseId: "concept", taskId: "nc1", assigneeUserId: OWNER },
    { projectId: PROJECT, phaseId: "concept", taskId: "nc3", status: "done", completed: true, completedAt: new Date() },
    { projectId: PROJECT, phaseId: "planning", taskId: "np1", assigneeUserId: OLD_ASSIGNEE },
    { projectId: PROJECT, phaseId: "planning", taskId: "np2", assigneeUserId: OWNER },
    { projectId: PROJECT, phaseId: "planning", taskId: "np3", status: "done", completed: true },
    { projectId: PROJECT, phaseId: "design", taskId: "nd1", assigneeUserId: OWNER },
    { projectId: PROJECT, phaseId: "design", taskId: "nd2", assigneeUserId: OWNER },
    { projectId: PROJECT, phaseId: "design", taskId: "nd4", assigneeUserId: OLD_ASSIGNEE },
    { projectId: PROJECT, phaseId: "evt", taskId: "ne1" },
    { projectId: PROJECT, phaseId: "evt", taskId: "ne2", assigneeUserId: OWNER },
    { projectId: PROJECT, phaseId: "design", taskId: "nd3", assigneeUserId: OWNER },
  ]);
  await db.insert(projectFiles).values([
    {
      projectId: PROJECT,
      phaseId: "concept",
      taskId: "nc1",
      name: "nc1-evidence.pdf",
      storageKey: `${PROJECT}/nc1-evidence.pdf`,
      storageUrl: `/storage/${PROJECT}/nc1-evidence.pdf`,
      uploadedBy: OWNER,
    },
    {
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd1",
      name: "nd1-evidence.pdf",
      storageKey: `${PROJECT}/nd1-evidence.pdf`,
      storageUrl: `/storage/${PROJECT}/nd1-evidence.pdf`,
      uploadedBy: OWNER,
    },
    {
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd3",
      name: "nd3-evidence.pdf",
      storageKey: `${PROJECT}/nd3-evidence.pdf`,
      storageUrl: `/storage/${PROJECT}/nd3-evidence.pdf`,
      uploadedBy: OWNER,
    },
  ]);
});

beforeEach(() => {
  runAutomation.mockClear();
  process.env.AUTOMATION_EVENT_MODE = "inline";
});

afterAll(async () => {
  if (originalMode === undefined) delete process.env.AUTOMATION_EVENT_MODE;
  else process.env.AUTOMATION_EVENT_MODE = originalMode;
  const db = await getDb();
  if (!db) return;
  await db.delete(notifications).where(inArray(notifications.userId, [OWNER, READY_ASSIGNEE, NOT_READY_ASSIGNEE]));
  await db.delete(actionItems).where(eq(actionItems.projectId, PROJECT));
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

function doneEvents(): AutomationEvent[] {
  return runAutomation.mock.calls
    .map(([event]) => event)
    .filter((event) => isAutomationRuleMatch("task_ready_notify", event));
}

async function createTaskReady(phaseId: string, taskId: string, recipientUserId: number, suffix: string) {
  const db = await getDb();
  const [item] = await db!.insert(actionItems).values({
    kind: "task_ready",
    projectId: PROJECT,
    entityType: "task",
    entityId: `${PROJECT}:${phaseId}:${taskId}`,
    dedupeKey: `${PROJECT}:task-ready:${suffix}`,
    recipientUserId,
    title: "可以开始了",
    actionUrl: "/",
  }).returning();
  return item;
}

async function loadActionItem(id: number) {
  const db = await getDb();
  const [item] = await db!.select().from(actionItems).where(eq(actionItems.id, id));
  return item;
}

describe("task_ready 路由完成事件", () => {
  it("setCompleted 在事务提交后向 inline 引擎发送一次 done 事件", async () => {
    const committedStatuses: string[] = [];
    runAutomation.mockImplementation(async (event) => {
      if (isAutomationRuleMatch("task_ready_notify", event)) {
        const db = await getDb();
        const [row] = await db!.select({ status: projectTasks.status }).from(projectTasks).where(and(
          eq(projectTasks.projectId, PROJECT),
          eq(projectTasks.phaseId, "design"),
          eq(projectTasks.taskId, "nd1"),
        ));
        committedStatuses.push(row.status);
      }
      return { matched: 0, fired: 0, partial: 0, skipped: 0, errors: 0 };
    });

    const readyItem = await createTaskReady("design", "nd1", OWNER, "complete");
    await caller.setCompleted({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd1",
      completed: true,
      completionNote: "设计输入已确认",
    });

    expect(await loadActionItem(readyItem.id)).toMatchObject({
      status: "closed",
      handledAt: expect.any(Date),
      closedAt: expect.any(Date),
    });

    expect(doneEvents()).toHaveLength(1);
    expect(doneEvents()[0]).toMatchObject({
      action: "task.update_meta",
      projectId: PROJECT,
      before: { taskId: "nd1" },
      after: { taskId: "nd1", status: "done" },
    });
    expect(committedStatuses).toEqual(["done"]);
  });

  it("需审批任务提交后也按 composite entityId 闭环 task_ready", async () => {
    await setTaskApprovalConfig(PROJECT, "planning", "np2", {
      requiresApproval: true,
      approverUserId: OWNER,
    }, OWNER);
    const readyItem = await createTaskReady("planning", "np2", OWNER, "submit");

    await caller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      completed: true,
      completionNote: "BOM 与供应商表已确认",
    });

    const db = await getDb();
    const [task] = await db!.select().from(projectTasks).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.phaseId, "planning"),
      eq(projectTasks.taskId, "np2"),
    ));
    expect(task.status).toBe("pending_approval");
    expect(task.completed).toBe(false);
    expect(await loadActionItem(readyItem.id)).toMatchObject({
      status: "closed",
      handledAt: expect.any(Date),
      closedAt: expect.any(Date),
    });
    expect(doneEvents()).toHaveLength(0);
  });

  it("审批通过在写库完成后向 inline 引擎发送一次 done 事件", async () => {
    await setTaskApprovalConfig(PROJECT, "planning", "np2", {
      requiresApproval: true,
      approverUserId: OWNER,
    }, OWNER);
    const db = await getDb();
    await db!.update(projectTasks).set({ completionNote: "BOM 与供应商表已确认" }).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.phaseId, "planning"),
      eq(projectTasks.taskId, "np2"),
    ));
    await setTaskCompletion(PROJECT, "planning", "np2", true, OWNER);
    runAutomation.mockClear();

    await caller.decideApproval({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      decision: "approved",
      note: "同意",
    });

    expect(doneEvents()).toHaveLength(1);
    expect(doneEvents()[0]).toMatchObject({
      before: { taskId: "np2", status: "pending_approval" },
      after: { taskId: "np2", status: "done" },
    });
  });

  it("钉钉外部审批回调也复验并发送一次 inline done 事件", async () => {
    await setTaskApprovalConfig(PROJECT, "concept", "nc1", {
      requiresApproval: true,
      approverUserId: OWNER,
    }, OWNER);
    await setTaskCompletion(PROJECT, "concept", "nc1", true, OWNER);
    const readyItem = await createTaskReady("concept", "nc1", OWNER, "external-approve");
    runAutomation.mockClear();

    await applyActionExternalApproval({
      businessType: "task_approval",
      projectId: PROJECT,
      entityType: "task",
      entityId: `${PROJECT}:concept:nc1`,
      requestSnapshot: {
        action: {
          kind: "task_approval",
          projectId: PROJECT,
          entityType: "task",
          entityId: `${PROJECT}:concept:nc1`,
          recipientUserId: OWNER,
          actionItemId: null,
          metadata: { phaseId: "concept", taskId: "nc1" },
        },
      },
    } as never, "approved");

    expect(doneEvents()).toHaveLength(1);
    expect(doneEvents()[0]).toMatchObject({
      before: { taskId: "nc1", status: "pending_approval" },
      after: { taskId: "nc1", status: "done" },
    });
    expect(await loadActionItem(readyItem.id)).toMatchObject({ status: "closed" });
  });

  it("tailer 模式路由不 inline 双发，活动日志随后只派发一次", async () => {
    process.env.AUTOMATION_EVENT_MODE = "tailer";
    await caller.setCompleted({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd3",
      completed: true,
      completionNote: "布局输入已确认",
    });
    expect(runAutomation).not.toHaveBeenCalled();

    const db = await getDb();
    const [log] = await db!.select().from(activityLogs).where(and(
      eq(activityLogs.projectId, PROJECT),
      eq(activityLogs.action, "task.complete"),
      eq(activityLogs.entityId, "nd3"),
    )).orderBy(desc(activityLogs.id)).limit(1);
    expect(activityLogToAutomationEvent(log)).toMatchObject({
      action: "task.update_meta",
      after: { taskId: "nd3", status: "done" },
    });

    await runActivityLogTailerOnce({
      tryStartAutomationHeartbeat: async () => true,
      getAutomationHeartbeat: async () => ({
        schedulerKey: "activity_log_tailer",
        lastCursorId: log.id - 1,
        lastStartedAt: new Date(),
        lastFinishedAt: new Date(),
        lastStatus: "success",
        lastDurationMs: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getLatestActivityLogId: async () => log.id,
      listActivityLogsAfter: async () => [log],
      finishAutomationHeartbeat: async () => undefined,
      advanceAutomationHeartbeatCursor: async () => undefined,
      runAutomation,
    });
    expect(runAutomation).toHaveBeenCalledTimes(1);
  });

  it("setMeta 改派先关闭旧 task_ready，仅依赖已齐的新负责人获得新行动项", async () => {
    process.env.AUTOMATION_EVENT_MODE = "tailer";
    const readyOld = await createTaskReady("planning", "np1", OLD_ASSIGNEE, "reassign-ready-old");
    const notReadyOld = await createTaskReady("design", "nd4", OLD_ASSIGNEE, "reassign-not-ready-old");

    await caller.setMeta({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd4",
      assigneeUserId: NOT_READY_ASSIGNEE,
    });
    await caller.setMeta({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      assigneeUserId: READY_ASSIGNEE,
    });

    expect(await loadActionItem(readyOld.id)).toMatchObject({ status: "closed", closedAt: expect.any(Date) });
    expect(await loadActionItem(notReadyOld.id)).toMatchObject({ status: "closed", closedAt: expect.any(Date) });

    const db = await getDb();
    const newReady = await db!.select().from(actionItems).where(and(
      eq(actionItems.kind, "task_ready"),
      eq(actionItems.entityId, `${PROJECT}:planning:np1`),
      eq(actionItems.recipientUserId, READY_ASSIGNEE),
    ));
    const wronglyNotified = await db!.select().from(actionItems).where(and(
      eq(actionItems.kind, "task_ready"),
      eq(actionItems.entityId, `${PROJECT}:design:nd4`),
      eq(actionItems.recipientUserId, NOT_READY_ASSIGNEE),
    ));
    expect(newReady).toHaveLength(1);
    expect(["open", "sent", "read"]).toContain(newReady[0].status);
    expect(newReady[0]).toMatchObject({
      dedupeKey: `task_ready:${PROJECT}:${PROJECT}:planning:np1:${READY_ASSIGNEE}:owner`,
      metadata: expect.objectContaining({ phaseId: "planning", taskId: "np1", evidenceLevel: "heavy" }),
    });
    expect(wronglyNotified).toHaveLength(0);
  });
});
