import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectById,
  getProjectMember,
  getProjectTasks,
  upsertProjectTask,
  updateTaskMeta,
  getMyTasks,
  getOverdueTasks,
  getBlockedTasks,
  getProjectsByUser,
  createActivityLog,
} from "../db";
import { ROLE_PERMISSIONS } from "./members";
import { TASK_STATUSES, TASK_PRIORITIES } from "../../drizzle/schema";

async function getEffectiveRole(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.createdBy === userId) return "owner" as const;
  const member = await getProjectMember(projectId, userId);
  return member?.role ?? null;
}

export const tasksRouter = router({
  /** List all tasks for a project (optionally filtered by phase) */
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
      return getProjectTasks(input.projectId, input.phaseId);
    }),

  /** Toggle task completion (requires canEditTasks) */
  setCompleted: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      taskId: z.string(),
      completed: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
      }
      await upsertProjectTask(input.projectId, input.phaseId, input.taskId, {
        completed: input.completed,
        updatedBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: input.completed ? "task.complete" : "task.uncomplete",
        entityType: "task",
        entityId: input.taskId,
        meta: { phaseId: input.phaseId, completed: input.completed },
      });
      return { success: true };
    }),

  /** Update task instructions (requires canEditTasks) */
  setInstructions: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      taskId: z.string(),
      instructions: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
      }
      await upsertProjectTask(input.projectId, input.phaseId, input.taskId, {
        instructions: input.instructions,
        updatedBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "task.update_instructions",
        entityType: "task",
        entityId: input.taskId,
        meta: { phaseId: input.phaseId },
      });
      return { success: true };
    }),

  /** Update task visible roles (requires canEditProjectInfo = owner/manager/pm) */
  setVisibleRoles: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      taskId: z.string(),
      visibleRoles: z.array(z.string()),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Owner/管理层/PM 可修改任务可见角色" });
      }
      await upsertProjectTask(input.projectId, input.phaseId, input.taskId, {
        visibleRoles: input.visibleRoles,
        updatedBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "task.update_visible_roles",
        entityType: "task",
        entityId: input.taskId,
        meta: { phaseId: input.phaseId, visibleRoles: input.visibleRoles },
      });
      return { success: true };
    }),

  /**
   * Update task meta fields: assignee, dueDate, status, priority.
   * Requires canEditTasks permission.
   */
  setMeta: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      taskId: z.string(),
      assigneeUserId: z.number().nullable().optional(),
      dueDate: z.string().nullable().optional(),   // YYYY-MM-DD
      status: z.enum(TASK_STATUSES).optional(),
      priority: z.enum(TASK_PRIORITIES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
      }
      const { projectId, phaseId, taskId, ...patch } = input;
      const metaPatch = {
        ...patch,
        updatedBy: ctx.user.id,
        ...(patch.status === "done" ? { completedAt: new Date() } : {}),
        ...(patch.status && patch.status !== "done" ? { completedAt: null } : {}),
      };
      await updateTaskMeta(projectId, phaseId, taskId, metaPatch);
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "task.update_meta",
        entityType: "task",
        entityId: taskId,
        meta: { phaseId, patch },
      });
      return { success: true };
    }),

  /**
   * Return all non-done tasks assigned to the current user, across all projects.
   * Ordered by priority then dueDate.
   */
  myTasks: protectedProcedure
    .query(async ({ ctx }) => {
      return getMyTasks(ctx.user.id);
    }),

  /**
   * Return all overdue tasks (dueDate < today, status != done).
   * Admin sees all projects; regular users see only their accessible projects.
   */
  overdue: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role === "admin") {
        return getOverdueTasks();
      }
      const userProjects = await getProjectsByUser(ctx.user.id);
      const projectIds = userProjects.map((p) => p.id);
      return getOverdueTasks(projectIds);
    }),

  /**
   * Return all blocked tasks (status = 'blocked').
   * Admin sees all projects; regular users see only their accessible projects.
   */
  blocked: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role === "admin") {
        return getBlockedTasks();
      }
      const userProjects = await getProjectsByUser(ctx.user.id);
      const projectIds = userProjects.map((p) => p.id);
      return getBlockedTasks(projectIds);
    }),
});
