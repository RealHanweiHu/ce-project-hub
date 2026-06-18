import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getProjectFiles, getProjectEffectiveProcess, getProjectMembers } from "../db";
import { projectDeliverableReviews } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { listDeliverableReviews, getMyPendingReviews, submitDeliverableReview, reviewDeliverable } from "../deliverable-review-service";
import { assertProjectAccess, assertProjectAnyPermission } from "../project-access";

function preferredReviewerRoles(deliverableName: string) {
  const lower = deliverableName.toLowerCase();
  if (/电池|battery|bms|cell|pack/.test(lower)) return ["battery_safety", "cert", "qa"];
  if (/认证|安规|合规|cert|compliance|emc|fcc|ce\b|ul\b|rohs|safety/.test(lower)) return ["cert", "battery_safety", "qa"];
  if (/测试|验证|可靠|报告|检验|品质|test|qa|reliability|evt|dvt|pvt/.test(lower)) return ["qa"];
  if (/bom|物料|供应|采购|成本|替代料|supplier|supply|cost|material/.test(lower)) return ["scm"];
  return [];
}

async function pickDefaultReviewer(projectId: string, deliverableName: string, pmUserId: number | null) {
  const members = await getProjectMembers(projectId);
  const preferred = preferredReviewerRoles(deliverableName)
    .map((role) => members.find((member) => member.role === role))
    .find(Boolean);
  return preferred?.userId
    ?? pmUserId
    ?? members.find((member) => member.role === "pm" || member.role === "owner")?.userId
    ?? null;
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
      const { project } = await assertProjectAnyPermission(
        input.projectId,
        ctx.user,
        ["canEditTasks", "canEditProjectInfo"],
        "无提交交付物审核权限",
      );

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

      const reviewerUserId = input.reviewerUserId ?? await pickDefaultReviewer(input.projectId, input.deliverableName, project.pmUserId ?? null);
      if (!reviewerUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "未指定审核人，且项目未配置匹配角色或 PM" });
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
