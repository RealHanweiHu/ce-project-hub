import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { createActivityLog } from "../db";
import { getEffectiveProjectRoleById } from "../project-access";
import { ROLE_PERMISSIONS } from "./members";
import { isSystemAdminRole } from "../../shared/system-roles";
import { PROJECT_TERMINATION_ITEM_KEYS } from "../../drizzle/schema";
import { decideProjectTermination, getProjectTerminationReview, saveProjectTerminationDraft, submitProjectTermination } from "../services/sop-blindspot-service";

async function canManage(projectId: string, userId: number, systemRole: string) {
  const role = await getEffectiveProjectRoleById(projectId, userId);
  if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
  return isSystemAdminRole(systemRole) || ROLE_PERMISSIONS[role].canEditProjectInfo;
}

export const terminationRouter = router({
  get: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    await canManage(input.projectId, ctx.user.id, ctx.user.role);
    return getProjectTerminationReview(input.projectId);
  }),
  saveDraft: protectedProcedure.input(z.object({
    projectId: z.string(), reason: z.string().trim().min(10).max(5000), sunkCostSummary: z.string().trim().min(1).max(5000), customerCommunication: z.string().trim().min(1).max(5000),
    ownerUserId: z.number().int().positive(), approverUserId: z.number().int().positive(),
    items: z.array(z.object({ itemKey: z.enum(PROJECT_TERMINATION_ITEM_KEYS), disposition: z.string().trim().min(1).max(5000), completed: z.boolean(), evidenceReference: z.string().trim().max(5000).nullable().optional() })).length(PROJECT_TERMINATION_ITEM_KEYS.length),
  })).mutation(async ({ ctx, input }) => {
    if (!await canManage(input.projectId, ctx.user.id, ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
    try { return await saveProjectTerminationDraft({ ...input, actorUserId: ctx.user.id }); }
    catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "终止评审保存失败" }); }
  }),
  submit: protectedProcedure.input(z.object({ projectId: z.string() })).mutation(async ({ ctx, input }) => {
    if (!await canManage(input.projectId, ctx.user.id, ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
    try { return await submitProjectTermination(input.projectId, ctx.user.id); }
    catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "终止评审提交失败" }); }
  }),
  decide: protectedProcedure.input(z.object({ projectId: z.string(), approve: z.boolean(), note: z.string().trim().max(5000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await canManage(input.projectId, ctx.user.id, ctx.user.role);
    try {
      const row = await decideProjectTermination({ ...input, actorUserId: ctx.user.id, allowAdmin: isSystemAdminRole(ctx.user.role) });
      await createActivityLog({ projectId: input.projectId, userId: ctx.user.id, action: "project.lifecycle_change", entityType: "termination_review", entityId: String(row.id), meta: { action: input.approve ? "approved" : "rejected", note: input.note ?? null } });
      return row;
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "终止评审批失败" }); }
  }),
});
