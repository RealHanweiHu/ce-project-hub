import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { GATE_BLOCKER_TYPES, type GateBlockerType } from "../../drizzle/schema";
import {
  createActivityLog,
  createProjectGateBlocker,
  getProjectGateBlockerById,
  getProjectGateBlockers,
  resolveProjectGateBlocker,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import { assertProjectAccess, type ProjectAccess } from "../project-access";
import { getPhasesForCategory } from "../../shared/sop-templates";

function assertBlockerAuthority(access: ProjectAccess, blockerType: GateBlockerType) {
  const allowed = blockerType === "quality"
    ? access.permissions.canQualityGateBlock
    : access.permissions.canNpiGateBlock;
  if (!access.isAdmin && !allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: blockerType === "quality"
        ? "只有 QA/管理层可以设置或解除质量 Gate 阻断"
        : "只有 PE/NPI/生产/管理层可以设置或解除 NPI Gate 阻断",
    });
  }
}

function assertPhaseExists(access: ProjectAccess, phaseId: string) {
  const exists = getPhasesForCategory(access.project.category).some((phase) => phase.id === phaseId);
  if (!exists) throw new TRPCError({ code: "BAD_REQUEST", message: "项目阶段不存在" });
}

export const gateBlockersRouter = router({
  list: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) return [];
      return getProjectGateBlockers(input.projectId, input.phaseId);
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      blockerType: z.enum(GATE_BLOCKER_TYPES),
      title: z.string().trim().min(1).max(512),
      description: z.string().trim().max(5000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      assertPhaseExists(access, input.phaseId);
      assertBlockerAuthority(access, input.blockerType);

      const id = await createProjectGateBlocker({
        projectId: input.projectId,
        phaseId: input.phaseId,
        blockerType: input.blockerType,
        title: input.title,
        description: input.description ?? null,
        status: "open",
        createdBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "gate_blocker.create",
        entityType: "gate_blocker",
        entityId: String(id),
        meta: { phaseId: input.phaseId, blockerType: input.blockerType, title: input.title },
      });
      return { success: true, id };
    }),

  resolve: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const blocker = await getProjectGateBlockerById(input.id);
      if (!blocker) throw new TRPCError({ code: "NOT_FOUND", message: "Gate 阻断项不存在" });
      const access = await assertProjectAccess(blocker.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      assertBlockerAuthority(access, blocker.blockerType);

      if (blocker.status !== "resolved") {
        await resolveProjectGateBlocker(input.id, ctx.user.id);
        await createActivityLog({
          projectId: blocker.projectId,
          userId: ctx.user.id,
          action: "gate_blocker.resolve",
          entityType: "gate_blocker",
          entityId: String(input.id),
          meta: { phaseId: blocker.phaseId, blockerType: blocker.blockerType, title: blocker.title },
        });
      }
      return { success: true };
    }),
});
