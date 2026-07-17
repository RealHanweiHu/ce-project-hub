import { z } from "zod";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectTasks,
  upsertProjectTask,
  setTaskCompletion,
  setTaskApprovalConfig,
  getTaskActivityLogs,
  updateTaskMeta,
  getMyTasks,
  getOverdueTasks,
  getBlockedTasks,
  getProjectsByUser,
  createActivityLog,
  setTaskDeliverable,
  getProjectById,
  getDb,
  acquireProjectReleaseStateLock,
  refreshProjectTaskStatuses,
} from "../db";
import {
  applyProjectSchedule,
  computeProjectDelayImpact,
  rescheduleProjectFromTask,
} from "../services/schedule-service";
import { ROLE_PERMISSIONS } from "./members";
import { projectTasks, PROJECT_MEMBER_ROLES, TASK_STATUSES, TASK_PRIORITIES } from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";
import { isISODate } from "../../shared/scheduling";
import { isSystemAdminRole } from "../../shared/system-roles";
import {
  getEffectiveProjectRoleById as getEffectiveRole,
  getEffectiveProjectRolesById,
  getUnionPermissions,
  resolveProjectActedAsRole,
} from "../project-access";
import { taskDisplayTitle } from "../task-title";
import { taskAllowsEvidence } from "../deliverable-access";
import type { ProjectMemberRole, ProjectTask } from "../../drizzle/schema";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import {
  actionDedupeKey,
  closeActionItems,
  closeActionItemsWithCards,
  notifyActionItem,
  taskActionEntityId,
} from "../action-item-notify";
import { buildProjectActionPath, buildTaskApprovalActionPath } from "../../shared/action-links";
import { notifyGateReadyIfReady } from "../gate-ready-notify";
import { assertTaskCompletionAllowed, assertTaskStartAllowed } from "../task-completion-guard";
import { notifyTaskReadyTask, reconcileTaskReadyActionItems } from "../automation/taskReady";
import { getEffectivePhasesForProjectLike } from "../../shared/npd-v3";
import { finalizeTaskApproval } from "../task-approval-service";
import { SOP_TEMPLATE_VERSION_NPD_V3 } from "../../shared/sop-templates";

const isoDateInput = z.string().refine(isISODate, "日期必须是有效的 YYYY-MM-DD");

/**
 * 完成任务/勾交付物的权限：canEditTasks，或任务当事人
 * （已有负责人时只认该人；未指派才按任务可见岗位兜底，viewer 除外）。
 * 后者是 qa/scm/sales/cert/battery_safety 的唯一执行通道——SOP 自动把任务派给
 * 他们，但这五个角色没有 canEditTasks。
 */
async function assertCanCompleteTask(
  projectId: string, phaseId: string, taskId: string, userId: number,
  taskOverride?: ProjectTask,
): Promise<void> {
  const roles = await getEffectiveProjectRolesById(projectId, userId);
  const role = await getEffectiveRole(projectId, userId);
  if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
  if (getUnionPermissions(roles).canEditTasks) return;
  const task = taskOverride ?? (await getProjectTasks(projectId, phaseId)).find((t) => t.taskId === taskId);
  if (taskAllowsEvidence(task, userId, roles)) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
}

/** “开始”是责任人的个人承诺：已有负责人时，管理权限也不能代点。 */
function assertCanStartTask(
  task: ProjectTask,
  userId: number,
  roles: Set<ProjectMemberRole>,
): void {
  if (task.assigneeUserId != null) {
    if (taskAllowsEvidence(task, userId, roles)) return;
    throw new TRPCError({ code: "FORBIDDEN", message: "只能由任务负责人本人确认开始" });
  }
  if (getUnionPermissions(roles).canEditTasks || taskAllowsEvidence(task, userId, roles)) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "没有开始任务的权限" });
}

async function closeTaskReadyAction(input: {
  projectId: string;
  phaseId: string;
  taskId: string;
  title: string;
  message: string;
}): Promise<void> {
  await closeActionItemsWithCards({
    kind: "task_ready",
    entityType: "task",
    entityId: taskActionEntityId(input.projectId, input.phaseId, input.taskId),
  }, {
    title: input.title,
    message: input.message,
    actionPath: buildProjectActionPath({
      projectId: input.projectId,
      tab: "tasks",
      phaseId: input.phaseId,
      taskId: input.taskId,
    }),
  });
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
      completionNote: z.string().trim().min(1, "一句话结论不能为空").max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [project, allTasks] = await Promise.all([
        getProjectById(input.projectId),
        getProjectTasks(input.projectId),
      ]);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
      const taskBefore = allTasks.find((task) =>
        task.phaseId === input.phaseId && task.taskId === input.taskId
      );
      const isNpdV3 = project.category === "npd"
        && project.sopTemplateVersion === SOP_TEMPLATE_VERSION_NPD_V3;
      // v3 以种子任务行为单一事实源，缺行即拒绝；存量模板沿用旧的
      // setTaskCompletion upsert 语义，兼容历史本地自定义任务。
      if (!taskBefore && isNpdV3) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      await assertCanCompleteTask(
        input.projectId,
        input.phaseId,
        input.taskId,
        ctx.user.id,
        taskBefore,
      );
      if (taskBefore) {
        await assertTaskCompletionAllowed({
          project,
          task: taskBefore,
          allTasks,
          actorId: ctx.user.id,
          completed: input.completed,
          completionNote: input.completionNote,
        });
      } else {
        const phase = getEffectivePhasesForProjectLike(project)
          .find((candidate) => candidate.id === input.phaseId);
        if (phase?.gateTaskId === input.taskId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Gate 任务只能通过正式评审推进" });
        }
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const result = await db.transaction(async (tx) => {
        await acquireProjectReleaseStateLock(tx, input.projectId);
        const completionResult = await setTaskCompletion(
          input.projectId,
          input.phaseId,
          input.taskId,
          input.completed,
          ctx.user.id,
          tx,
        );
        const [updated] = await tx.update(projectTasks)
          .set({ completionNote: input.completed ? (input.completionNote ?? null) : null })
          .where(and(
            eq(projectTasks.projectId, input.projectId),
            eq(projectTasks.phaseId, input.phaseId),
            eq(projectTasks.taskId, input.taskId),
          ))
          .returning({ id: projectTasks.id });
        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        }
        return completionResult;
      });
      if (result.outcome === "completed") {
        const beforeEvent = {
          ...taskBefore,
          projectId: input.projectId,
          phaseId: input.phaseId,
          taskId: input.taskId,
          status: taskBefore?.status ?? "todo",
          projectCategory: project?.category,
        } as unknown as Record<string, unknown>;
        await emitAutomationEvent({
          action: "task.update_meta",
          projectId: input.projectId,
          entityType: "task",
          entityId: `${input.projectId}:${input.phaseId}:${input.taskId}`,
          actorId: ctx.user.id,
          before: beforeEvent,
          after: { ...beforeEvent, status: "done", completed: true },
        });
      }
      const entityId = taskActionEntityId(input.projectId, input.phaseId, input.taskId);
      if (result.outcome === "completed" || result.outcome === "submitted") {
        await closeTaskReadyAction({
          projectId: input.projectId,
          phaseId: input.phaseId,
          taskId: input.taskId,
          title: result.outcome === "submitted" ? "任务已提交审批" : "任务已完成",
          message: "系统中的任务状态已更新，这条“可以开始”卡片已闭环。",
        });
      }
      if (result.outcome === "submitted") {
        await closeActionItems({
          kind: "task_rework",
          entityType: "task",
          entityId,
        });
        if (taskBefore?.approverUserId) {
          let frozenSigning: Awaited<ReturnType<typeof resolveProjectActedAsRole>> | null = null;
          if (project) {
            try {
              frozenSigning = await resolveProjectActedAsRole({
                project,
                userId: taskBefore.approverUserId,
                eligible: (role) => ROLE_PERMISSIONS[role].canViewInternalWorkspace,
              });
            } catch { /* 多角色时要求审批人回系统显式选择，不伪造默认身份 */ }
          }
          await notifyActionItem({
            kind: "task_approval",
            projectId: input.projectId,
            entityType: "task",
            entityId,
            dedupeKey: actionDedupeKey({
              kind: "task_approval",
              projectId: input.projectId,
              entityId,
              recipientUserId: taskBefore.approverUserId,
            }),
            recipientUserId: taskBefore.approverUserId,
            title: "任务待审批",
            body: `「${taskDisplayTitle({ ...taskBefore, projectLike: project })}」已提交审批，请确认是否通过。`,
            actionPath: buildTaskApprovalActionPath({
              projectId: input.projectId,
              phaseId: input.phaseId,
              taskId: input.taskId,
            }),
            priority: taskBefore.priority === "critical" ? "critical" : "high",
            metadata: {
              phaseId: input.phaseId,
              taskId: input.taskId,
              requestedBy: ctx.user.id,
              actedAsRole: frozenSigning?.role ?? null,
              viaDelegationId: frozenSigning?.viaDelegationId ?? null,
            },
          });
        }
      } else if (result.outcome === "uncompleted") {
        if (taskBefore?.approverUserId) {
          await closeActionItems({
            kind: "task_approval",
            entityType: "task",
            entityId,
          });
        }
        // 前置任务取消完成后，后继的「可以开始」卡片依据已失效：统一走 reconcile
        // 关停不再就绪的卡（条件再满足时会重新下发），否则旧模板可越依赖开始、
        // v3 上留下点了必 409 的死卡。
        if (project) {
          await reconcileTaskReadyActionItems(project).catch((error) => {
            console.warn("[task-ready] reconcile after uncomplete failed:", error);
          });
        }
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

  /** 人工确认任务已开始；计划排期 startDate 保持不变。 */
  start: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      taskId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "没有开始任务的权限" });
      const roles = await getEffectiveProjectRolesById(input.projectId, ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
      const result = await db.transaction(async (tx) => {
        const taskWhere = and(
          eq(projectTasks.projectId, input.projectId),
          eq(projectTasks.phaseId, input.phaseId),
          eq(projectTasks.taskId, input.taskId),
        );
        const [taskBefore] = await tx.select().from(projectTasks).where(taskWhere).limit(1);
        if (!taskBefore) {
          throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        }
        assertCanStartTask(taskBefore, ctx.user.id, roles);
        const allTasks: ProjectTask[] = await tx
           .select()
           .from(projectTasks)
           .where(eq(projectTasks.projectId, input.projectId));
         assertTaskStartAllowed({ project, task: taskBefore, allTasks });
        const assertStartable = (task: typeof taskBefore) => {
          if (
            task.completed ||
            task.status === "done" ||
            task.status === "skipped" ||
            task.status === "pending_approval"
          ) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "任务已进入终态或待审批，无法开始",
            });
          }
        };
        assertStartable(taskBefore);

        if (taskBefore.actualStartedAt) {
          await refreshProjectTaskStatuses(input.projectId, undefined, tx);
          return { already: true, event: null } as const;
        }

        const actualStartedAt = new Date();
        const [updated] = await tx.update(projectTasks)
          .set({ actualStartedAt, updatedBy: ctx.user.id })
          .where(and(
            taskWhere,
            isNull(projectTasks.actualStartedAt),
            eq(projectTasks.completed, false),
            notInArray(projectTasks.status, ["done", "skipped", "pending_approval"]),
          ))
          .returning({ id: projectTasks.id });
        if (!updated) {
          const [latest] = await tx.select().from(projectTasks).where(taskWhere).limit(1);
          if (!latest) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
          assertStartable(latest);
          if (latest.actualStartedAt) {
            await refreshProjectTaskStatuses(input.projectId, undefined, tx);
            return { already: true, event: null } as const;
          }
          throw new TRPCError({ code: "CONFLICT", message: "任务状态已变化，请刷新后重试" });
        }

        await refreshProjectTaskStatuses(input.projectId, undefined, tx);
        const [taskAfter] = await tx.select().from(projectTasks).where(taskWhere).limit(1);
        const beforeEvent = {
          ...taskBefore,
          projectCategory: project?.category,
        } as unknown as Record<string, unknown>;
        const afterEvent = {
          ...taskAfter,
          actualStartedAt,
          projectCategory: project?.category,
        } as unknown as Record<string, unknown>;
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "task.update_meta",
          entityType: "task",
          entityId: input.taskId,
          meta: {
            phaseId: input.phaseId,
            patch: { actualStartedAt },
            before: beforeEvent,
            after: afterEvent,
          },
        }, tx);
        return { already: false, event: { beforeEvent, afterEvent } } as const;
      });
      if (result.event) {
        await emitAutomationEvent({
          action: "task.update_meta",
          projectId: input.projectId,
          entityType: "task",
          entityId: `${input.projectId}:${input.phaseId}:${input.taskId}`,
          actorId: ctx.user.id,
          before: result.event.beforeEvent,
          after: result.event.afterEvent,
        });
      }
      await closeTaskReadyAction({
        projectId: input.projectId,
        phaseId: input.phaseId,
        taskId: input.taskId,
        title: "任务已开始",
        message: "已记录实际开始时间，原计划排期保持不变。",
      });
      return { success: true, already: result.already } as const;
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
      const roles = await getEffectiveProjectRolesById(input.projectId, ctx.user.id);
      if (!getUnionPermissions(roles).canEditTasks) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑任务的权限" });
      }
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
      const phase = getEffectivePhasesForProjectLike(project).find((item) => item.id === input.phaseId);
      if (phase?.gateTaskId === input.taskId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Gate 任务只使用正式 Gate 评审，不能配置普通任务审批" });
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
      actedAsRole: z.enum(PROJECT_MEMBER_ROLES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [tasks, project] = await Promise.all([
        getProjectTasks(input.projectId, input.phaseId),
        getProjectById(input.projectId),
      ]);
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
      let signing: Awaited<ReturnType<typeof resolveProjectActedAsRole>> | null = null;
      if (!isAdmin) {
        try {
          signing = await resolveProjectActedAsRole({
            project: project!,
            userId: ctx.user.id,
            requestedRole: input.actedAsRole,
            eligible: (role) => ROLE_PERMISSIONS[role].canViewInternalWorkspace,
          });
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "签字角色无效" });
        }
      }
      const finalized = await finalizeTaskApproval({
        projectId: input.projectId,
        phaseId: input.phaseId,
        taskId: input.taskId,
        decision: input.decision,
        actor: ctx.user.id,
        note: input.note,
        isProxy,
        actedAsRole: signing?.role ?? (isAdmin ? "manager" : null),
        viaDelegationId: signing?.viaDelegationId ?? null,
      });
      const taskBefore = finalized.taskBefore;
      if (input.decision === "approved") {
        const beforeEvent = {
          ...taskBefore,
          projectId: input.projectId,
          phaseId: input.phaseId,
          taskId: input.taskId,
          status: taskBefore.status,
          projectCategory: finalized.project.category,
        } as unknown as Record<string, unknown>;
        await emitAutomationEvent({
          action: "task.update_meta",
          projectId: input.projectId,
          entityType: "task",
          entityId: `${input.projectId}:${input.phaseId}:${input.taskId}`,
          actorId: ctx.user.id,
          before: beforeEvent,
          after: { ...beforeEvent, status: "done", completed: true },
        });
      }
      const entityId = taskActionEntityId(input.projectId, input.phaseId, input.taskId);
      if (input.decision === "approved") {
        await closeTaskReadyAction({
          projectId: input.projectId,
          phaseId: input.phaseId,
          taskId: input.taskId,
          title: "任务审批已通过",
          message: "任务已完成，这条“可以开始”卡片已闭环。",
        });
      }
      if (taskBefore.approverUserId) {
        await closeActionItems({
          kind: "task_approval",
          entityType: "task",
          entityId,
        });
      }
      if (input.decision === "rejected" && taskBefore.approvalRequestedBy) {
        await notifyActionItem({
          kind: "task_rework",
          projectId: input.projectId,
          entityType: "task",
          entityId,
          dedupeKey: actionDedupeKey({
            kind: "task_rework",
            projectId: input.projectId,
            entityId,
            recipientUserId: taskBefore.approvalRequestedBy,
          }),
          recipientUserId: taskBefore.approvalRequestedBy,
          title: "任务审批被驳回",
          body: `「${taskDisplayTitle({ ...taskBefore, projectLike: project })}」审批未通过${input.note ? `：${input.note}` : ""}。`,
          actionPath: buildProjectActionPath({
            projectId: input.projectId,
            tab: "tasks",
            phaseId: input.phaseId,
            taskId: input.taskId,
            taskTab: "approval",
          }),
          priority: taskBefore.priority === "critical" ? "critical" : "high",
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
      const roles = await getEffectiveProjectRolesById(input.projectId, ctx.user.id);
      if (!getUnionPermissions(roles).canEditTasks) {
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
      const roles = await getEffectiveProjectRolesById(input.projectId, ctx.user.id);
      if (!getUnionPermissions(roles).canEditTasks) {
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
        projectLike: project,
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
      if (
        project &&
        patch.assigneeUserId !== undefined &&
        patch.assigneeUserId !== beforeTask.assigneeUserId
      ) {
        await closeTaskReadyAction({
          projectId,
          phaseId,
          taskId,
          title: "任务负责人已调整",
          message: "旧负责人对应的“可以开始”卡片已关闭。",
        });
        if (patch.assigneeUserId != null) {
          await notifyTaskReadyTask(project, phaseId, taskId);
        }
      }
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
      const roles = await getEffectiveProjectRolesById(input.projectId, ctx.user.id);
      if (!getUnionPermissions(roles).canEditTasks) {
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
      const roles = await getEffectiveProjectRolesById(input.projectId, ctx.user.id);
      if (!getUnionPermissions(roles).canEditTasks) {
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
