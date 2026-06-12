import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectById,
  getProjectMember,
  getProjectIssues,
  createProjectIssue,
  updateProjectIssue,
  deleteProjectIssue,
  createActivityLog,
} from "../db";
import { ROLE_PERMISSIONS } from "./members";
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  ISSUE_CATEGORIES,
} from "../../drizzle/schema";

async function getEffectiveRole(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.createdBy === userId) return "owner" as const;
  const member = await getProjectMember(projectId, userId);
  return member?.role ?? null;
}

export const issuesRouter = router({
  /** List all issues for a project (optionally filtered by phase) */
  list: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getProjectIssues(input.projectId, input.phaseId);
    }),

  /** Create a new issue (requires canEditIssues) */
  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      title: z.string().min(1),
      description: z.string().optional().nullable(),
      severity: z.enum(ISSUE_SEVERITIES).default("P2"),
      status: z.enum(ISSUE_STATUSES).default("open"),
      category: z.enum(ISSUE_CATEGORIES).default("other"),
      owner: z.string().optional().nullable(),
      reporter: z.string().optional().nullable(),
      foundDate: z.string().optional().nullable(),
      targetDate: z.string().optional().nullable(),
      rootCause: z.string().optional().nullable(),
      solution: z.string().optional().nullable(),
      relatedTaskId: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditIssues) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有创建问题的权限" });
      }
      const id = await createProjectIssue({
        ...input,
        creatorId: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "issue.create",
        entityType: "issue",
        entityId: String(id),
        meta: { phaseId: input.phaseId, title: input.title, severity: input.severity },
      });
      return { success: true, id };
    }),

  /** Update an issue (requires canEditIssues OR be the creator) */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      projectId: z.string(),
      title: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      severity: z.enum(ISSUE_SEVERITIES).optional(),
      status: z.enum(ISSUE_STATUSES).optional(),
      category: z.enum(ISSUE_CATEGORIES).optional(),
      owner: z.string().optional().nullable(),
      reporter: z.string().optional().nullable(),
      foundDate: z.string().optional().nullable(),
      targetDate: z.string().optional().nullable(),
      closedDate: z.string().optional().nullable(),
      rootCause: z.string().optional().nullable(),
      solution: z.string().optional().nullable(),
      relatedTaskId: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });

      // Check permission: canEditIssues OR be the creator
      const issues = await getProjectIssues(input.projectId);
      const issue = issues.find((i) => i.id === input.id);
      if (!issue) throw new TRPCError({ code: "NOT_FOUND" });

      const isCreator = issue.creatorId === ctx.user.id;
      const canManage = ROLE_PERMISSIONS[role].canEditIssues;
      if (!isCreator && !canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有问题创建者或有管理权限的角色可以编辑" });
      }

      const { id, projectId, ...patch } = input;
      await updateProjectIssue(id, patch);
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: patch.status === "closed" ? "issue.close" : "issue.update",
        entityType: "issue",
        entityId: String(id),
        meta: { patch },
      });
      return { success: true };
    }),

  /** Delete an issue (requires canEditIssues OR be the creator) */
  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
      projectId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });

      const issues = await getProjectIssues(input.projectId);
      const issue = issues.find((i) => i.id === input.id);
      if (!issue) throw new TRPCError({ code: "NOT_FOUND" });

      const isCreator = issue.creatorId === ctx.user.id;
      const canManage = ROLE_PERMISSIONS[role].canEditIssues;
      if (!isCreator && !canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有问题创建者或有管理权限的角色可以删除" });
      }

      await deleteProjectIssue(input.id);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "issue.delete",
        entityType: "issue",
        entityId: String(input.id),
        meta: { title: issue.title },
      });
      return { success: true };
    }),
});
