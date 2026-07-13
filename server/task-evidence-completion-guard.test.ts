import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLogs,
  projectFiles,
  projectMembers,
  projectTasks,
  projects,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { canMutateFileForProject } from "./deliverable-access";
import { getDb } from "./db";
import { ROLE_PERMISSIONS } from "./routers/members";
import { tasksRouter } from "./routers/tasks";

const PROJECT = `evidence-guard-${Date.now()}`;
const OWNER = 9_884_001;
const PM = 9_884_002;
const ASSIGNEE = 9_884_003;

function ctx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `evidence-guard-${userId}`,
      username: null,
      passwordHash: null,
      name: `Evidence Guard ${userId}`,
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

const assigneeCaller = tasksRouter.createCaller(ctx(ASSIGNEE));
const pmCaller = tasksRouter.createCaller(ctx(PM));

async function task(taskId: string) {
  const db = await getDb();
  const [value] = await db!.select().from(projectTasks).where(and(
    eq(projectTasks.projectId, PROJECT),
    eq(projectTasks.taskId, taskId),
  ));
  return value;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(projects).values({
    id: PROJECT,
    name: "NPD v3 证据完成总闸",
    projectNumber: PROJECT,
    category: "npd",
    sopTemplateVersion: "2026-07-v3",
    customFields: { npdTemplate: { tier: "standard", packs: [] } },
    risk: "low",
    currentPhase: "planning",
    createdBy: OWNER,
    pmUserId: PM,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: PM, role: "project_manager", invitedBy: OWNER },
    { projectId: PROJECT, userId: ASSIGNEE, role: "rd_hw", invitedBy: OWNER },
  ]);
  await db.insert(projectTasks).values([
    {
      projectId: PROJECT,
      phaseId: "concept",
      taskId: "nc3",
      status: "todo",
      completed: false,
    },
    {
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      status: "todo",
      completed: false,
      assigneeUserId: ASSIGNEE,
      visibleRoles: ["rd_hw", "pm", "project_manager"],
    },
    {
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      status: "todo",
      completed: false,
      assigneeUserId: ASSIGNEE,
      visibleRoles: ["rd_hw", "scm", "pm", "project_manager"],
    },
    {
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np3",
      status: "done",
      completed: true,
      completedAt: new Date(),
    },
    {
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd1",
      status: "todo",
      completed: false,
      assigneeUserId: ASSIGNEE,
      visibleRoles: ["rd_hw", "pm", "project_manager"],
    },
    {
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd2",
      status: "todo",
      completed: false,
      assigneeUserId: ASSIGNEE,
      visibleRoles: ["rd_mech", "pm", "project_manager"],
    },
    {
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd4",
      status: "todo",
      completed: false,
      assigneeUserId: ASSIGNEE,
      visibleRoles: ["rd_hw", "pm", "project_manager"],
    },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("NPD v3 任务完成服务端总闸", () => {
  it("前置未完成时，即使轻证据有结论也不能完成", async () => {
    await expect(assigneeCaller.start({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      completed: true,
      completionNote: "BOM 与供应商表已整理",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await task("np2")).completed).toBe(false);
  });

  it("轻证据必须随完成提交非空一句话；取消完成不要求结论", async () => {
    const db = await getDb();
    await db!.update(projectTasks).set({ status: "done", completed: true, completedAt: new Date() }).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.taskId, "nc3"),
    ));

    await expect(assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      completed: true,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      completed: true,
      completionNote: "BOM 与两家候选供应商已确认",
    });
    expect((await task("np2")).completed).toBe(true);
    expect((await task("np2")).completionNote).toBe("BOM 与两家候选供应商已确认");

    await assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np2",
      completed: false,
    });
    expect((await task("np2")).completionNote).toBeNull();
  });

  it("重证据必须由任务负责人本人上传后完成，PM 不能代传代完成", async () => {
    await expect(canMutateFileForProject({
      projectId: PROJECT,
      actorId: PM,
      role: "project_manager",
      permissions: ROLE_PERMISSIONS.project_manager,
      phaseId: "planning",
      taskId: "np1",
    })).resolves.toBe(false);
    await expect(canMutateFileForProject({
      projectId: PROJECT,
      actorId: ASSIGNEE,
      role: "rd_hw",
      permissions: ROLE_PERMISSIONS.rd_hw,
      phaseId: "planning",
      taskId: "np1",
    })).resolves.toBe(true);

    await expect(assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      completed: true,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const db = await getDb();
    await db!.insert(projectFiles).values({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      deliverableName: null,
      name: "pm-upload.pdf",
      mimeType: "application/pdf",
      size: 100,
      storageKey: `${PROJECT}/pm-upload.pdf`,
      storageUrl: `/storage/${PROJECT}/pm-upload.pdf`,
      uploadedBy: PM,
    });
    await expect(pmCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      completed: true,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      completed: true,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await db!.insert(projectFiles).values({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      deliverableName: null,
      name: "owner-upload.pdf",
      mimeType: "application/pdf",
      size: 100,
      storageKey: `${PROJECT}/owner-upload.pdf`,
      storageUrl: `/storage/${PROJECT}/owner-upload.pdf`,
      uploadedBy: ASSIGNEE,
    });
    await assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np1",
      completed: true,
    });
    expect((await task("np1")).completed).toBe(true);
  });

  it("未来阶段任务即使已有文件也不能提前完成", async () => {
    const db = await getDb();
    await db!.insert(projectFiles).values({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd1",
      deliverableName: null,
      name: "future.pdf",
      mimeType: "application/pdf",
      size: 100,
      storageKey: `${PROJECT}/future.pdf`,
      storageUrl: `/storage/${PROJECT}/future.pdf`,
      uploadedBy: ASSIGNEE,
    });
    await expect(assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd1",
      completed: true,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(assigneeCaller.start({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd1",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await task("nd1")).completed).toBe(false);
  });

  it("Gate 不能从普通任务入口直接完成或撤销完成", async () => {
    await expect(pmCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "planning",
      taskId: "np3",
      completed: false,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await task("np3")).status).toBe("done");
    expect((await task("np3")).completed).toBe(true);
  });

  it("项目裁掉中间任务后，开始与完成仍继承它的上游依赖", async () => {
    const db = await getDb();
    await db!.update(projects).set({ currentPhase: "design" }).where(eq(projects.id, PROJECT));
    await db!.update(projectTasks).set({ status: "todo", completed: false, completedAt: null }).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.taskId, "np3"),
    ));
    await db!.update(projectTasks).set({ status: "skipped", completed: false }).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.taskId, "nd1"),
    ));
    await expect(assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd1",
      completed: false,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await task("nd1")).status).toBe("skipped");
    await db!.insert(projectFiles).values({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd2",
      name: "nd2-evidence.pdf",
      storageKey: `${PROJECT}/nd2-evidence.pdf`,
      storageUrl: `/storage/${PROJECT}/nd2-evidence.pdf`,
      uploadedBy: ASSIGNEE,
    });

    await expect(assigneeCaller.start({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd2",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd2",
      completed: true,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await db!.update(projectTasks).set({ status: "done", completed: true, completedAt: new Date() }).where(and(
      eq(projectTasks.projectId, PROJECT),
      eq(projectTasks.taskId, "np3"),
    ));
    await expect(assigneeCaller.start({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd2",
    })).resolves.toMatchObject({ success: true });
    await expect(assigneeCaller.setCompleted({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd2",
      completed: true,
    })).resolves.toMatchObject({ success: true });

    // nd4 还依赖缺失的 nd3。缺行是数据异常，不得被误当成审批裁剪。
    await expect(assigneeCaller.start({
      projectId: PROJECT,
      phaseId: "design",
      taskId: "nd4",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
