import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectById,
  getProjectMember,
  getProjectPhases,
  upsertProjectPhase,
  createActivityLog,
} from "../db";
import { ROLE_PERMISSIONS } from "./members";

async function getEffectiveRole(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.createdBy === userId) return "owner" as const;
  const member = await getProjectMember(projectId, userId);
  return member?.role ?? null;
}

export const phasesRouter = router({
  /** List all phase records for a project */
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getProjectPhases(input.projectId);
    }),

  /** Upsert a phase's dates and notes (requires canEditProjectInfo = owner/manager/pm) */
  upsert: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Owner/管理层/PM 可修改阶段日期" });
      }
      await upsertProjectPhase(input.projectId, input.phaseId, {
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        notes: input.notes ?? null,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "phase.update_dates",
        entityType: "phase",
        entityId: input.phaseId,
        meta: {
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          notesChanged: input.notes !== undefined,
        },
      });
      return { success: true };
    }),
});
