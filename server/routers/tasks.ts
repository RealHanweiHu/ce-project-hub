import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectTasks,
  upsertProjectTask,
  setTaskCompletion,
  setTaskApprovalConfig,
  updateTaskMeta,
  getMyTasks,
  getOverdueTasks,
  getBlockedTasks,
  getProjectsByUser,
  createActivityLog,
  setTaskDeliverable,
} from "../db";
import {
  applyProjectSchedule,
  computeProjectDelayImpact,
  rescheduleProjectFromTask,
} from "../services/schedule-service";
import { ROLE_PERMISSIONS } from "./members";
import { TASK_STATUSES, TASK_PRIORITIES } from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";
import { isISODate } from "../../shared/scheduling";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";

const isoDateInput = z.string().refine(isISODate, "日期必须是有效的 YYYY-MM-DD");

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
      await setTaskCompletion(input.projectId, input.phaseId, input.taskId, input.completed, ctx.user.id);
      // 完成 / 待审提交 / 取消 的活动日志由 setTaskCompletion 单写（按 outcome），
      // 此处不再盲写，避免「待审提交」被错记为「完成」。
      return { success: true };
    }),

  /** 配置任务审批闸门（需审批 + 审批人）— 仅可编辑项目信息者（owner/manager/pm/admin） */
  setApprovalConfig: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      taskId: z.string(),
      requiresApproval: z.boolean(),
      approverUserId: z.number().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅项目负责人/管理层可配置审批" });
      }
      await setTaskApprovalConfig(
        input.projectId, input.phaseId, input.taskId,
        { requiresApproval: input.requiresApproval, approverUserId: input.approverUserId },
        ctx.user.id,
      );
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
   * Update task meta fields. Status is system-derived from dependencies/completion.
   * Requires canEditTasks permission.
   */
  setMeta: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      taskId: z.string(),
      assigneeUserId: z.number().nullable().optional(),
      dueDate: isoDateInput.nullable().optional(),
      status: z.enum(TASK_STATUSES).optional(),
      priority: z.enum(TASK_PRIORITIES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
      }
      const { projectId, phaseId, taskId, ...patch } = input;
      delete patch.status;
      const existingTasks = await getProjectTasks(projectId, phaseId);
      const beforeTask = existingTasks.find((task) => task.taskId === taskId) ?? {
        projectId,
        phaseId,
        taskId,
        completed: false,
        assigneeUserId: null,
        dueDate: null,
        status: "todo",
        priority: "medium",
      };
      const metaPatch = { ...patch, updatedBy: ctx.user.id };
      await updateTaskMeta(projectId, phaseId, taskId, metaPatch);
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "task.update_meta",
        entityType: "task",
        entityId: taskId,
        meta: { phaseId, patch },
      });
      await emitAutomationEvent({
        action: "task.update_meta",
        projectId,
        entityType: "task",
        entityId: `${projectId}:${phaseId}:${taskId}`,
        actorId: ctx.user.id,
        before: beforeTask as unknown as Record<string, unknown>,
        after: { ...beforeTask, ...metaPatch } as Record<string, unknown>,
      });
      return { success: true };
    }),

  /** 勾选/取消单个交付物完成状态（需 canEditTasks） */
  setDeliverable: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      taskId: z.string(),
      name: z.string().min(1),
      done: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
      }
      const deliverables = await setTaskDeliverable(
        input.projectId, input.phaseId, input.taskId, input.name, input.done, ctx.user.id,
      );
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "task.update_deliverable",
        entityType: "task",
        entityId: input.taskId,
        meta: { phaseId: input.phaseId, name: input.name, done: input.done },
      });
      return { success: true, deliverables } as const;
    }),

  /** 按项目开始日重新生成整套排期（覆盖任务起止日，需 canEditProjectInfo） */
  regenerateSchedule: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有重排排期的权限" });
      }
      const count = await applyProjectSchedule(input.projectId);
      return { success: true, count } as const;
    }),

  /** 改某任务起止 → 只向后联动重排其传递后继（需 canEditTasks） */
  reschedule: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      taskId: z.string(),
      startDate: isoDateInput,
      dueDate: isoDateInput,
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有调整排期的权限" });
      }
      const { count, impact } = await rescheduleProjectFromTask(input.projectId, input.taskId, input.startDate, input.dueDate);
      return { success: true, count, impact } as const;
    }),

  /** 改期前预览：dry-run 算延期影响，不落库（需 canEditTasks） */
  delayImpact: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      taskId: z.string(),
      startDate: isoDateInput,
      dueDate: isoDateInput,
    }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有调整排期的权限" });
      }
      return computeProjectDelayImpact(input.projectId, input.taskId, input.startDate, input.dueDate);
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
