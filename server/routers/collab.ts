import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  addComment, listComments,
  listNotifications, unreadCount, markRead, markAllRead,
} from "../db";

export const commentsRouter = router({
  list: protectedProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string() }))
    .query(({ input }) => listComments(input.entityType, input.entityId)),

  add: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.string(),
      projectId: z.string().nullable().optional(),
      body: z.string().min(1),
    }))
    .mutation(({ ctx, input }) =>
      addComment({
        entityType: input.entityType, entityId: input.entityId,
        projectId: input.projectId ?? null, authorId: ctx.user.id, body: input.body,
      })
    ),
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
