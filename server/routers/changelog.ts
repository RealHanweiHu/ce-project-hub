import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectById,
  getProjectMember,
  getProjectChangelog,
  createProjectChangeRecord,
  updateProjectChangeRecord,
  deleteProjectChangeRecord,
} from "../db";
import { ROLE_PERMISSIONS } from "./members";
import { CHANGE_TYPES, CHANGE_STATUSES } from "../../drizzle/schema";

async function getEffectiveRole(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.createdBy === userId) return "owner" as const;
  const member = await getProjectMember(projectId, userId);
  return member?.role ?? null;
}

export const changelogRouter = router({
  /** List all changelog records for a project */
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getProjectChangelog(input.projectId);
    }),

  /** Create a changelog record (requires canEditChangelog) */
  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      number: z.string().default(""),
      type: z.enum(CHANGE_TYPES).default("other"),
      title: z.string().min(1),
      description: z.string().optional().nullable(),
      reason: z.string().optional().nullable(),
      decisionMaker: z.string().optional().nullable(),
      affectedPhases: z.array(z.string()).default([]),
      status: z.enum(CHANGE_STATUSES).default("proposed"),
      costImpact: z.string().optional().nullable(),
      scheduleImpact: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      createdDate: z.string().optional().nullable(),
      implementedDate: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditChangelog) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有创建变更记录的权限" });
      }
      const id = await createProjectChangeRecord({
        ...input,
        creatorId: ctx.user.id,
      });
      return { success: true, id };
    }),

  /** Update a changelog record (requires canEditChangelog OR be the creator) */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      projectId: z.string(),
      number: z.string().optional(),
      type: z.enum(CHANGE_TYPES).optional(),
      title: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      reason: z.string().optional().nullable(),
      decisionMaker: z.string().optional().nullable(),
      affectedPhases: z.array(z.string()).optional(),
      status: z.enum(CHANGE_STATUSES).optional(),
      costImpact: z.string().optional().nullable(),
      scheduleImpact: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      createdDate: z.string().optional().nullable(),
      implementedDate: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });

      const records = await getProjectChangelog(input.projectId);
      const record = records.find((r) => r.id === input.id);
      if (!record) throw new TRPCError({ code: "NOT_FOUND" });

      const isCreator = record.creatorId === ctx.user.id;
      const canManage = ROLE_PERMISSIONS[role].canEditChangelog;
      if (!isCreator && !canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有记录创建者或有管理权限的角色可以编辑" });
      }

      const { id, projectId, ...patch } = input;
      await updateProjectChangeRecord(id, patch);
      return { success: true };
    }),

  /** Delete a changelog record (requires canEditChangelog OR be the creator) */
  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
      projectId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });

      const records = await getProjectChangelog(input.projectId);
      const record = records.find((r) => r.id === input.id);
      if (!record) throw new TRPCError({ code: "NOT_FOUND" });

      const isCreator = record.creatorId === ctx.user.id;
      const canManage = ROLE_PERMISSIONS[role].canEditChangelog;
      if (!isCreator && !canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有记录创建者或有管理权限的角色可以删除" });
      }

      await deleteProjectChangeRecord(input.id);
      return { success: true };
    }),
});
