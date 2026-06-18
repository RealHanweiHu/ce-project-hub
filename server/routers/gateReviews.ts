import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectGateReviews,
  createProjectGateReview,
  updateProjectGateReview,
  deleteProjectGateReview,
  createActivityLog,
  getGateReadiness,
} from "../db";
import { ROLE_PERMISSIONS } from "./members";
import { GATE_DECISIONS } from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";

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
      if (!role || !ROLE_PERMISSIONS[role].canGateReview) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以进行门评审" });
      }
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
      if (!role || !ROLE_PERMISSIONS[role].canGateReview) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以修改门评审" });
      }
      const { id, projectId, ...patch } = input;
      const reviews = await getProjectGateReviews(projectId);
      const beforeReview = reviews.find((review) => review.id === id);
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

  /** Gate 就绪度（4 维：前置/交付物/本阶段P0P1/遗留评审条件） */
  readiness: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
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
