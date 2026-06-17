import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { projects, projectMembers, projectDeliverableReviews } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { listDeliverableReviews, getMyPendingReviews, submitDeliverableReview, reviewDeliverable } from "../deliverable-review-service";

async function assertCanEdit(projectId: string, user: { id: number; role: string }) {
  if (user.role === "admin") return;
  const db = await getDb();
  const [proj] = await db!.select({ pmUserId: projects.pmUserId, createdBy: projects.createdBy }).from(projects).where(eq(projects.id, projectId));
  if (!proj) throw new TRPCError({ code: "NOT_FOUND" });
  if (proj.pmUserId === user.id || proj.createdBy === user.id) return;
  const m = await db!.select({ role: projectMembers.role }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)));
  if (m[0] && m[0].role !== "viewer") return;
  throw new TRPCError({ code: "FORBIDDEN", message: "无编辑权限" });
}

export const deliverableReviewsRouter = router({
  list: protectedProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => listDeliverableReviews(input.projectId)),
  myPending: protectedProcedure.query(({ ctx }) => getMyPendingReviews(ctx.user.id)),
  submit: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), deliverableName: z.string().min(1), reviewerUserId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanEdit(input.projectId, ctx.user);
      const db = await getDb();
      const [proj] = await db!.select({ pmUserId: projects.pmUserId }).from(projects).where(eq(projects.id, input.projectId));
      const reviewerUserId = input.reviewerUserId ?? proj?.pmUserId;
      if (!reviewerUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "未指定审核人且项目无 PM" });
      await submitDeliverableReview({ projectId: input.projectId, phaseId: input.phaseId, deliverableName: input.deliverableName, reviewerUserId, submittedBy: ctx.user.id });
      return { success: true } as const;
    }),
  review: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), deliverableName: z.string().min(1), decision: z.enum(["approved", "rejected"]), note: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [r] = await db!.select({ reviewerUserId: projectDeliverableReviews.reviewerUserId })
        .from(projectDeliverableReviews)
        .where(and(eq(projectDeliverableReviews.projectId, input.projectId), eq(projectDeliverableReviews.phaseId, input.phaseId), eq(projectDeliverableReviews.deliverableName, input.deliverableName)));
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "无该审核记录" });
      if (ctx.user.role !== "admin" && r.reviewerUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "仅指定审核人可审" });
      await reviewDeliverable({ projectId: input.projectId, phaseId: input.phaseId, deliverableName: input.deliverableName, decision: input.decision, reviewedBy: ctx.user.id, note: input.note ?? null });
      return { success: true } as const;
    }),
});
