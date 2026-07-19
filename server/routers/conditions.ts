import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createActivityLog,
  createProjectCondition,
  extendProjectCondition,
  getProjectConditionsReadiness,
  listProjectConditions,
  resolveProjectCondition,
} from "../db";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";
import { ROLE_PERMISSIONS } from "./members";
import { isSystemAdminRole } from "../../shared/system-roles";
import { isISODate } from "../../shared/scheduling";

const isoDate = z.string().refine(isISODate, "日期必须是 YYYY-MM-DD");

async function conditionAccess(projectId: string, userId: number) {
  const role = await getEffectiveRole(projectId, userId);
  if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
  return role;
}

export const conditionsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await conditionAccess(input.projectId, ctx.user.id);
      return listProjectConditions(input.projectId);
    }),

  readiness: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await conditionAccess(input.projectId, ctx.user.id);
      return getProjectConditionsReadiness(input.projectId);
    }),

  createWaiver: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      title: z.string().trim().min(1).max(256),
      description: z.string().trim().min(1).max(5000),
      ownerUserId: z.number().int().positive(),
      dueDate: isoDate,
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await conditionAccess(input.projectId, ctx.user.id);
      if (!isSystemAdminRole(ctx.user.role) && !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有创建让步单的权限" });
      }
      const row = await createProjectCondition({
        projectId: input.projectId,
        sourceType: "waiver",
        sourceId: null,
        title: input.title,
        description: input.description,
        ownerUserId: input.ownerUserId,
        dueDate: input.dueDate,
        linkedEcoProjectId: null,
        resolutionNote: null,
        createdBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "condition.create",
        entityType: "condition",
        entityId: String(row.id),
        meta: { sourceType: row.sourceType, dueDate: row.dueDate },
      });
      return row;
    }),

  extend: protectedProcedure
    .input(z.object({ projectId: z.string(), conditionId: z.number().int().positive(), dueDate: isoDate, note: z.string().trim().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const role = await conditionAccess(input.projectId, ctx.user.id);
      const condition = (await listProjectConditions(input.projectId)).find((item) => item.id === input.conditionId);
      if (!condition) throw new TRPCError({ code: "NOT_FOUND" });
      if (!isSystemAdminRole(ctx.user.role) && condition.ownerUserId !== ctx.user.id && !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await extendProjectCondition({ id: input.conditionId, projectId: input.projectId, dueDate: input.dueDate, note: input.note, updatedBy: ctx.user.id });
      await createActivityLog({ projectId: input.projectId, userId: ctx.user.id, action: "condition.extend", entityType: "condition", entityId: String(input.conditionId), meta: { dueDate: input.dueDate, note: input.note } });
      return { success: true };
    }),

  resolve: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      conditionId: z.number().int().positive(),
      resolution: z.enum(["closed", "converted_to_eco"]),
      linkedEcoProjectId: z.string().nullable().optional(),
      note: z.string().trim().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await conditionAccess(input.projectId, ctx.user.id);
      const condition = (await listProjectConditions(input.projectId)).find((item) => item.id === input.conditionId);
      if (!condition) throw new TRPCError({ code: "NOT_FOUND" });
      if (!isSystemAdminRole(ctx.user.role) && condition.ownerUserId !== ctx.user.id && !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      try {
        await resolveProjectCondition({
          id: input.conditionId,
          projectId: input.projectId,
          resolution: input.resolution,
          linkedEcoProjectId: input.linkedEcoProjectId,
          note: input.note,
          resolvedBy: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "条件项闭环失败" });
      }
      await createActivityLog({ projectId: input.projectId, userId: ctx.user.id, action: "condition.resolve", entityType: "condition", entityId: String(input.conditionId), meta: { resolution: input.resolution, linkedEcoProjectId: input.linkedEcoProjectId ?? null } });
      return { success: true };
    }),
});
