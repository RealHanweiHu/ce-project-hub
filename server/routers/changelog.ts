import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectChangelog,
  createProjectChangeRecord,
  updateProjectChangeRecord,
  deleteProjectChangeRecord,
  createActivityLog,
} from "../db";
import { assertProjectAccess, assertProjectPermission } from "../project-access";
import { CHANGE_TYPES, CHANGE_STATUSES } from "../../drizzle/schema";

export const changelogRouter = router({
  /** List all changelog records for a project */
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user);
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
      const { project } = await assertProjectPermission(input.projectId, ctx.user, "canEditChangelog", "没有创建变更记录的权限");
      const id = await createProjectChangeRecord({
        ...input,
        creatorId: ctx.user.id,
        productId: project?.productId ?? null,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "change.create",
        entityType: "change",
        entityId: String(id),
        meta: { title: input.title, type: input.type, status: input.status },
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
      const access = await assertProjectAccess(input.projectId, ctx.user);

      const records = await getProjectChangelog(input.projectId);
      const record = records.find((r) => r.id === input.id);
      if (!record) throw new TRPCError({ code: "NOT_FOUND" });

      const isCreator = record.creatorId === ctx.user.id;
      const canManage = access.isAdmin || access.permissions.canEditChangelog;
      if (!isCreator && !canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有记录创建者或有管理权限的角色可以编辑" });
      }

      const { id, projectId, ...patch } = input;
      await updateProjectChangeRecord(id, patch);
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "change.update",
        entityType: "change",
        entityId: String(id),
        meta: { patch },
      });
      return { success: true };
    }),

  /** Delete a changelog record (requires canEditChangelog OR be the creator) */
  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
      projectId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);

      const records = await getProjectChangelog(input.projectId);
      const record = records.find((r) => r.id === input.id);
      if (!record) throw new TRPCError({ code: "NOT_FOUND" });

      const isCreator = record.creatorId === ctx.user.id;
      const canManage = access.isAdmin || access.permissions.canEditChangelog;
      if (!isCreator && !canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有记录创建者或有管理权限的角色可以删除" });
      }

      if (record.revisionId != null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "已并入发布版本的变更记录不可删除" });
      }

      await deleteProjectChangeRecord(input.id);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "change.delete",
        entityType: "change",
        entityId: String(input.id),
        meta: { title: record.title, type: record.type },
      });
      return { success: true };
    }),
});
