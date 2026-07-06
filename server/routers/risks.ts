import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  RISK_ITEM_SEVERITIES,
  RISK_ITEM_STATUSES,
} from "../../drizzle/schema";
import {
  createActivityLog,
  createProjectRisk,
  deleteProjectRisk,
  getProjectRiskById,
  getProjectRisks,
  updateProjectRisk,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { assertProjectAccess, assertProjectPermission } from "../project-access";
import { canRoleViewInternalWorkspace } from "../file-visibility";

const nullableText = z.string().optional().nullable();

const riskPatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: nullableText,
  severity: z.enum(RISK_ITEM_SEVERITIES).optional(),
  status: z.enum(RISK_ITEM_STATUSES).optional(),
  owner: nullableText,
  mitigationPlan: nullableText,
  contingencyPlan: nullableText,
  targetDate: nullableText,
});

export const risksRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) return [];
      return getProjectRisks(input.projectId);
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      title: z.string().min(1),
      description: nullableText,
      severity: z.enum(RISK_ITEM_SEVERITIES).default("medium"),
      status: z.enum(RISK_ITEM_STATUSES).default("open"),
      owner: nullableText,
      mitigationPlan: nullableText,
      contingencyPlan: nullableText,
      targetDate: nullableText,
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectPermission(input.projectId, ctx.user, "canEditProjectInfo", "没有维护风险生命周期的权限");
      const id = await createProjectRisk({
        ...input,
        closedAt: input.status === "closed" ? new Date() : null,
        creatorId: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "risk.create",
        entityType: "risk",
        entityId: String(id),
        meta: { title: input.title, severity: input.severity, status: input.status },
      });
      return { success: true, id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      patch: riskPatchSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectRiskById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "风险项不存在" });
      await assertProjectPermission(existing.projectId, ctx.user, "canEditProjectInfo", "没有维护风险生命周期的权限");

      const patch: Parameters<typeof updateProjectRisk>[1] = { ...input.patch };
      if (patch.status === "closed" && !existing.closedAt) {
        patch.closedAt = new Date();
      } else if (patch.status && patch.status !== "closed") {
        patch.closedAt = null;
      }

      await updateProjectRisk(input.id, patch);
      await createActivityLog({
        projectId: existing.projectId,
        userId: ctx.user.id,
        action: patch.status === "closed" ? "risk.close" : "risk.update",
        entityType: "risk",
        entityId: String(input.id),
        meta: { patch: input.patch },
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectRiskById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "风险项不存在" });
      await assertProjectPermission(existing.projectId, ctx.user, "canEditProjectInfo", "没有维护风险生命周期的权限");

      await deleteProjectRisk(input.id);
      await createActivityLog({
        projectId: existing.projectId,
        userId: ctx.user.id,
        action: "risk.delete",
        entityType: "risk",
        entityId: String(input.id),
        meta: { title: existing.title },
      });
      return { success: true };
    }),
});
