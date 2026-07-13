import { nanoid } from "nanoid";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { createActivityLog, getProjectById } from "../db";
import { getEffectiveProjectRoleById } from "../project-access";
import { ROLE_PERMISSIONS } from "./members";
import { PROJECT_CATEGORIES } from "../../drizzle/schema";
import { executeProjectTransition } from "../services/sop-blindspot-service";

export const transitionsRouter = router({
  execute: protectedProcedure.input(z.object({
    sourceProjectId: z.string(),
    targetProjectNumber: z.string().trim().min(1).max(64),
    targetName: z.string().trim().min(1).max(256),
    toCategory: z.enum(PROJECT_CATEGORIES),
    reason: z.string().trim().min(10).max(5000),
  })).mutation(async ({ ctx, input }) => {
    const role = await getEffectiveProjectRoleById(input.sourceProjectId, ctx.user.id);
    if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) throw new TRPCError({ code: "FORBIDDEN", message: "只有项目管理者可以发起受控转轨" });
    const source = await getProjectById(input.sourceProjectId);
    if (!source) throw new TRPCError({ code: "NOT_FOUND" });
    try {
      const result = await executeProjectTransition({ ...input, targetProjectId: nanoid(12), actorUserId: ctx.user.id });
      await createActivityLog({ projectId: input.sourceProjectId, userId: ctx.user.id, action: "project.lifecycle_change", entityType: "project_transition", entityId: result.targetProjectId, meta: { targetProjectId: result.targetProjectId, fromCategory: source.category, toCategory: input.toCategory, reason: input.reason, migration: result } });
      await createActivityLog({ projectId: result.targetProjectId, userId: ctx.user.id, action: "project.create", entityType: "project_transition", entityId: result.targetProjectId, meta: { sourceProjectId: input.sourceProjectId, fromCategory: source.category, toCategory: input.toCategory, reason: input.reason, migration: result } });
      return result;
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "转轨失败" }); }
  }),
});
