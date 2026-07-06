import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectGateReviews,
  createProjectGateReview,
  confirmGateReview,
  updateProjectGateReview,
  deleteProjectGateReview,
  createActivityLog,
  getGateReadiness,
  getProjectById,
} from "../db";
import { getPhasesForCategory } from "../../shared/sop-templates";
import { ROLE_PERMISSIONS } from "./members";
import { GATE_DECISIONS } from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";
import { canRoleViewInternalWorkspace } from "../file-visibility";

async function assertGateCanProceed(projectId: string, phaseId: string, decision: string) {
  if (decision === "rejected") return;
  const readiness = await getGateReadiness(projectId, phaseId);
  if (!readiness) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "无法计算 Gate 就绪度，不能通过评审" });
  }
  if (readiness.ready) return;
  const blockerText = readiness.dimensions
    .filter((dimension) => !dimension.ok)
    .flatMap((dimension) => dimension.blockers.map((blocker) => `${dimension.summary}: ${blocker}`))
    .slice(0, 8)
    .join("；");
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Gate 未就绪，不能通过或推进。请先关闭阻塞项${blockerText ? `：${blockerText}` : ""}`,
  });
}

export const gateReviewsRouter = router({
  /** List all gate reviews for a project (optionally filtered by phase) */
  list: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!canRoleViewInternalWorkspace(role)) return [];
      return getProjectGateReviews(input.projectId, input.phaseId);
    }),

  /** Create a gate review (requires canGateReview) */
  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      phaseName: z.string().default(""),
      gateName: z.string().default(""),
      reviewDate: z.string(),
      participants: z.string().optional().nullable(),
      decision: z.enum(GATE_DECISIONS).default("conditional"),
      conditions: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      const perms = role ? ROLE_PERMISSIONS[role] : null;
      // 决策权/召集权拆分：approved/conditional 是管理层签字；rejected 只是
      // 「会开了、没过」的会议记录，项目经理（召集人）可以记录。
      if (!perms || (input.decision !== "rejected"
        ? !perms.canGateReview
        : !(perms.canGateReview || perms.canConveneGateReview))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: input.decision !== "rejected"
            ? "只有管理层可以给出通过/有条件通过的 Gate 决策"
            : "只有管理层或项目经理可以记录门评审",
        });
      }
      await assertGateCanProceed(input.projectId, input.phaseId, input.decision);
      const id = await createProjectGateReview({
        ...input,
        createdBy: ctx.user.id,
      });
      const createdReview = (await getProjectGateReviews(input.projectId, input.phaseId))
        .find((review) => review.id === id);
      const roundNumber = createdReview?.roundNumber ?? 1;
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "gate.create",
        entityType: "gate_review",
        entityId: String(id),
        meta: {
          phaseId: input.phaseId,
          decision: input.decision,
          roundNumber,
        },
      });
      await emitAutomationEvent({
        action: "gate.create",
        projectId: input.projectId,
        entityType: "gate_review",
        entityId: id,
        actorId: ctx.user.id,
        after: { ...input, roundNumber, id, createdBy: ctx.user.id },
      });
      return { success: true, id };
    }),

  /** Update a gate review (requires canGateReview) */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      projectId: z.string(),
      phaseName: z.string().optional(),
      gateName: z.string().optional(),
      reviewDate: z.string().optional(),
      participants: z.string().optional().nullable(),
      decision: z.enum(GATE_DECISIONS).optional(),
      conditions: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      const perms = role ? ROLE_PERMISSIONS[role] : null;
      if (!perms || !(perms.canGateReview || perms.canConveneGateReview)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层或项目经理可以修改门评审" });
      }
      const { id, projectId, ...patch } = input;
      const reviews = await getProjectGateReviews(projectId);
      const beforeReview = reviews.find((review) => review.id === id);
      // 评审必须属于鉴权所用的 projectId，否则可用自己项目的角色改写他人项目的评审（IDOR）
      if (!beforeReview) {
        throw new TRPCError({ code: "NOT_FOUND", message: "评审记录不存在" });
      }
      const decisionChanged = patch.decision != null && patch.decision !== beforeReview.decision;
      if (decisionChanged) {
        // 改决策 = 决策权。升级（rejected→conditional/approved、conditional→approved）
        // 是放宽通过条件，必须过就绪度——否则可先建 rejected 再经 update 改 approved，
        // 绕开 create/confirmAndAdvance 的校验；降级（补条件/驳回）是收紧，不受限。
        if (!perms.canGateReview) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以修改 Gate 决策" });
        }
        const decisionRank: Record<string, number> = { rejected: 0, conditional: 1, approved: 2 };
        if (decisionRank[patch.decision!] > decisionRank[beforeReview.decision]) {
          await assertGateCanProceed(projectId, beforeReview.phaseId, patch.decision!);
        }
      }
      await updateProjectGateReview(id, patch);
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "gate.update",
        entityType: "gate_review",
        entityId: String(id),
        meta: { patch },
      });
      if (beforeReview) {
        await emitAutomationEvent({
          action: "gate.update",
          projectId,
          entityType: "gate_review",
          entityId: id,
          actorId: ctx.user.id,
          before: beforeReview as unknown as Record<string, unknown>,
          after: { ...beforeReview, ...patch } as Record<string, unknown>,
        });
      }
      return { success: true };
    }),

  /**
   * 原子化「Gate 通过/有条件通过/不通过」：评审 + 标 gate task done + 推进阶段在服务端一次完成。
   * 取代客户端分散三笔写（projects.update + tasks.setCompleted + gateReviews.create）经 600ms 防抖
   * 串起的旧路径——后者在刷新/快速操作下会部分持久化，导致「已推进但 gate task 未完成→阶段锁死」。
   */
  confirmAndAdvance: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      gateTaskId: z.string().nullable().optional(),
      phaseName: z.string().default(""),
      gateName: z.string().default(""),
      reviewDate: z.string(),
      participants: z.string().optional().nullable(),
      decision: z.enum(GATE_DECISIONS).default("approved"),
      conditions: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canGateReview) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以进行门评审" });
      }
      await assertGateCanProceed(input.projectId, input.phaseId, input.decision);
      const { reviewId, roundNumber, advancedTo } = await confirmGateReview({
        projectId: input.projectId,
        phaseId: input.phaseId,
        gateTaskId: input.gateTaskId ?? null,
        phaseName: input.phaseName,
        gateName: input.gateName,
        reviewDate: input.reviewDate,
        participants: input.participants ?? null,
        decision: input.decision,
        conditions: input.conditions ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "gate.create",
        entityType: "gate_review",
        entityId: String(reviewId),
        meta: { phaseId: input.phaseId, decision: input.decision, roundNumber, advancedTo },
      });
      await emitAutomationEvent({
        action: "gate.create",
        projectId: input.projectId,
        entityType: "gate_review",
        entityId: reviewId,
        actorId: ctx.user.id,
        after: { ...input, roundNumber, id: reviewId, createdBy: ctx.user.id },
      });
      if (advancedTo) {
        // Gate 通过推进阶段 → 通知项目群与 PM，下一阶段角色启动任务（旧行为静默推进）
        const project = await getProjectById(input.projectId);
        const nextPhase = project
          ? getPhasesForCategory(project.category).find((phase) => phase.id === advancedTo)
          : undefined;
        await emitAutomationEvent({
          action: "phase.advanced",
          projectId: input.projectId,
          entityType: "phase",
          entityId: `${input.projectId}:${advancedTo}`,
          actorId: ctx.user.id,
          after: {
            projectId: input.projectId,
            fromPhaseId: input.phaseId,
            fromPhaseName: input.phaseName || input.phaseId,
            phaseId: advancedTo,
            phaseName: nextPhase?.name ?? advancedTo,
          },
        });
      }
      return { success: true, id: reviewId, roundNumber, advancedTo };
    }),

  /** Gate 就绪度：前置/交付物/本阶段P0P1/QA-PE阻断/遗留评审条件 */
  readiness: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!canRoleViewInternalWorkspace(role)) return null;
      return getGateReadiness(input.projectId, input.phaseId);
    }),

  /** Delete a gate review (requires canGateReview) */
  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
      projectId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canGateReview) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以删除门评审" });
      }
      // 同 update：评审必须属于鉴权所用的 projectId（防跨项目 IDOR 删除）
      const reviews = await getProjectGateReviews(input.projectId);
      if (!reviews.some((review) => review.id === input.id)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "评审记录不存在" });
      }
      await deleteProjectGateReview(input.id);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "gate.delete",
        entityType: "gate_review",
        entityId: String(input.id),
      });
      return { success: true };
    }),
});
