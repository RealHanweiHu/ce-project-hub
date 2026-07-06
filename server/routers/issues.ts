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
import { canRoleViewInternalWorkspace } from "../file-visibility";
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
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) return [];
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

      // P0/P1 降级会使问题退出 Gate 的 critical_issues 阻塞集，等价于绕过 QA 关闭
      // 确认——与关闭同权：只有 canCloseIssues（QA/管理层）可以降级。升级不受限。
      if (input.severity && input.severity !== issue.severity) {
        const rank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
        const isCriticalDowngrade =
          (issue.severity === "P0" || issue.severity === "P1") &&
          rank[input.severity] > rank[issue.severity];
        if (isCriticalDowngrade && !access.isAdmin && !access.permissions.canCloseIssues) {
          throw new TRPCError({ code: "FORBIDDEN", message: "P0/P1 降级会解除 Gate 阻塞，只有 QA/管理层可以降级" });
        }
      }

      const { id, projectId, ...inputPatch } = input;
      const patch: Parameters<typeof updateProjectIssue>[1] = { ...inputPatch };
      if (patch.status === "closed" && issue.status !== "closed") {
        if (!access.isAdmin && !access.permissions.canCloseIssues) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有 QA/管理层可以确认问题关闭" });
        }
        patch.verifiedBy = ctx.user.id;
        patch.verifiedAt = new Date();
        patch.closedDate = patch.closedDate ?? new Date().toISOString().slice(0, 10);
      } else if (patch.status && patch.status !== "closed") {
        patch.verifiedBy = null;
        patch.verifiedAt = null;
      }
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
