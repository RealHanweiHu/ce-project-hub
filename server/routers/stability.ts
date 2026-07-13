import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  confirmProjectStabilityReport,
  createActivityLog,
  createProjectStabilityReport,
  getProjectById,
  getProjectStabilityReadiness,
  listProjectStabilityReports,
} from "../db";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";
import { ROLE_PERMISSIONS } from "./members";
import { isSystemAdminRole } from "../../shared/system-roles";
import { isISODate } from "../../shared/scheduling";

const isoDate = z.string().refine(isISODate, "日期必须是 YYYY-MM-DD");
const basisPoints = z.number().int().min(0).max(10_000);

export const stabilityRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
      return listProjectStabilityReports(input.projectId);
    }),

  readiness: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
      return getProjectStabilityReadiness(input.projectId);
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      periodStart: isoDate,
      periodEnd: isoDate,
      outputQuantity: z.number().int().min(0),
      targetOutputQuantity: z.number().int().positive(),
      fpyBasisPoints: basisPoints,
      targetFpyBasisPoints: z.number().int().min(1).max(10_000),
      capacityAttainmentBasisPoints: basisPoints,
      qualityEvents: z.string().trim().max(5000).nullable().optional(),
      summary: z.string().trim().max(5000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const row = await createProjectStabilityReport({
          ...input,
          revisionId: project.resultRevisionId ?? null,
          qualityEvents: input.qualityEvents ?? null,
          summary: input.summary ?? null,
          createdBy: ctx.user.id,
        });
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "stability.report_create",
          entityType: "stability_report",
          entityId: String(row.id),
          meta: { periodStart: row.periodStart, periodEnd: row.periodEnd },
        });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "稳定记录创建失败" });
      }
    }),

  confirm: protectedProcedure
    .input(z.object({ projectId: z.string(), reportId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!isSystemAdminRole(ctx.user.role) && role !== "qa") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有 QA 可以确认稳定期记录" });
      }
      await confirmProjectStabilityReport(input.reportId, input.projectId, ctx.user.id);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "stability.report_confirm",
        entityType: "stability_report",
        entityId: String(input.reportId),
      });
      return { success: true };
    }),
});
