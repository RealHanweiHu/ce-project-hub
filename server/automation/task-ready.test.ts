import { describe, expect, it, vi } from "vitest";
import type { ActionItem, ProjectTask } from "../../drizzle/schema";
import type { AutomationEvent } from "./rules";
import {
  notifyAllReadyTasks,
  notifyTaskReadyActionItems,
  notifyTaskReadyTask,
  reconcileTaskReadyActionItems,
} from "./taskReady";

const project = {
  id: "task-ready-v3",
  category: "npd",
  sopTemplateVersion: "2026-07-v3",
  customFields: { npdTemplate: { tier: "standard", packs: [] } },
  currentPhase: "design",
} as const;

function row(input: Partial<ProjectTask> & Pick<ProjectTask, "phaseId" | "taskId">): ProjectTask {
  return {
    id: Math.floor(Math.random() * 100_000),
    projectId: project.id,
    completed: false,
    instructions: null,
    deliverables: {},
    visibleRoles: [],
    assigneeUserId: null,
    dueDate: null,
    startDate: null,
    status: "todo",
    statusChangedAt: new Date("2026-07-12T00:00:00Z"),
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
    createdAt: new Date("2026-07-12T00:00:00Z"),
    updatedAt: new Date("2026-07-12T00:00:00Z"),
    ...input,
  };
}

function doneEvent(overrides: Partial<AutomationEvent> = {}): AutomationEvent {
  return {
    action: "task.update_meta",
    projectId: project.id,
    entityType: "task",
    entityId: `${project.id}:concept:nc3`,
    before: { taskId: "nc3", phaseId: "concept", status: "in_progress" },
    after: { taskId: "nc3", phaseId: "concept", status: "done" },
    sourceActivityLogId: 701,
    ...overrides,
  };
}

describe("task_ready 自动化", () => {
  it("改派后单任务重判：依赖已齐时给新负责人建同一规格行动项", async () => {
    const rows = [
      row({ phaseId: "concept", taskId: "nc3", status: "done", completed: true }),
      row({ phaseId: "planning", taskId: "np1", assigneeUserId: 21 }),
    ];
    const notifications: Array<Record<string, unknown>> = [];

    const result = await notifyTaskReadyTask(project, "planning", "np1", {
      loadProjectTasks: async () => rows,
      dispatchActionItem: async (input) => {
        notifications.push(input as unknown as Record<string, unknown>);
        return { dispatched: true, actionItemId: 91 };
      },
    });

    expect(result).toEqual({ eligible: 1, dispatched: 1 });
    expect(notifications).toEqual([
      expect.objectContaining({
        kind: "task_ready",
        entityId: `${project.id}:planning:np1`,
        recipientUserId: 21,
        title: expect.stringContaining("产品需求与规格书"),
        dedupeKey: `task_ready:${project.id}:${project.id}:planning:np1:21:owner`,
        metadata: expect.objectContaining({ phaseId: "planning", taskId: "np1", evidenceLevel: "heavy" }),
      }),
    ]);
  });

  it("改派后单任务重判：依赖未齐或任务已终态时保持静默", async () => {
    const dispatchActionItem = vi.fn();
    const unresolved = await notifyTaskReadyTask(project, "planning", "np1", {
      loadProjectTasks: async () => [
        row({ phaseId: "concept", taskId: "nc3", status: "todo" }),
        row({ phaseId: "planning", taskId: "np1", assigneeUserId: 21 }),
      ],
      dispatchActionItem,
    });
    const terminal = await notifyTaskReadyTask(project, "planning", "np1", {
      loadProjectTasks: async () => [
        row({ phaseId: "concept", taskId: "nc3", status: "done", completed: true }),
        row({ phaseId: "planning", taskId: "np1", status: "done", completed: true, assigneeUserId: 21 }),
      ],
      dispatchActionItem,
    });

    expect(unresolved).toEqual({ eligible: 0, dispatched: 0 });
    expect(terminal).toEqual({ eligible: 0, dispatched: 0 });
    expect(dispatchActionItem).not.toHaveBeenCalled();
  });

  it("Gate 完成后给下一阶段普通任务建行动项，保留 todo，并携带证据分流元数据", async () => {
    const rows = [
      row({ phaseId: "concept", taskId: "nc3", status: "done", completed: true }),
      row({ phaseId: "planning", taskId: "np1", assigneeUserId: 11 }),
      row({ phaseId: "planning", taskId: "np2", assigneeUserId: 12 }),
      row({ phaseId: "planning", taskId: "np3", assigneeUserId: 13 }),
    ];
    const notifications: Array<Record<string, unknown>> = [];

    const result = await notifyTaskReadyActionItems(doneEvent(), project, {
      loadProjectTasks: async () => rows,
      dispatchActionItem: async (input) => {
        notifications.push(input as unknown as Record<string, unknown>);
        return { dispatched: true, actionItemId: notifications.length };
      },
    });

    expect(result).toEqual({ eligible: 2, dispatched: 2 });
    expect(notifications).toHaveLength(2);
    expect(notifications.map((item) => item.kind)).toEqual(["task_ready", "task_ready"]);
    expect(notifications.map((item) => item.recipientUserId)).toEqual([11, 12]);
    expect(notifications.map((item) => item.entityId)).toEqual([
      `${project.id}:planning:np1`,
      `${project.id}:planning:np2`,
    ]);
    expect(notifications.map((item) => item.dedupeKey)).toEqual([
      `task_ready:${project.id}:${project.id}:planning:np1:11:owner`,
      `task_ready:${project.id}:${project.id}:planning:np2:12:owner`,
    ]);
    expect(notifications.map((item) => item.metadata)).toEqual([
      expect.objectContaining({ phaseId: "planning", taskId: "np1", evidenceLevel: "heavy" }),
      expect.objectContaining({ phaseId: "planning", taskId: "np2", evidenceLevel: "light" }),
    ]);
    expect(rows.map((task) => task.status)).toEqual(["done", "todo", "todo", "todo"]);
  });

  it("审批裁掉中间任务后收缩依赖，A 完成会直接通知 C", async () => {
    const rows = [
      row({ phaseId: "planning", taskId: "np3", status: "done", completed: true }),
      row({ phaseId: "design", taskId: "nd1", status: "skipped" }),
      row({ phaseId: "design", taskId: "nd2", assigneeUserId: 31 }),
    ];
    const dispatchActionItem = vi.fn(async () => ({ dispatched: true, actionItemId: 92 }));

    const result = await notifyTaskReadyActionItems(doneEvent({
      entityId: `${project.id}:planning:np3`,
      before: { taskId: "np3", phaseId: "planning", status: "in_progress" },
      after: { taskId: "np3", phaseId: "planning", status: "done" },
    }), project, {
      loadProjectTasks: async () => rows,
      dispatchActionItem,
    });

    expect(result).toEqual({ eligible: 1, dispatched: 1 });
    expect(dispatchActionItem).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "task_ready",
        entityId: `${project.id}:design:nd2`,
        recipientUserId: 31,
        metadata: expect.objectContaining({ taskId: "nd2", predecessorTaskId: "np3" }),
      }),
      expect.any(Object),
    );
  });

  it("A 已完成后再批准裁剪 B，会立即重判并给 C 建卡", async () => {
    const rows = [
      row({ phaseId: "planning", taskId: "np3", status: "done", completed: true }),
      row({ phaseId: "design", taskId: "nd1", status: "skipped" }),
      row({ phaseId: "design", taskId: "nd2", assigneeUserId: 32 }),
    ];
    const dispatchActionItem = vi.fn(async () => ({ dispatched: true, actionItemId: 93 }));

    const result = await reconcileTaskReadyActionItems(project, {
      loadProjectTasks: async () => rows,
      dispatchActionItem,
      loadActiveReadyItems: async () => [],
    });

    expect(result).toEqual({ eligible: 1, dispatched: 1 });
    expect(dispatchActionItem).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: `${project.id}:design:nd2`,
        recipientUserId: 32,
      }),
      expect.any(Object),
    );
  });

  it("全量重判不向未来阶段发送假就绪卡", async () => {
    const rows = [
      row({ phaseId: "design", taskId: "nd6", status: "done", completed: true }),
      row({ phaseId: "evt", taskId: "ne1", assigneeUserId: 41 }),
    ];
    const dispatchActionItem = vi.fn();

    const result = await notifyAllReadyTasks(project, {
      loadProjectTasks: async () => rows,
      dispatchActionItem,
    });

    expect(result).toEqual({ eligible: 0, dispatched: 0 });
    expect(dispatchActionItem).not.toHaveBeenCalled();
  });

  it("撤销裁剪后依赖重新出现，会关闭已经失效的旧就绪卡", async () => {
    const rows = [
      row({ phaseId: "planning", taskId: "np3", status: "done", completed: true }),
      row({ phaseId: "design", taskId: "nd1", status: "todo" }),
      row({ phaseId: "design", taskId: "nd2", assigneeUserId: 33 }),
    ];
    const dedupeKey = `task_ready:${project.id}:${project.id}:design:nd2:33:owner`;
    const staleItem = {
      id: 501,
      projectId: project.id,
      kind: "task_ready",
      dedupeKey,
      entityType: "task",
      entityId: `${project.id}:design:nd2`,
      recipientUserId: 33,
      status: "sent",
    } as ActionItem;
    const closeReadyItem = vi.fn(async () => undefined);
    const dispatchActionItem = vi.fn();

    const result = await reconcileTaskReadyActionItems(project, {
      loadProjectTasks: async () => rows,
      loadActiveReadyItems: async () => [staleItem],
      closeReadyItem,
      dispatchActionItem,
    });

    expect(result).toEqual({ eligible: 0, dispatched: 0 });
    expect(closeReadyItem).toHaveBeenCalledWith(staleItem);
    expect(dispatchActionItem).not.toHaveBeenCalled();
  });

  it("不是从非终态变为 done 时不读取任务，也不派发", async () => {
    const loadProjectTasks = vi.fn(async () => [] as ProjectTask[]);
    const dispatchActionItem = vi.fn();

    const result = await notifyTaskReadyActionItems(doneEvent({
      before: { taskId: "nc3", status: "done" },
      after: { taskId: "nc3", status: "done" },
    }), project, { loadProjectTasks, dispatchActionItem });

    expect(result).toEqual({ eligible: 0, dispatched: 0 });
    expect(loadProjectTasks).not.toHaveBeenCalled();
    expect(dispatchActionItem).not.toHaveBeenCalled();
  });

  it("后继没有负责人时保持静默，不由自动化替任务改状态", async () => {
    const rows = [
      row({ phaseId: "concept", taskId: "nc3", status: "done", completed: true }),
      row({ phaseId: "planning", taskId: "np1" }),
      row({ phaseId: "planning", taskId: "np2" }),
    ];
    const dispatchActionItem = vi.fn();

    const result = await notifyTaskReadyActionItems(doneEvent(), project, {
      loadProjectTasks: async () => rows,
      dispatchActionItem,
    });

    expect(result).toEqual({ eligible: 0, dispatched: 0 });
    expect(dispatchActionItem).not.toHaveBeenCalled();
    expect(rows.map((task) => task.status)).toEqual(["done", "todo", "todo"]);
  });
});
