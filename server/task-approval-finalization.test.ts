import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLogs, projectFiles, projects, projectTasks } from "../drizzle/schema";
import {
  decideTaskApproval,
  getDb,
  setTaskApprovalConfig,
  setTaskCompletion,
} from "./db";
import { finalizeTaskApproval } from "./task-approval-service";

const PROJECT = `approval-final-${Date.now()}`;
const ASSIGNEE = 8_821_001;
const APPROVER = 8_821_002;

async function loadTask(taskId: string) {
  const db = await getDb();
  const [task] = await db!.select().from(projectTasks).where(and(
    eq(projectTasks.projectId, PROJECT),
    eq(projectTasks.taskId, taskId),
  ));
  return task;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(projects).values({
    id: PROJECT,
    name: "审批终态复验",
    projectNumber: PROJECT,
    category: "npd",
    sopTemplateVersion: "2026-07-v3",
    customFields: { npdTemplate: { tier: "standard", packs: [] } },
    currentPhase: "planning",
    risk: "low",
    createdBy: APPROVER,
  });
  await db.insert(projectTasks).values([
    {
      projectId: PROJECT,
      phaseId: "concept",
      taskId: "nc3",
      status: "done",
      completed: true,
      completedAt: new Date(),
    },
    {
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      assigneeUserId: ASSIGNEE,
      completionNote: "BOM 与供应商结论已确认",
    },
    {
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      assigneeUserId: ASSIGNEE,
    },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("任务审批落终态总闸", () => {
  it("todo 任务不能被底层审批函数直接写成 done", async () => {
    await expect(decideTaskApproval(
      PROJECT,
      "planning",
      "np2",
      "approved",
      APPROVER,
      null,
      false,
    )).rejects.toThrow(/待审批/);
    expect(await loadTask("np2")).toMatchObject({ status: "todo", completed: false });
  });

  it("提交后撤回，迟到的审批回调不能重新完成任务", async () => {
    await setTaskApprovalConfig(PROJECT, "planning", "np2", {
      requiresApproval: true,
      approverUserId: APPROVER,
    }, APPROVER);
    await setTaskCompletion(PROJECT, "planning", "np2", true, ASSIGNEE);
    await setTaskCompletion(PROJECT, "planning", "np2", false, ASSIGNEE);

    await expect(finalizeTaskApproval({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      decision: "approved",
      actor: APPROVER,
      note: "迟到回调",
      isProxy: false,
    })).rejects.toThrow(/待审批/);
    expect(await loadTask("np2")).toMatchObject({ status: "todo", completed: false });
  });

  it("待审期间上游依赖失效，审批通过前会重新阻断", async () => {
    const db = await getDb();
    await setTaskCompletion(PROJECT, "planning", "np2", true, ASSIGNEE);
    await db!.update(projectTasks).set({ status: "todo", completed: false, completedAt: null }).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.taskId, "nc3"),
    ));

    await expect(finalizeTaskApproval({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      decision: "approved",
      actor: APPROVER,
      note: null,
      isProxy: false,
    })).rejects.toThrow(/前置任务/);
    expect(await loadTask("np2")).toMatchObject({ status: "pending_approval", completed: false });

    await db!.update(projectTasks).set({ status: "done", completed: true, completedAt: new Date() }).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.taskId, "nc3"),
    ));
    await finalizeTaskApproval({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      decision: "rejected",
      actor: APPROVER,
      note: "依赖已变更",
      isProxy: false,
    });
  });

  it("待审期间负责人证据被删除，重证据审批不能通过", async () => {
    const db = await getDb();
    await setTaskApprovalConfig(PROJECT, "planning", "np1", {
      requiresApproval: true,
      approverUserId: APPROVER,
    }, APPROVER);
    const [file] = await db!.insert(projectFiles).values({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      name: "np1-evidence.pdf",
      storageKey: `${PROJECT}/np1-evidence.pdf`,
      storageUrl: `/storage/${PROJECT}/np1-evidence.pdf`,
      uploadedBy: ASSIGNEE,
    }).returning({ id: projectFiles.id });
    await setTaskCompletion(PROJECT, "planning", "np1", true, ASSIGNEE);
    await db!.delete(projectFiles).where(eq(projectFiles.id, file.id));

    await expect(finalizeTaskApproval({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      decision: "approved",
      actor: APPROVER,
      note: null,
      isProxy: false,
    })).rejects.toThrow(/证据文件/);
    expect(await loadTask("np1")).toMatchObject({ status: "pending_approval", completed: false });
  });
});
