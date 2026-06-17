import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getProjectById, getProjectMember, getProjectFiles, getProjectEffectiveProcess } from "../db";
import { projects, projectDeliverableReviews } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { listDeliverableReviews, getMyPendingReviews, submitDeliverableReview, reviewDeliverable } from "../deliverable-review-service";
import { ROLE_PERMISSIONS } from "./members";

async function getUserProjectRole(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.createdBy === userId) return "owner" as const;
  const member = await getProjectMember(projectId, userId);
  return member?.role ?? null;
}

async function assertCanView(projectId: string, user: { id: number; role: string }) {
  const project = await getProjectById(projectId);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  if (user.role === "admin") return project;
  const role = await getUserProjectRole(projectId, user.id);
  if (!role || !ROLE_PERMISSIONS[role].canView) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无访问权限" });
  }
  return project;
}

async function assertCanEdit(projectId: string, user: { id: number; role: string }) {
  const project = await assertCanView(projectId, user);
  if (user.role === "admin" || project.pmUserId === user.id) return project;
  const role = await getUserProjectRole(projectId, user.id);
  if (role === "pm") return project;
  if (role && ROLE_PERMISSIONS[role].canEditTasks) return project;
  throw new TRPCError({ code: "FORBIDDEN", message: "无编辑权限" });
}

export const deliverableReviewsRouter = router({
  list: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    await assertCanView(input.projectId, ctx.user);
    return listDeliverableReviews(input.projectId);
  }),
  myPending: protectedProcedure.query(({ ctx }) => getMyPendingReviews(ctx.user.id)),
  submit: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), deliverableName: z.string().min(1), reviewerUserId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanEdit(input.projectId, ctx.user);

      // Validation 1: there must be ≥1 file for (projectId, phaseId, deliverableName)
      const phaseFiles = await getProjectFiles(input.projectId, input.phaseId);
      const hasFile = phaseFiles.some((f) => f.deliverableName === input.deliverableName);
      if (!hasFile) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该交付物尚未上传文件，无法提交审核" });
      }

      // Validation 2: deliverableName must be in the phase's effective submission set
      const effective = await getProjectEffectiveProcess(input.projectId);
      const effPhase = effective?.phases.find((p) => p.id === input.phaseId);
      if (!effPhase || !effPhase.submittedDeliverables.includes(input.deliverableName)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该交付物不在本节点的有效提交集内" });
      }

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
