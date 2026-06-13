import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createActivityLog,
  createProjectRequirement,
  deleteProjectRequirement,
  getProjectById,
  getProjectMember,
  getProjectRequirements,
  updateProjectRequirement,
} from "../db";
import {
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_SOURCES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
} from "../../drizzle/schema";
import { ROLE_PERMISSIONS } from "./members";

async function getEffectiveRole(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.createdBy === userId) return "owner" as const;
  const member = await getProjectMember(projectId, userId);
  return member?.role ?? null;
}

const requirementPatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  source: z.enum(REQUIREMENT_SOURCES).optional(),
  sourceDetail: z.string().optional().nullable(),
  type: z.enum(REQUIREMENT_TYPES).optional(),
  priority: z.enum(REQUIREMENT_PRIORITIES).optional(),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
  owner: z.string().optional().nullable(),
  targetPhaseId: z.string().optional().nullable(),
  linkedTaskId: z.string().optional().nullable(),
  acceptanceCriteria: z.string().optional().nullable(),
  decisionNote: z.string().optional().nullable(),
});

export const requirementsRouter = router({
  /** List all demand-pool requirements for a project. */
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getProjectRequirements(input.projectId);
    }),

  /** Create a requirement. Any non-viewer project member can contribute. */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        description: z.string().optional().nullable(),
        source: z.enum(REQUIREMENT_SOURCES).default("internal"),
        sourceDetail: z.string().optional().nullable(),
        type: z.enum(REQUIREMENT_TYPES).default("functional"),
        priority: z.enum(REQUIREMENT_PRIORITIES).default("P2"),
        status: z.enum(REQUIREMENT_STATUSES).default("new"),
        owner: z.string().optional().nullable(),
        targetPhaseId: z.string().optional().nullable(),
        linkedTaskId: z.string().optional().nullable(),
        acceptanceCriteria: z.string().optional().nullable(),
        decisionNote: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditRequirements) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有维护需求池的权限" });
      }

      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const id = await createProjectRequirement({
        ...input,
        productId: project.productId ?? null,
        creatorId: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "requirement.create",
        entityType: "requirement",
        entityId: String(id),
        meta: { title: input.title, source: input.source, priority: input.priority },
      });
      return { success: true, id };
    }),

  /** Update a requirement. */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        projectId: z.string(),
        patch: requirementPatchSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditRequirements) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有维护需求池的权限" });
      }

      const rows = await getProjectRequirements(input.projectId);
      const existing = rows.find((r) => r.id === input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      await updateProjectRequirement(input.id, input.patch);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "requirement.update",
        entityType: "requirement",
        entityId: String(input.id),
        meta: { patch: input.patch },
      });
      return { success: true };
    }),

  /** Delete a requirement. */
  delete: protectedProcedure
    .input(z.object({ id: z.number(), projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditRequirements) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有维护需求池的权限" });
      }

      const rows = await getProjectRequirements(input.projectId);
      const existing = rows.find((r) => r.id === input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      await deleteProjectRequirement(input.id);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "requirement.delete",
        entityType: "requirement",
        entityId: String(input.id),
        meta: { title: existing.title },
      });
      return { success: true };
    }),
});
