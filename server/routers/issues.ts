import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectIssues,
  createProjectIssue,
  updateProjectIssue,
  deleteProjectIssue,
  createActivityLog,
} from "../db";
import { assertProjectAccess, assertProjectPermission } from "../project-access";
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  ISSUE_CATEGORIES,
} from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";

export const issuesRouter = router({
  /** List all issues for a project (optionally filtered by phase) */
  list: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user);
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
      const { project } = await assertProjectPermission(input.projectId, ctx.user, "canEditIssues", "没有创建问题的权限");
      const id = await createProjectIssue({
        ...input,
        creatorId: ctx.user.id,
        productId: project?.productId ?? null,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "issue.create",
        entityType: "issue",
        entityId: String(id),
        meta: { phaseId: input.phaseId, title: input.title, severity: input.severity },
      });
      await emitAutomationEvent({
        action: "issue.create",
        projectId: input.projectId,
        entityType: "issue",
        entityId: id,
        actorId: ctx.user.id,
        after: { ...input, id, creatorId: ctx.user.id },
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
      const access = await assertProjectAccess(input.projectId, ctx.user);

      // Check permission: canEditIssues OR be the creator
      const issues = await getProjectIssues(input.projectId);
      const issue = issues.find((i) => i.id === input.id);
      if (!issue) throw new TRPCError({ code: "NOT_FOUND" });

      const isCreator = issue.creatorId === ctx.user.id;
      const canManage = access.isAdmin || access.permissions.canEditIssues;
      if (!isCreator && !canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有问题创建者或有管理权限的角色可以编辑" });
      }

      const { id, projectId, ...patch } = input;
      await updateProjectIssue(id, patch);
      const afterIssue = { ...issue, ...patch };
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: patch.status === "closed" ? "issue.close" : "issue.update",
        entityType: "issue",
        entityId: String(id),
        meta: { patch },
      });
      await emitAutomationEvent({
        action: "issue.update",
        projectId,
        entityType: "issue",
        entityId: id,
        actorId: ctx.user.id,
        before: issue as unknown as Record<string, unknown>,
        after: afterIssue as unknown as Record<string, unknown>,
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
      const access = await assertProjectAccess(input.projectId, ctx.user);

      const issues = await getProjectIssues(input.projectId);
      const issue = issues.find((i) => i.id === input.id);
      if (!issue) throw new TRPCError({ code: "NOT_FOUND" });

      const isCreator = issue.creatorId === ctx.user.id;
      const canManage = access.isAdmin || access.permissions.canEditIssues;
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
