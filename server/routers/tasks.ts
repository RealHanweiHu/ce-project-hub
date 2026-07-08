import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPhasesForCategory } from "../../shared/sop-templates";
import {
  getProjectTasks,
  upsertProjectTask,
  setTaskCompletion,
  setTaskApprovalConfig,
  decideTaskApproval,
  getTaskActivityLogs,
  updateTaskMeta,
  getMyTasks,
  getOverdueTasks,
  getBlockedTasks,
  getProjectsByUser,
  createActivityLog,
  setTaskDeliverable,
  getProjectById,
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
import { isSystemAdminRole } from "../../shared/system-roles";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";
import { taskDisplayTitle } from "../task-title";
import { taskAllowsEvidence } from "../deliverable-access";
import type { ProjectMemberRole } from "../../drizzle/schema";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import {
  actionDedupeKey,
  closeActionItems,
  notifyActionItem,
  taskActionEntityId,
} from "../action-item-notify";
import { buildProjectActionPath, buildTaskApprovalActionPath } from "../../shared/action-links";
import { notifyGateReadyIfReady } from "../gate-ready-notify";

const isoDateInput = z.string().refine(isISODate, "日期必须是有效的 YYYY-MM-DD");

/**
 * 完成任务/勾交付物的权限：canEditTasks，或任务当事人
 * （被指派人 / 任务对其角色可见，viewer 除外）。
 * 后者是 qa/scm/sales/cert/battery_safety 的唯一执行通道——SOP 自动把任务派给
 * 他们，但这五个角色没有 canEditTasks。
 */
async function assertCanCompleteTask(
  projectId: string, phaseId: string, taskId: string, userId: number,
): Promise<void> {
  const role = await getEffectiveRole(projectId, userId);
  if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
  if (ROLE_PERMISSIONS[role].canEditTasks) return;
  const task = (await getProjectTasks(projectId, phaseId)).find((t) => t.taskId === taskId);
  if (taskAllowsEvidence(task, userId, role as ProjectMemberRole)) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
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
      if (!canRoleViewInternalWorkspace(role)) return [];
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
      await assertCanCompleteTask(input.projectId, input.phaseId, input.taskId, ctx.user.id);
      // Gate 任务不能直接勾选完成——那会绕过评审解锁下一阶段（无评审记录/追溯快照/自动化）。
      // 唯一完成路径是 gateReviews.confirmAndAdvance。取消勾选保留直连（撤销手段，方向是上锁）。
      if (input.completed) {
        const project = await getProjectById(input.projectId);
        const phase = project ? getPhasesForCategory(project.category).find((p) => p.id === input.phaseId) : undefined;
        if (phase && phase.gateTaskId === input.taskId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Gate 任务不能直接勾选完成，请通过 Gate 评审推进" });
        }
      }
      const taskBefore = (await getProjectTasks(input.projectId, input.phaseId)).find((t) => t.taskId === input.taskId);
      const result = await setTaskCompletion(input.projectId, input.phaseId, input.taskId, input.completed, ctx.user.id);
      const entityId = taskActionEntityId(input.projectId, input.phaseId, input.taskId);
      if (result.outcome === "submitted") {
        await closeActionItems({
          kind: "task_rework",
          entityType: "task",
          entityId,
        });
        if (taskBefore?.approverUserId) {
          await notifyActionItem({
            kind: "task_approval",
            projectId: input.projectId,
            entityType: "task",
            entityId,
            dedupeKey: actionDedupeKey({
              kind: "task_approval",
              entityId,
              recipientUserId: taskBefore.approverUserId,
            }),
            recipientUserId: taskBefore.approverUserId,
            title: "任务待审批",
            body: `「${taskDisplayTitle(taskBefore)}」已提交审批，请确认是否通过。`,
            actionPath: buildTaskApprovalActionPath({
              projectId: input.projectId,
              phaseId: input.phaseId,
              taskId: input.taskId,
            }),
            priority: taskBefore.priority === "critical" ? "critical" : "high",
            metadata: { phaseId: input.phaseId, taskId: input.taskId, requestedBy: ctx.user.id },
          });
        }
      } else if (result.outcome === "uncompleted" && taskBefore?.approverUserId) {
        await closeActionItems({
          kind: "task_approval",
          entityType: "task",
          entityId,
        });
      }
      if (result.outcome === "completed") {
        await notifyGateReadyIfReady({
          projectId: input.projectId,
          phaseId: input.phaseId,
          actorId: ctx.user.id,
          reason: "task.complete",
        }).catch((error) => {
          console.warn("[gate-ready] failed after task completion:", error);
        });
      }
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
      // 需审批 + 审批人 改为按项目角色可配置（有编辑任务权限即可），不再只限 PM/管理层。
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
      }
      await setTaskApprovalConfig(
        input.projectId, input.phaseId, input.taskId,
        { requiresApproval: input.requiresApproval, approverUserId: input.approverUserId },
        ctx.user.id,
      );
      return { success: true };
    }),

  /** 审批裁决：通过/驳回（仅指定审批人或全局 admin；admin 即代审） */
  decideApproval: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      taskId: z.string(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const tasks = await getProjectTasks(input.projectId, input.phaseId);
      const task = tasks.find((t) => t.taskId === input.taskId);
      const isAdmin = isSystemAdminRole(ctx.user.role);
      if (!(task?.approverUserId === ctx.user.id || isAdmin)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅审批人或管理员可裁决" });
      }
      // 审批人被移出项目后不应保留否决权：裁决时必须仍是在册成员（admin 例外）。
      if (!isAdmin) {
        const role = await getEffectiveRole(input.projectId, ctx.user.id);
        if (!role || !ROLE_PERMISSIONS[role].canView) {
          throw new TRPCError({ code: "FORBIDDEN", message: "审批人已不在项目成员中，请项目经理改派审批人" });
        }
      }
      const isProxy = task?.approverUserId !== ctx.user.id;
      await decideTaskApproval(
        input.projectId, input.phaseId, input.taskId,
        input.decision, ctx.user.id, input.note, isProxy,
      );
      const entityId = taskActionEntityId(input.projectId, input.phaseId, input.taskId);
      if (task?.approverUserId) {
        await closeActionItems({
          kind: "task_approval",
          entityType: "task",
          entityId,
        });
      }
      if (input.decision === "rejected" && task?.approvalRequestedBy) {
        await notifyActionItem({
          kind: "task_rework",
          projectId: input.projectId,
          entityType: "task",
          entityId,
          dedupeKey: actionDedupeKey({
            kind: "task_rework",
            entityId,
            recipientUserId: task.approvalRequestedBy,
          }),
          recipientUserId: task.approvalRequestedBy,
          title: "任务审批被驳回",
          body: `「${taskDisplayTitle(task)}」审批未通过${input.note ? `：${input.note}` : ""}。`,
          actionPath: buildProjectActionPath({
            projectId: input.projectId,
            tab: "tasks",
            phaseId: input.phaseId,
            taskId: input.taskId,
            taskTab: "approval",
          }),
          priority: task.priority === "critical" ? "critical" : "high",
          metadata: { phaseId: input.phaseId, taskId: input.taskId, rejectedBy: ctx.user.id },
        });
      } else if (input.decision === "approved") {
        await notifyGateReadyIfReady({
          projectId: input.projectId,
          phaseId: input.phaseId,
          actorId: ctx.user.id,
          reason: "task.approval.approve",
        }).catch((error) => {
          console.warn("[gate-ready] failed after task approval:", error);
        });
      }
      return { success: true };
    }),

  /** 单任务活动日志（带 phaseId，避免不同阶段同名 taskId 串任务） */
  activity: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string(), taskId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!canRoleViewInternalWorkspace(role)) return [];
      return getTaskActivityLogs(input.projectId, input.phaseId, input.taskId);
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
      const project = await getProjectById(projectId);
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
      const title = taskDisplayTitle({
        taskId,
        phaseId,
        projectCategory: project?.category,
        instructions: "instructions" in beforeTask ? beforeTask.instructions : null,
      });
      const metaPatch = { ...patch, updatedBy: ctx.user.id };
      const beforeEvent = { ...beforeTask, title, projectCategory: project?.category } as unknown as Record<string, unknown>;
      const afterEvent = { ...beforeTask, ...metaPatch, title, projectCategory: project?.category } as Record<string, unknown>;
      await updateTaskMeta(projectId, phaseId, taskId, metaPatch);
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "task.update_meta",
        entityType: "task",
        entityId: taskId,
        meta: { phaseId, patch, before: beforeEvent, after: afterEvent },
      });
      await emitAutomationEvent({
        action: "task.update_meta",
        projectId,
        entityType: "task",
        entityId: `${projectId}:${phaseId}:${taskId}`,
        actorId: ctx.user.id,
        before: beforeEvent,
        after: afterEvent,
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
      await assertCanCompleteTask(input.projectId, input.phaseId, input.taskId, ctx.user.id);
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
      const { count, impact } = await rescheduleProjectFromTask(input.projectId, input.taskId, input.startDate, input.dueDate, {
        actorId: ctx.user.id,
      });
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
      if (isSystemAdminRole(ctx.user.role)) {
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
      if (isSystemAdminRole(ctx.user.role)) {
        return getBlockedTasks();
      }
      const userProjects = await getProjectsByUser(ctx.user.id);
      const projectIds = userProjects.map((p) => p.id);
      return getBlockedTasks(projectIds);
    }),
});
