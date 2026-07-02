import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  addComment, listComments,
  getIssueById, getChangelogRecordById,
  listNotifications, unreadCount, markRead, markAllRead,
} from "../db";
import { assertProjectAccess } from "../project-access";

/**
 * 评论按实体反查项目归属，用于成员鉴权。
 * 实体格式：issue → 全局 issue id；task → `${projectId}:${taskId}`；
 * change/changelog → 全局变更记录 id；project → projectId 本身。
 * 解析不出项目（未知类型/实体不存在）一律拒绝，防止伪造 entityId 跨项目读写评论。
 */
async function resolveCommentProjectId(entityType: string, entityId: string): Promise<string | null> {
  switch (entityType) {
    case "task": {
      const idx = entityId.indexOf(":");
      return idx > 0 ? entityId.slice(0, idx) : null;
    }
    case "issue": {
      const id = Number(entityId);
      if (!Number.isInteger(id)) return null;
      const issue = await getIssueById(id);
      return issue?.projectId ?? null;
    }
    case "change":
    case "changelog": {
      const id = Number(entityId);
      if (!Number.isInteger(id)) return null;
      const record = await getChangelogRecordById(id);
      return record?.projectId ?? null;
    }
    case "project":
      return entityId;
    default:
      return null;
  }
}

async function assertCommentAccess(
  entityType: string,
  entityId: string,
  actor: { id: number; role: string },
) {
  const projectId = await resolveCommentProjectId(entityType, entityId);
  if (!projectId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "不支持的评论对象" });
  }
  const access = await assertProjectAccess(projectId, actor);
  return { projectId, access };
}

export const commentsRouter = router({
  list: protectedProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCommentAccess(input.entityType, input.entityId, ctx.user);
      return listComments(input.entityType, input.entityId);
    }),

  add: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.string(),
      projectId: z.string().nullable().optional(),
      body: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, access } = await assertCommentAccess(input.entityType, input.entityId, ctx.user);
      if (access.role === "viewer" && !access.isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只读成员不能发表评论" });
      }
      // projectId 以服务端解析为准，不信任客户端传值
      return addComment({
        entityType: input.entityType, entityId: input.entityId,
        projectId, authorId: ctx.user.id, body: input.body,
      });
    }),
});

export const notificationsRouter = router({
  list: protectedProcedure
    .input(z.object({ unreadOnly: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => listNotifications(ctx.user.id, input?.unreadOnly ?? false)),

  unreadCount: protectedProcedure.query(({ ctx }) => unreadCount(ctx.user.id)),

  markRead: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => { await markRead(input.id); return { ok: true }; }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markAllRead(ctx.user.id);
    return { ok: true };
  }),
});
