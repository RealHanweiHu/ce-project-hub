import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { TAILORING_REASONS } from "../../drizzle/schema";
import {
  createActivityLog,
  createProjectTailoringRequest,
  getProjectById,
  getProjectEffectiveProcess,
  listDeliverableOverrides,
  listProjectTailoring,
  reviewProjectTailoring,
  revokeProjectTailoring,
  setDeliverableOverride,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { ROLE_PERMISSIONS } from "./members";
import { getDeliverableLibrary } from "../../shared/effective-process";
import { getEffectiveProjectRoleById as getUserProjectRole } from "../project-access";

const tailoringTargetSchema = z.union([
  z.object({ scope: z.literal("phase"), phaseId: z.string().min(1) }),
  z.object({ scope: z.literal("task"), phaseId: z.string().min(1), taskId: z.string().min(1) }),
]);

async function assertCanView(projectId: string, user: { id: number; role: string }) {
  const project = await getProjectById(projectId);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  if (user.role === "admin") return project;
  const role = await getUserProjectRole(projectId, user.id);
  if (!role || !ROLE_PERMISSIONS[role].canView) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无访问权限" });
  }
  return project;
}

async function assertCanProposeOrOverride(projectId: string, user: { id: number; role: string }) {
  const project = await assertCanView(projectId, user);
  if (user.role === "admin" || project.pmUserId === user.id) return project;
  const role = await getUserProjectRole(projectId, user.id);
  if (role === "pm") return project;
  throw new TRPCError({ code: "FORBIDDEN", message: "仅项目 PM 或管理员可调整流程裁剪" });
}

function assertAdmin(user: { role: string }) {
  if (user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可审批流程裁剪" });
  }
}

export const tailoringRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanView(input.projectId, ctx.user);
      return listProjectTailoring(input.projectId);
    }),

  propose: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      reasonType: z.enum(TAILORING_REASONS),
      reasonNote: z.string().optional(),
      targets: z.array(tailoringTargetSchema).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCanProposeOrOverride(input.projectId, ctx.user);
      const id = await createProjectTailoringRequest({
        projectId: input.projectId,
        reasonType: input.reasonType,
        reasonNote: input.reasonNote,
        targets: input.targets,
        proposedBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "tailoring.propose",
        entityType: "tailoring",
        entityId: String(id),
        meta: { reasonType: input.reasonType, targets: input.targets },
      });
      return { success: true, id } as const;
    }),

  review: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      decision: z.enum(["approved", "rejected"]),
      reviewNote: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user);
      const projectId = await reviewProjectTailoring({
        id: input.id,
        decision: input.decision,
        reviewedBy: ctx.user.id,
        reviewNote: input.reviewNote,
      });
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "tailoring.review",
        entityType: "tailoring",
        entityId: String(input.id),
        meta: { decision: input.decision },
      });
      return { success: true } as const;
    }),

  revoke: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      reviewNote: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user);
      const projectId = await revokeProjectTailoring({
        id: input.id,
        reviewedBy: ctx.user.id,
        reviewNote: input.reviewNote,
      });
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "tailoring.revoke",
        entityType: "tailoring",
        entityId: String(input.id),
      });
      return { success: true } as const;
    }),

  effectiveProcess: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanView(input.projectId, ctx.user);
      const process = await getProjectEffectiveProcess(input.projectId);
      if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
      return { phases: process.phases } as const;
    }),

  deliverableLibrary: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await assertCanView(input.projectId, ctx.user);
      return getDeliverableLibrary(project.category);
    }),

  deliverableOverrides: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanView(input.projectId, ctx.user);
      return listDeliverableOverrides(input.projectId);
    }),

  setDeliverableOverride: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      nodePhaseId: z.string(),
      deliverableName: z.string().min(1),
      action: z.enum(["add", "remove", "clear"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCanProposeOrOverride(input.projectId, ctx.user);
      await setDeliverableOverride({
        projectId: input.projectId,
        nodePhaseId: input.nodePhaseId,
        deliverableName: input.deliverableName,
        action: input.action,
        createdBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "tailoring.deliverable_override",
        entityType: "deliverable",
        entityId: `${input.nodePhaseId}:${input.deliverableName}`,
        meta: { action: input.action },
      });
      return { success: true } as const;
    }),
});
