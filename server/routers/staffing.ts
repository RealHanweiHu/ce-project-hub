import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PROJECT_MEMBER_ROLES } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createActivityLog,
  getProjectById,
  listProjectStaffingGaps,
  transferProjectStaffingGap,
} from "../db";
import { getEffectiveProjectRoles, getUnionPermissions } from "../project-access";

async function assertManager(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  const roles = await getEffectiveProjectRoles(project, userId);
  if (!getUnionPermissions(roles).canManageMembers) {
    throw new TRPCError({ code: "FORBIDDEN", message: "没有人员配置管理权限" });
  }
}

export const staffingRouter = router({
  gaps: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertManager(input.projectId, ctx.user.id);
      return listProjectStaffingGaps(input.projectId);
    }),
  transfer: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      role: z.enum(PROJECT_MEMBER_ROLES),
      toUserId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertManager(input.projectId, ctx.user.id);
      try {
        const transferred = await transferProjectStaffingGap(
          input.projectId, input.role, input.toUserId, ctx.user.id,
        );
        await createActivityLog({
          projectId: input.projectId, userId: ctx.user.id, action: "staffing_gap.transfer",
          entityType: "staffing_gap", entityId: input.role,
          meta: { role: input.role, toUserId: input.toUserId, transferred },
        });
        return { success: true, transferred };
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "移交失败" });
      }
    }),
});
