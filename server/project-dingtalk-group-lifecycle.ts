import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type {
  ProjectDingtalkGroupIntent,
  ProjectRow,
} from "../drizzle/schema";
import {
  activityLogs,
  projectExternalOperations,
  projects,
} from "../drizzle/schema";
import { disbandGroupChat, type CreateGroupResult } from "./_core/dingtalkGroup";
import { getDb, updateProject } from "./db";

type GroupProject = Pick<
  ProjectRow,
  "id" | "dingtalkChatId" | "dingtalkGroupOperationStatus"
>;

type GroupLifecycleDeps = {
  update?: typeof updateProject;
  disbandRemote?: typeof disbandGroupChat;
};

export class ProjectDingtalkGroupCleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDingtalkGroupCleanupError";
  }
}

export class ProjectDingtalkGroupReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDingtalkGroupReconciliationError";
  }
}

export function hasUnresolvedProjectDingtalkGroupCreation(
  project: GroupProject
): boolean {
  return (
    !project.dingtalkChatId &&
    (project.dingtalkGroupOperationStatus === "creating" ||
      project.dingtalkGroupOperationStatus === "create_unknown")
  );
}

/** Persist the create intent before the first remote byte is sent. */
export async function beginProjectDingtalkGroupCreation(
  input: {
    projectId: string;
    name: string;
    ownerUserId: string;
    memberUserIds: string[];
  },
  deps: Pick<GroupLifecycleDeps, "update"> = {}
): Promise<ProjectDingtalkGroupIntent> {
  const intent: ProjectDingtalkGroupIntent = {
    operationId: randomUUID(),
    name: input.name,
    ownerUserId: input.ownerUserId,
    memberUserIds: Array.from(new Set(input.memberUserIds)),
    requestedAt: new Date().toISOString(),
  };
  await (deps.update ?? updateProject)(input.projectId, {
    dingtalkGroupOperationStatus: "creating",
    dingtalkGroupIntent: intent,
    dingtalkGroupLastError: null,
    dingtalkGroupUpdatedAt: new Date(),
  });
  return intent;
}

export async function recordProjectDingtalkGroupCreateFailure(
  input: {
    projectId: string;
    intent: ProjectDingtalkGroupIntent;
    result: Extract<CreateGroupResult, { ok: false }>;
  },
  deps: Pick<GroupLifecycleDeps, "update"> = {}
): Promise<void> {
  await (deps.update ?? updateProject)(input.projectId, {
    dingtalkGroupOperationStatus:
      input.result.outcome === "unknown" ? "create_unknown" : "create_failed",
    dingtalkGroupIntent:
      input.result.outcome === "unknown" ? input.intent : null,
    dingtalkGroupLastError: input.result.error,
    dingtalkGroupUpdatedAt: new Date(),
  });
}

export async function checkpointProjectDingtalkGroupBound(
  input: { projectId: string; chatId: string },
  deps: Pick<GroupLifecycleDeps, "update"> = {}
): Promise<void> {
  await (deps.update ?? updateProject)(input.projectId, {
    dingtalkChatId: input.chatId,
    dingtalkGroupOperationStatus: "bound",
    dingtalkGroupIntent: null,
    dingtalkGroupLastError: null,
    dingtalkGroupUpdatedAt: new Date(),
  });
}

export async function checkpointProjectDingtalkGroupCreateRolledBack(
  projectId: string,
  error: string,
  deps: Pick<GroupLifecycleDeps, "update"> = {}
): Promise<void> {
  await (deps.update ?? updateProject)(projectId, {
    dingtalkChatId: null,
    dingtalkGroupOperationStatus: "create_failed",
    dingtalkGroupIntent: null,
    dingtalkGroupLastError: error,
    dingtalkGroupUpdatedAt: new Date(),
  });
}

export type ProjectDingtalkGroupCreationResolution =
  | { type: "not_created"; note: string }
  | { type: "bind"; chatId: string; note: string };

/**
 * Resolve a crashed/unknown create request after an administrator has checked
 * DingTalk. The advisory lock fences delete/new reservations, while the active
 * create-operation check prevents a premature manual verdict racing the POST.
 * The state transition and its audit record commit atomically.
 */
export async function reconcileProjectDingtalkGroupCreation(input: {
  projectId: string;
  actorUserId: number;
  resolution: ProjectDingtalkGroupCreationResolution;
}): Promise<{ chatId: string | null; status: "create_failed" | "bound" }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`project-external:${input.projectId}`}))`
    );

    const now = new Date();
    const [current] = await tx
      .select({
        id: projects.id,
        archived: projects.archived,
        lifecycle: projects.lifecycle,
        dingtalkChatId: projects.dingtalkChatId,
        dingtalkGroupOperationStatus: projects.dingtalkGroupOperationStatus,
        dingtalkGroupIntent: projects.dingtalkGroupIntent,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!current) {
      throw new ProjectDingtalkGroupReconciliationError("项目不存在");
    }
    if (current.archived || current.lifecycle !== "active") {
      throw new ProjectDingtalkGroupReconciliationError(
        "项目正在删除、已暂停或已停止，不能执行建群对账"
      );
    }
    if (!hasUnresolvedProjectDingtalkGroupCreation(current)) {
      throw new ProjectDingtalkGroupReconciliationError(
        "项目当前没有待对账的建群请求"
      );
    }

    const [activeCreate] = await tx
      .select({ token: projectExternalOperations.token })
      .from(projectExternalOperations)
      .where(
        and(
          eq(projectExternalOperations.projectId, input.projectId),
          eq(projectExternalOperations.kind, "create_dingtalk_group"),
          gt(projectExternalOperations.expiresAt, now)
        )
      )
      .limit(1);
    if (activeCreate) {
      throw new ProjectDingtalkGroupReconciliationError(
        "建群请求仍在执行，请等待其结束后再对账"
      );
    }

    const previousStatus = current.dingtalkGroupOperationStatus;
    const previousOperationId = current.dingtalkGroupIntent?.operationId ?? null;
    const resolvedAt = new Date();
    const patch = input.resolution.type === "bind"
      ? {
          dingtalkChatId: input.resolution.chatId,
          dingtalkGroupOperationStatus: "bound" as const,
          dingtalkGroupIntent: null,
          dingtalkGroupLastError: null,
          dingtalkGroupUpdatedAt: resolvedAt,
        }
      : {
          dingtalkChatId: null,
          dingtalkGroupOperationStatus: "create_failed" as const,
          dingtalkGroupIntent: null,
          dingtalkGroupLastError: `人工确认未建群：${input.resolution.note}`,
          dingtalkGroupUpdatedAt: resolvedAt,
        };
    const [updated] = await tx
      .update(projects)
      .set(patch)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.archived, false),
          eq(projects.lifecycle, "active"),
          isNull(projects.dingtalkChatId),
          inArray(projects.dingtalkGroupOperationStatus, [
            "creating",
            "create_unknown",
          ])
        )
      )
      .returning({
        chatId: projects.dingtalkChatId,
        status: projects.dingtalkGroupOperationStatus,
      });
    if (!updated) {
      throw new ProjectDingtalkGroupReconciliationError(
        "建群状态已变化，请刷新后重新核对"
      );
    }

    await tx.insert(activityLogs).values({
      projectId: input.projectId,
      userId: input.actorUserId,
      action: "project.dingtalk_group_reconcile",
      entityType: "project",
      entityId: input.projectId,
      meta: {
        resolution: input.resolution.type,
        note: input.resolution.note,
        chatId:
          input.resolution.type === "bind" ? input.resolution.chatId : null,
        previousStatus,
        previousOperationId,
      },
    });

    return {
      chatId: updated.chatId,
      status: updated.status as "create_failed" | "bound",
    };
  });
}

/**
 * Disband a known remote group and durably clear its handle before project rows
 * may be deleted. Any failure preserves the chatId so a paused project can retry.
 */
export async function disbandAndCheckpointProjectDingtalkGroup(
  project: GroupProject,
  deps: GroupLifecycleDeps = {}
): Promise<boolean> {
  if (!project.dingtalkChatId) return true;
  const update = deps.update ?? updateProject;
  await update(project.id, {
    dingtalkGroupOperationStatus: "disbanding",
    dingtalkGroupLastError: null,
    dingtalkGroupUpdatedAt: new Date(),
  });

  const result = await (deps.disbandRemote ?? disbandGroupChat)(
    project.dingtalkChatId
  );
  if (!result.ok) {
    await update(project.id, {
      dingtalkGroupOperationStatus: "disband_failed",
      dingtalkGroupLastError: result.error,
      dingtalkGroupUpdatedAt: new Date(),
    }).catch(error => {
      console.warn(
        "[project.group] failed to checkpoint disband failure:",
        project.id,
        error
      );
    });
    throw new ProjectDingtalkGroupCleanupError(result.error);
  }

  try {
    await update(project.id, {
      dingtalkChatId: null,
      dingtalkGroupOperationStatus: "disbanded",
      dingtalkGroupIntent: null,
      dingtalkGroupLastError: null,
      dingtalkGroupUpdatedAt: new Date(),
    });
  } catch (error) {
    throw new ProjectDingtalkGroupCleanupError(
      `钉钉群已解散，但本地 checkpoint 失败：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return true;
}
