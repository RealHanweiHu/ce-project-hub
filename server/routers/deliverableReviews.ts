import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getProjectById, getProjectFiles, getProjectEffectiveProcess } from "../db";
import { PROJECT_MEMBER_ROLES, projectDeliverableReviews } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import {
  listDeliverableReviews,
  getMyPendingReviews,
  submitDeliverableReview,
  reviewDeliverable,
  pickDefaultDeliverableReviewer,
} from "../deliverable-review-service";
import { assertProjectAccess, getEffectiveProjectRoles, resolveProjectActedAsRole } from "../project-access";
import { canSubmitDeliverableEvidence } from "../deliverable-access";
import { canRoleReviewDeliverables, preferredDeliverableReviewerRoles } from "../../shared/deliverable-permissions";
import { isSystemAdminRole } from "../../shared/system-roles";
import { redlineKindForDeliverable } from "../../shared/redline-four-eyes";
import { isProjectMemberRole } from "../../shared/project-roles";
import { findRedlineReviewerEscalation, noRedlineReviewerMessage } from "../redline-four-eyes-service";

function preferredReviewerRoles(deliverableName: string) {
  return preferredDeliverableReviewerRoles(deliverableName);
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
        roles: access.roles,
        permissions: access.permissions,
        phaseId: input.phaseId,
        deliverableName: input.deliverableName,
        files: matchingFiles,
      });
      if (!canSubmit) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无提交交付物审核权限" });
      }

      const isRedline = !!redlineKindForDeliverable(project, input.phaseId, input.deliverableName);
      if (isRedline && input.reviewerUserId != null && input.reviewerUserId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能指定自己为审核人，需第二人复核" });
      }
      let escalation: Awaited<ReturnType<typeof findRedlineReviewerEscalation>> = null;
      let reviewerUserId = input.reviewerUserId
        ?? await pickDefaultDeliverableReviewer({
          projectId: input.projectId,
          deliverableName: input.deliverableName,
          pmUserId: project.pmUserId ?? null,
          excludeUserId: isRedline ? ctx.user.id : null,
        });
      const requiredReviewerRoles = preferredReviewerRoles(input.deliverableName);
      const escalationRole = requiredReviewerRoles.find(isProjectMemberRole) ?? "qa";
      if (!reviewerUserId && isRedline) {
        escalation = await findRedlineReviewerEscalation({
          projectId: input.projectId,
          role: escalationRole,
          submitterUserId: ctx.user.id,
        });
        reviewerUserId = escalation?.userId ?? null;
      }
      if (!reviewerUserId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: isRedline ? noRedlineReviewerMessage(escalationRole) : "未指定审核人，且项目内无其他可复核成员" });
      }
      const reviewerRoles = await getEffectiveProjectRoles(project, reviewerUserId);
      if (!escalation && !Array.from(reviewerRoles).some((role) => canRoleReviewDeliverables(role))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "审核人必须是项目内非只读角色" });
      }
      if (!escalation && requiredReviewerRoles.length > 0 && !Array.from(reviewerRoles).some((role) => requiredReviewerRoles.includes(role))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `该交付物需由 ${requiredReviewerRoles.join("/")} 角色审核`,
        });
      }
      await submitDeliverableReview({ projectId: input.projectId, phaseId: input.phaseId, deliverableName: input.deliverableName, reviewerUserId, submittedBy: ctx.user.id });
      return { success: true } as const;
    }),
  review: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), deliverableName: z.string().min(1), decision: z.enum(["approved", "rejected"]), note: z.string().nullable().optional(), actedAsRole: z.enum(PROJECT_MEMBER_ROLES).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [r] = await db!.select({
        reviewerUserId: projectDeliverableReviews.reviewerUserId,
        submittedBy: projectDeliverableReviews.submittedBy,
      })
        .from(projectDeliverableReviews)
        .where(and(eq(projectDeliverableReviews.projectId, input.projectId), eq(projectDeliverableReviews.phaseId, input.phaseId), eq(projectDeliverableReviews.deliverableName, input.deliverableName)));
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "无该审核记录" });
      if (!isSystemAdminRole(ctx.user.role) && r.reviewerUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "仅指定审核人可审" });
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
      const preferred = preferredReviewerRoles(input.deliverableName);
      let signing: Awaited<ReturnType<typeof resolveProjectActedAsRole>> | null = null;
      if (!isSystemAdminRole(ctx.user.role)) {
        const redline = redlineKindForDeliverable(project, input.phaseId, input.deliverableName);
        const escalationRole = preferred.find(isProjectMemberRole) ?? "qa";
        const escalation = redline ? await findRedlineReviewerEscalation({
          projectId: input.projectId,
          role: escalationRole,
          submitterUserId: r.submittedBy,
        }) : null;
        if (escalation?.userId === ctx.user.id) {
          signing = { role: escalation.actedAsRole, viaDelegationId: escalation.viaDelegationId, candidates: [escalation.actedAsRole] };
        } else {
          await assertProjectAccess(input.projectId, ctx.user);
          try {
            signing = await resolveProjectActedAsRole({
              project,
              userId: ctx.user.id,
              requestedRole: input.actedAsRole,
              eligible: (role) => preferred.length > 0
                ? preferred.includes(role)
                : canRoleReviewDeliverables(role),
            });
          } catch (error) {
            // 红线对象的"被指派审核人"本人（前面已校验 reviewerUserId === 当前人）
            // 是提交时经升级链指派的，可能不持有偏好角色（管理层代签/系统兜底/
            // 升级人选在两次解析间漂移）。此时按升级角色留痕放行，而不是把
            // 自己的待审死锁在"没有可用角色"里——失败必须给出路（设计 §2.3）。
            if (redline) {
              signing = { role: escalationRole, viaDelegationId: null, candidates: [escalationRole] };
            } else {
              throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "签字角色无效" });
            }
          }
        }
      }
      await reviewDeliverable({
        projectId: input.projectId, phaseId: input.phaseId, deliverableName: input.deliverableName,
        decision: input.decision, reviewedBy: ctx.user.id, note: input.note ?? null,
        actedAsRole: signing?.role ?? (isSystemAdminRole(ctx.user.role) ? "manager" : null),
        viaDelegationId: signing?.viaDelegationId ?? null,
      });
      return { success: true } as const;
    }),
});
