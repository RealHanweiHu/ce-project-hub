import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { activityLogs, projects } from "../drizzle/schema";
import { getDb } from "./db";
import {
  releaseProjectExternalOperation,
  reserveProjectExternalOperation,
} from "./project-external-operation";
import { projectsRouter } from "./routers/projects";

const PROJECT = `group-unknown-${Date.now().toString().slice(-8)}`;
const BIND_PROJECT = `group-bind-${Date.now().toString().slice(-8)}`;
const USER = 986751;
const adminUser = {
  id: USER,
  role: "admin",
  name: "group unknown owner",
  email: null,
  username: null,
  passwordHash: null,
  canCreateProject: true,
  mobile: null,
  dingtalkUserId: null,
  dingtalkCorpUserId: null,
};
const ctx = { user: adminUser } as never;
const unauthorizedCtx = {
  user: {
    ...adminUser,
    id: USER + 1,
    role: "member",
    name: "unauthorized member",
    canCreateProject: false,
  },
} as never;

function unknownGroupProject(id: string) {
  return {
    id,
    name: "建群结果未知",
    projectNumber: id,
    category: "npd" as const,
    risk: "low" as const,
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "active" as const,
    dingtalkGroupOperationStatus: "create_unknown" as const,
    dingtalkGroupIntent: {
      operationId: `unknown-operation-${id}`,
      name: "project group",
      ownerUserId: "owner",
      memberUserIds: ["member"],
      requestedAt: new Date().toISOString(),
    },
    dingtalkGroupLastError: "response lost",
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db
    .insert(projects)
    .values([unknownGroupProject(PROJECT), unknownGroupProject(BIND_PROJECT)]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(activityLogs)
    .where(inArray(activityLogs.projectId, [PROJECT, BIND_PROJECT]));
  await db
    .delete(projects)
    .where(inArray(projects.id, [PROJECT, BIND_PROJECT]));
});

describe("projects.delete unknown DingTalk group outcome guard", () => {
  it("keeps the project until an authorized, audited not-created verdict unblocks deletion", async () => {
    await expect(
      projectsRouter.createCaller(ctx).delete({ id: PROJECT })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      projectsRouter.createCaller(unauthorizedCtx).reconcileDingtalkGroupCreation({
        projectId: PROJECT,
        resolution: {
          type: "not_created",
          note: "已在钉钉管理后台核对",
        },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [blockedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(blockedProject).toMatchObject({
      lifecycle: "active",
      dingtalkChatId: null,
      dingtalkGroupOperationStatus: "create_unknown",
      dingtalkGroupLastError: "response lost",
    });

    await expect(
      projectsRouter.createCaller(ctx).reconcileDingtalkGroupCreation({
        projectId: PROJECT,
        resolution: {
          type: "not_created",
          note: "已在钉钉管理后台核对，无对应群聊",
        },
      })
    ).resolves.toMatchObject({
      success: true,
      chatId: null,
      status: "create_failed",
    });

    const [resolvedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(resolvedProject).toMatchObject({
      dingtalkChatId: null,
      dingtalkGroupOperationStatus: "create_failed",
      dingtalkGroupIntent: null,
    });
    expect(resolvedProject?.dingtalkGroupLastError).toContain("人工确认未建群");

    const [audit] = await db
      .select()
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.projectId, PROJECT),
          eq(activityLogs.action, "project.dingtalk_group_reconcile")
        )
      );
    expect(audit).toMatchObject({
      userId: USER,
      entityType: "project",
      entityId: PROJECT,
      meta: {
        resolution: "not_created",
        previousStatus: "create_unknown",
        previousOperationId: `unknown-operation-${PROJECT}`,
      },
    });

    await expect(
      projectsRouter.createCaller(ctx).delete({ id: PROJECT })
    ).resolves.toMatchObject({ success: true });
    const [deletedProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(deletedProject).toBeUndefined();
  });

  it("refuses reconciliation while creation is active, then can bind the verified chatId once", async () => {
    const reservation = await reserveProjectExternalOperation(
      [BIND_PROJECT],
      "create_dingtalk_group"
    );
    try {
      await expect(
        projectsRouter.createCaller(ctx).reconcileDingtalkGroupCreation({
          projectId: BIND_PROJECT,
          resolution: {
            type: "bind",
            chatId: "verified-chat-id",
            note: "已在钉钉群管理中找到实际群聊",
          },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await releaseProjectExternalOperation(reservation.token);
    }

    await expect(
      projectsRouter.createCaller(ctx).reconcileDingtalkGroupCreation({
        projectId: BIND_PROJECT,
        resolution: {
          type: "bind",
          chatId: "verified-chat-id",
          note: "已在钉钉群管理中找到实际群聊",
        },
      })
    ).resolves.toMatchObject({
      success: true,
      chatId: "verified-chat-id",
      status: "bound",
    });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, BIND_PROJECT));
    expect(project).toMatchObject({
      dingtalkChatId: "verified-chat-id",
      dingtalkGroupOperationStatus: "bound",
      dingtalkGroupIntent: null,
      dingtalkGroupLastError: null,
    });

    await expect(
      projectsRouter.createCaller(ctx).reconcileDingtalkGroupCreation({
        projectId: BIND_PROJECT,
        resolution: {
          type: "not_created",
          note: "试图覆盖已绑定结论",
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
