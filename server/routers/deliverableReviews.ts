import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getProjectFiles, getProjectEffectiveProcess, getProjectMembers } from "../db";
import { projectDeliverableReviews } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { listDeliverableReviews, getMyPendingReviews, submitDeliverableReview, reviewDeliverable } from "../deliverable-review-service";
import { assertProjectAccess } from "../project-access";
import { canSubmitDeliverableEvidence } from "../deliverable-access";
import { canRoleReviewDeliverables, preferredDeliverableReviewerRoles } from "../../shared/deliverable-permissions";

function preferredReviewerRoles(deliverableName: string) {
  return preferredDeliverableReviewerRoles(deliverableName);
}

async function pickDefaultReviewer(
  projectId: string,
  deliverableName: string,
  pmUserId: number | null,
  excludeUserId: number | null = null,
) {
  const members = await getProjectMembers(projectId);
  const notExcluded = (id: number | null | undefined) => id != null && id !== excludeUserId;
  // 优先匹配角色成员（回避提交人），再退到 PM，再退到任一非只读成员——始终不落到提交人自己
  const preferred = preferredReviewerRoles(deliverableName)
    .map((role) => members.find((member) => member.role === role && member.userId !== excludeUserId))
    .find(Boolean);
  if (notExcluded(preferred?.userId)) return preferred!.userId;
  if (notExcluded(pmUserId)) return pmUserId;
  const fallback = members.find(
    (member) => member.userId !== excludeUserId && member.role !== "viewer",
  );
  return fallback?.userId ?? null;
}

export const deliverableReviewsRouter = router({
  list: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    await assertProjectAccess(input.projectId, ctx.user);
    return listDeliverableReviews(input.projectId);
  }),
  myPending: protectedProcedure.query(({ ctx }) => getMyPendingReviews(ctx.user.id)),
  submit: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), deliverableName: z.string().min(1), reviewerUserId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      const { project } = access;

      // Validation 1: there must be ≥1 file for (projectId, phaseId, deliverableName)
      const phaseFiles = await getProjectFiles(input.projectId, input.phaseId);
      const matchingFiles = phaseFiles.filter((f) => f.deliverableName === input.deliverableName);
      const hasFile = matchingFiles.length > 0;
      if (!hasFile) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该交付物尚未上传文件，无法提交审核" });
      }

      // Validation 2: deliverableName must be in the phase's effective submission set
      const effective = await getProjectEffectiveProcess(input.projectId);
      const effPhase = effective?.phases.find((p) => p.id === input.phaseId);
      if (!effPhase || !effPhase.submittedDeliverables.includes(input.deliverableName)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该交付物不在本节点的有效提交集内" });
      }
      const canSubmit = await canSubmitDeliverableEvidence({
        projectId: input.projectId,
        actorId: ctx.user.id,
        role: access.role,
        permissions: access.permissions,
        phaseId: input.phaseId,
        deliverableName: input.deliverableName,
        files: matchingFiles,
      });
      if (!canSubmit) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无提交交付物审核权限" });
      }

      // 显式指定自己为审核人 → 拒绝（安全/电池等硬证据不得自审自批，须第二人复核）
      if (input.reviewerUserId != null && input.reviewerUserId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能指定自己为审核人，需第二人复核" });
      }
      const reviewerUserId = input.reviewerUserId
        ?? await pickDefaultReviewer(input.projectId, input.deliverableName, project.pmUserId ?? null, ctx.user.id);
      if (!reviewerUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "未指定审核人，且项目内无其他可复核成员" });
      const members = await getProjectMembers(input.projectId);
      const reviewerRole =
        reviewerUserId === project.createdBy ? "owner"
        : reviewerUserId === project.pmUserId ? "pm"
        : members.find((member) => member.userId === reviewerUserId)?.role ?? null;
      if (!canRoleReviewDeliverables(reviewerRole)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "审核人必须是项目内非只读角色" });
      }
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
