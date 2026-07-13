import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectGateReviews,
  createProjectGateReview,
  confirmGateReview,
  updateProjectGateReview,
  createActivityLog,
  getGateReadiness,
  getProjectById,
  getUsersByIds,
  getCurrentGateSignoffRound,
  getProjectGateSignoffRequirements,
  getOpenProjectGateSignoffRound,
  openProjectGateSignoffRound,
  addProjectGateSignoffRequirement,
  listProjectGateSignoffs,
  upsertProjectGateSignoff,
  assertProjectGateSignoffsComplete,
  ensureNpdProductBaseline,
  getProjectConditionsReadiness,
  getProjectTasks,
} from "../db";
import { getEffectivePhasesForProjectLike } from "../../shared/npd-v3";
import { ROLE_PERMISSIONS } from "./members";
import { GATE_DECISIONS, PROJECT_MEMBER_ROLES } from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";
import {
  getEffectiveProjectRoleById as getEffectiveRole,
  getEffectiveProjectRolesById,
  resolveProjectActedAsRole,
} from "../project-access";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import {
  GATE_SIGNOFF_SLOTS,
  GATE_SIGNOFF_STATUSES,
  GATE_SIGNOFF_SLOT_LABELS,
  GATE_SIGNOFF_SLOT_ROLES,
  canProjectRoleSignSlot,
} from "../../shared/gate-signoffs";
import { isSystemAdminRole } from "../../shared/system-roles";
import { cancelAndRecordProjectMeeting } from "../services/project-meeting-lifecycle";
import { assertFourEyes, redlineKindForGateSlot, redlineKindForTask } from "../../shared/redline-four-eyes";

async function assertGateCanProceed(projectId: string, phaseId: string, decision: string) {
  if (decision === "rejected") return;
  const conditionReadiness = await getProjectConditionsReadiness(projectId);
  if (!conditionReadiness.ready) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `上一 Gate 条件项尚未闭环，不能推进：${conditionReadiness.blockers.slice(0, 5).join("；")}`,
    });
  }
  const readiness = await getGateReadiness(projectId, phaseId);
  if (!readiness) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "无法计算 Gate 就绪度，不能通过评审" });
  }
  if (readiness.ready) return;
  const blockerText = readiness.dimensions
    .filter((dimension) => !dimension.ok)
    .flatMap((dimension) => dimension.blockers.map((blocker) => `${dimension.summary}: ${blocker}`))
    .slice(0, 8)
    .join("；");
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Gate 未就绪，不能通过或推进。请先关闭阻塞项${blockerText ? `：${blockerText}` : ""}`,
  });
}

async function assertGateSignoffsCanProceed(projectId: string, phaseId: string, decision: string, actorId: number) {
  if (decision === "rejected") return;
  try {
    await assertProjectGateSignoffsComplete(projectId, phaseId, actorId);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Gate 会签未完成",
    });
  }
}

function assertConditionalFollowUp(input: {
  decision?: string | null;
  conditions?: string | null;
  conditionOwnerUserId?: number | null;
  conditionDueDate?: string | null;
  conditionItems?: Array<{ description: string; ownerUserId: number; dueDate: string }>;
}) {
  if (input.decision !== "conditional") return;
  if (input.conditionItems && input.conditionItems.length > 0) {
    if (input.conditionItems.some((item) => !item.description.trim() || !item.ownerUserId || !item.dueDate)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "每条通过条件都必须填写内容、负责人和截止日期" });
    }
    return;
  }
  if (!input.conditions?.trim() || !input.conditionOwnerUserId || !input.conditionDueDate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "有条件通过必须填写条件内容、跟进负责人与截止日期",
    });
  }
}

const conditionItemSchema = z.object({
  description: z.string().trim().min(1).max(5000),
  ownerUserId: z.number().int().positive(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const gateReviewsRouter = router({
  /** List all gate reviews for a project (optionally filtered by phase) */
  list: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      const roles = await getEffectiveProjectRolesById(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!canRoleViewInternalWorkspace(roles)) return [];
      return getProjectGateReviews(input.projectId, input.phaseId);
    }),

  /** Create a gate review (requires canGateReview) */
  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      gateTaskId: z.string().optional().nullable(),
      phaseName: z.string().default(""),
      gateName: z.string().default(""),
      reviewDate: z.string(),
      participants: z.string().optional().nullable(),
      decision: z.enum(GATE_DECISIONS).default("conditional"),
      conditions: z.string().optional().nullable(),
      conditionOwnerUserId: z.number().int().positive().optional().nullable(),
      conditionDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      notes: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      const perms = role ? ROLE_PERMISSIONS[role] : null;
      // create 只记录「会开了但未通过」。通过/有条件通过必须走
      // confirmAndAdvance，把评审、Gate task 和阶段推进原子写在一起。
      if (!perms || (input.decision !== "rejected"
        ? !perms.canGateReview
        : !(perms.canGateReview || perms.canConveneGateReview))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: input.decision !== "rejected"
            ? "只有管理层可以给出通过/有条件通过的 Gate 决策"
            : "只有管理层或项目经理可以记录门评审",
        });
      }
      if (input.decision !== "rejected") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "通过或有条件通过必须使用正式 Gate 裁决入口",
        });
      }
      assertConditionalFollowUp(input);
      await assertGateCanProceed(input.projectId, input.phaseId, input.decision);
      await assertGateSignoffsCanProceed(input.projectId, input.phaseId, input.decision, ctx.user.id);
      const id = await createProjectGateReview({
        ...input,
        createdBy: ctx.user.id,
      });
      const createdReview = (await getProjectGateReviews(input.projectId, input.phaseId))
        .find((review) => review.id === id);
      const roundNumber = createdReview?.roundNumber ?? 1;
      const afterReview = { ...input, roundNumber, id, createdBy: ctx.user.id };
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "gate.create",
        entityType: "gate_review",
        entityId: String(id),
        meta: {
          phaseId: input.phaseId,
          decision: input.decision,
          roundNumber,
          after: afterReview,
        },
      });
      await emitAutomationEvent({
        action: "gate.create",
        projectId: input.projectId,
        entityType: "gate_review",
        entityId: id,
        actorId: ctx.user.id,
        after: afterReview,
      });
      return { success: true, id };
    }),

  /** Update a gate review (requires canGateReview) */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      projectId: z.string(),
      phaseName: z.string().optional(),
      gateName: z.string().optional(),
      reviewDate: z.string().optional(),
      participants: z.string().optional().nullable(),
      decision: z.enum(GATE_DECISIONS).optional(),
      conditions: z.string().optional().nullable(),
      conditionOwnerUserId: z.number().int().positive().optional().nullable(),
      conditionDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      notes: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      const perms = role ? ROLE_PERMISSIONS[role] : null;
      if (!perms || !(perms.canGateReview || perms.canConveneGateReview)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层或项目经理可以修改门评审" });
      }
      const { id, projectId, ...patch } = input;
      const reviews = await getProjectGateReviews(projectId);
      const beforeReview = reviews.find((review) => review.id === id);
      // 评审必须属于鉴权所用的 projectId，否则可用自己项目的角色改写他人项目的评审（IDOR）
      if (!beforeReview) {
        throw new TRPCError({ code: "NOT_FOUND", message: "评审记录不存在" });
      }
      assertConditionalFollowUp({
        decision: patch.decision ?? beforeReview.decision,
        conditions: patch.conditions ?? beforeReview.conditions,
        conditionOwnerUserId: patch.conditionOwnerUserId ?? beforeReview.conditionOwnerUserId,
        conditionDueDate: patch.conditionDueDate ?? beforeReview.conditionDueDate,
      });
      const decisionChanged = patch.decision != null && patch.decision !== beforeReview.decision;
      if (decisionChanged) {
        if (!perms.canGateReview) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以修改 Gate 决策" });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Gate 决策不可覆盖修改；请通过正式裁决开启新一轮评审",
        });
      }
      await updateProjectGateReview(id, patch);
      const afterReview = { ...beforeReview, ...patch } as Record<string, unknown>;
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "gate.update",
        entityType: "gate_review",
        entityId: String(id),
        meta: {
          patch,
          before: beforeReview as unknown as Record<string, unknown>,
          after: afterReview,
        },
      });
      if (beforeReview) {
        await emitAutomationEvent({
          action: "gate.update",
          projectId,
          entityType: "gate_review",
          entityId: id,
          actorId: ctx.user.id,
          before: beforeReview as unknown as Record<string, unknown>,
          after: afterReview,
        });
      }
      return { success: true };
    }),

  /**
   * 原子化「Gate 通过/有条件通过/不通过」：评审 + 标 gate task done + 推进阶段在服务端一次完成。
   * 取代客户端分散三笔写（projects.update + tasks.setCompleted + gateReviews.create）经 600ms 防抖
   * 串起的旧路径——后者在刷新/快速操作下会部分持久化，导致「已推进但 gate task 未完成→阶段锁死」。
   */
  confirmAndAdvance: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      gateTaskId: z.string().nullable().optional(),
      phaseName: z.string().default(""),
      gateName: z.string().default(""),
      reviewDate: z.string(),
      participants: z.string().optional().nullable(),
      decision: z.enum(GATE_DECISIONS).default("approved"),
      conditions: z.string().optional().nullable(),
      conditionOwnerUserId: z.number().int().positive().optional().nullable(),
      conditionDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      conditionItems: z.array(conditionItemSchema).max(20).optional(),
      notes: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canGateReview) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以进行门评审" });
      }
      assertConditionalFollowUp(input);
      await assertGateCanProceed(input.projectId, input.phaseId, input.decision);
      await assertGateSignoffsCanProceed(input.projectId, input.phaseId, input.decision, ctx.user.id);
      const projectBefore = await getProjectById(input.projectId);
      if (!projectBefore) {
        throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
      }
      if (projectBefore.currentPhase !== input.phaseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只能裁决项目当前阶段的 Gate；历史记录请查看评审轮次" });
      }
      const effectivePhases = getEffectivePhasesForProjectLike(projectBefore);
      const requestedPhase = effectivePhases.find((phase) => phase.id === input.phaseId);
      if (!requestedPhase) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "阶段不属于项目当前生效流程" });
      }
      const gateTaskId = requestedPhase.gateTaskId;
      if (!gateTaskId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "当前阶段未配置 Gate 任务" });
      }
      if (input.gateTaskId && input.gateTaskId !== gateTaskId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Gate 任务与项目当前生效阶段不匹配" });
      }
      const gateTaskBefore = input.decision !== "rejected"
        ? (await getProjectTasks(input.projectId, input.phaseId))
          .find((task) => task.taskId === gateTaskId)
        : null;
      const firstPhase = effectivePhases[0];
      if (
        input.decision !== "rejected" &&
        projectBefore.category === "npd" &&
        firstPhase?.id === input.phaseId
      ) {
        await ensureNpdProductBaseline(input.projectId, ctx.user.id);
      }
      const { reviewId, roundNumber, advancedTo, closed } = await confirmGateReview({
        projectId: input.projectId,
        phaseId: input.phaseId,
        gateTaskId,
        phaseName: input.phaseName,
        gateName: input.gateName,
        reviewDate: input.reviewDate,
        participants: input.participants ?? null,
        decision: input.decision,
        conditions: input.conditions ?? null,
        conditionOwnerUserId: input.conditionOwnerUserId ?? null,
        conditionDueDate: input.conditionDueDate ?? null,
        conditionItems: input.conditionItems ?? [],
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      });
      if (input.decision !== "rejected") {
        const beforeEvent = {
          ...gateTaskBefore,
          projectId: input.projectId,
          phaseId: input.phaseId,
          taskId: gateTaskId,
          title: input.gateName || gateTaskId,
          status: gateTaskBefore?.status ?? "todo",
          projectCategory: projectBefore.category,
        } as unknown as Record<string, unknown>;
        await emitAutomationEvent({
          action: "task.update_meta",
          projectId: input.projectId,
          entityType: "task",
          entityId: `${input.projectId}:${input.phaseId}:${gateTaskId}`,
          actorId: ctx.user.id,
          before: beforeEvent,
          after: { ...beforeEvent, status: "done", completed: true },
        });
      }
      const afterReview = { ...input, gateTaskId, roundNumber, id: reviewId, createdBy: ctx.user.id };
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "gate.create",
        entityType: "gate_review",
        entityId: String(reviewId),
        meta: { phaseId: input.phaseId, decision: input.decision, roundNumber, advancedTo, closed, after: afterReview },
      });
      await emitAutomationEvent({
        action: "gate.create",
        projectId: input.projectId,
        entityType: "gate_review",
        entityId: reviewId,
        actorId: ctx.user.id,
        after: afterReview,
      });
      if (input.decision === "rejected") {
        const taskAfter = {
          projectId: input.projectId,
          phaseId: input.phaseId,
          taskId: gateTaskId,
          title: input.gateName || gateTaskId,
          status: "blocked",
        };
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "task.update_meta",
          entityType: "task",
          entityId: gateTaskId,
          meta: { phaseId: input.phaseId, before: { status: "in_progress" }, after: taskAfter, source: "gate.rejected" },
        });
        await emitAutomationEvent({
          action: "task.update_meta",
          projectId: input.projectId,
          entityType: "task",
          entityId: `${input.projectId}:${input.phaseId}:${gateTaskId}`,
          actorId: ctx.user.id,
          before: { status: "in_progress" },
          after: taskAfter,
        });
      }
      if (advancedTo) {
        // Gate 通过推进阶段 → 通知项目群与 PM，下一阶段角色启动任务（旧行为静默推进）
        const nextPhase = effectivePhases.find((phase) => phase.id === advancedTo);
        const phaseAfter = {
          projectId: input.projectId,
          fromPhaseId: input.phaseId,
          fromPhaseName: input.phaseName || input.phaseId,
          phaseId: advancedTo,
          phaseName: nextPhase?.name ?? advancedTo,
        };
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "phase.advance",
          entityType: "phase",
          entityId: advancedTo,
          meta: phaseAfter,
        });
        await emitAutomationEvent({
          action: "phase.advanced",
          projectId: input.projectId,
          entityType: "phase",
          entityId: `${input.projectId}:${advancedTo}`,
          actorId: ctx.user.id,
          after: phaseAfter,
        });
      }
      if (closed) {
        try { await cancelAndRecordProjectMeeting(projectBefore); }
        catch (error) { console.warn("[meeting] cancel on project close failed (non-fatal):", error); }
        const closeAfter = { projectId: input.projectId, phaseId: input.phaseId, archived: true };
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "project.close",
          entityType: "project",
          entityId: input.projectId,
          meta: { after: closeAfter },
        });
      }
      return { success: true, id: reviewId, roundNumber, advancedTo, closed };
    }),

  /** 当前评审轮次的结构化会签槽位。 */
  signoffs: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      const roles = await getEffectiveProjectRolesById(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
      const [roundNumber, requirements] = await Promise.all([
        getCurrentGateSignoffRound(input.projectId, input.phaseId),
        getProjectGateSignoffRequirements(input.projectId, input.phaseId),
      ]);
      const [rows, round] = await Promise.all([
        listProjectGateSignoffs(input.projectId, input.phaseId, roundNumber),
        getOpenProjectGateSignoffRound(input.projectId, input.phaseId),
      ]);
      const rowBySlot = new Map(rows.map((row) => [row.slot, row]));
      const signerIds = Array.from(new Set(rows.map((row) => row.signedBy).filter((id): id is number => !!id)));
      const signers = await getUsersByIds(signerIds);
      const signerNames = new Map(signers.map((user) => [
        user.id,
        user.name || user.username || `#${user.id}`,
      ]));
      return {
        roundNumber,
        roundStatus: round?.roundNumber === roundNumber ? round.status : "preview",
        canAddRequirement: !!ROLE_PERMISSIONS[role].canGateReview,
        slots: GATE_SIGNOFF_SLOTS.map((slot) => {
          const row = rowBySlot.get(slot);
          const requirement = requirements[slot];
          return {
            slot,
            label: GATE_SIGNOFF_SLOT_LABELS[slot],
            requirement,
            status: row?.status ?? (requirement === "not_applicable" ? "not_applicable" : "pending"),
            signedBy: row?.signedBy ?? null,
            signerName: row?.signedBy ? signerNames.get(row.signedBy) ?? null : null,
            signedAt: row?.signedAt ?? null,
            note: row?.note ?? null,
            eligibleRoles: [...GATE_SIGNOFF_SLOT_ROLES[slot]],
            canSign: requirement !== "not_applicable" &&
              (isSystemAdminRole(ctx.user.role) || canProjectRoleSignSlot(roles, slot)),
          };
        }),
      };
    }),

  /** 专业角色对自己的槽位签字；管理层不能代替专业角色，系统管理员可留痕代签。 */
  sign: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      slot: z.enum(GATE_SIGNOFF_SLOTS),
      status: z.enum(GATE_SIGNOFF_STATUSES).refine((status) => !["pending", "not_applicable"].includes(status), "无效会签状态"),
      note: z.string().max(1000).nullable().optional(),
      actedAsRole: z.enum(PROJECT_MEMBER_ROLES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      const roles = await getEffectiveProjectRolesById(input.projectId, ctx.user.id);
      const isAdmin = isSystemAdminRole(ctx.user.role);
      if (!role || (!isAdmin && !canProjectRoleSignSlot(roles, input.slot))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "你不属于该会签槽位" });
      }
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
      let signing: Awaited<ReturnType<typeof resolveProjectActedAsRole>> | null = null;
      if (!isAdmin) {
        try {
          signing = await resolveProjectActedAsRole({
            project,
            userId: ctx.user.id,
            requestedRole: input.actedAsRole,
            eligible: (candidate) => canProjectRoleSignSlot(candidate, input.slot),
          });
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "签字角色无效" });
        }
      }
      if ((input.status === "conditional" || input.status === "rejected") && !input.note?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "有条件同意或拒绝必须填写说明" });
      }
      const round = await openProjectGateSignoffRound({
        projectId: input.projectId,
        phaseId: input.phaseId,
        openedBy: ctx.user.id,
      });
      const roundNumber = round.roundNumber;
      const requirements = round.requirements;
      const requirement = requirements[input.slot];
      if (requirement === "not_applicable") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该槽位在本 Gate 不适用" });
      }
      // 四眼按"同一红线对象"两两比对（设计 §2.3）：槽位的红线类别只与同类红线
      // 任务的完成人互斥——certification 槽不因签字人完成过 customer_release 任务而被挡。
      const slotRedlineKind = redlineKindForGateSlot(project, input.phaseId, input.slot);
      if (slotRedlineKind) {
        const phaseTasks = await getProjectTasks(input.projectId, input.phaseId);
        for (const task of phaseTasks) {
          if (redlineKindForTask(project, task.taskId) === slotRedlineKind) {
            assertFourEyes(task.completedBy, ctx.user.id);
          }
        }
      }
      const row = await upsertProjectGateSignoff({
        projectId: input.projectId,
        phaseId: input.phaseId,
        roundNumber,
        slot: input.slot,
        requirement,
        status: input.status,
        signedBy: ctx.user.id,
        note: input.note ?? null,
        viaDelegationId: signing?.viaDelegationId ?? null,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "gate.signoff",
        entityType: "gate_signoff",
        entityId: String(row.id),
        meta: { phaseId: input.phaseId, roundNumber, slot: input.slot, status: input.status, actedAsRole: signing?.role ?? input.slot, viaDelegationId: signing?.viaDelegationId ?? null, proxy: isAdmin && !canProjectRoleSignSlot(role, input.slot) },
      });
      return row;
    }),

  /** 项目级加签只能加严；若本轮已开启则废止并按新矩阵重开。 */
  addRequirement: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      slot: z.enum(GATE_SIGNOFF_SLOTS),
      requirement: z.enum(["conditional", "required"]),
      reason: z.string().trim().min(2).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canGateReview) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以增加项目级会签要求" });
      }
      try {
        const row = await addProjectGateSignoffRequirement({ ...input, addedBy: ctx.user.id });
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "gate.signoff_requirement_add",
          entityType: "gate_signoff_requirement",
          entityId: String(row.id),
          meta: { phaseId: input.phaseId, slot: input.slot, requirement: row.requirement, reason: input.reason },
        });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "加签失败" });
      }
    }),

  /** Gate 就绪度：前置/交付物/本阶段P0P1/QA-PE阻断/遗留评审条件 */
  readiness: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!canRoleViewInternalWorkspace(role)) return null;
      return getGateReadiness(input.projectId, input.phaseId);
    }),

  /** Delete a gate review (requires canGateReview) */
  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
      projectId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canGateReview) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以删除门评审" });
      }
      // 同 update：评审必须属于鉴权所用的 projectId（防跨项目 IDOR 删除）
      const reviews = await getProjectGateReviews(input.projectId);
      const review = reviews.find((item) => item.id === input.id);
      if (!review) {
        throw new TRPCError({ code: "NOT_FOUND", message: "评审记录不存在" });
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Gate 评审属于审计记录，不能物理删除；更正请补充说明或开启新一轮",
      });
    }),
});
