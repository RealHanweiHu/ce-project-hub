import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createActivityLog,
  createProjectRequirement,
  createProjectIssue,
  createProjectChangeRecord,
  deleteProjectRequirement,
  getProjectById,
  getRequirements,
  getRequirementById,
  updateProjectRequirement,
  adoptAndLinkRequirement,
} from "../db";
import {
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_SOURCES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  CHANGE_TYPES,
  type ProjectRequirement,
} from "../../drizzle/schema";
import { ROLE_PERMISSIONS } from "./members";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import { isSystemAdminRole } from "../../shared/system-roles";

/** 鉴权:项目内需求按项目角色;无项目(产品/全局 backlog)归 admin 或创建人。 */
async function assertCanEditRequirement(
  user: { id: number; role: string },
  req: ProjectRequirement
): Promise<void> {
  if (req.projectId) {
    const role = await getEffectiveRole(req.projectId, user.id);
    if (!role || !ROLE_PERMISSIONS[role].canEditRequirements) {
      throw new TRPCError({ code: "FORBIDDEN", message: "没有维护需求池的权限" });
    }
  } else if (!isSystemAdminRole(user.role) && req.creatorId !== user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员或创建人可维护该需求" });
  }
}

const requirementPatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  source: z.enum(REQUIREMENT_SOURCES).optional(),
  sourceDetail: z.string().optional().nullable(),
  type: z.enum(REQUIREMENT_TYPES).optional(),
  priority: z.enum(REQUIREMENT_PRIORITIES).optional(),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
  owner: z.string().optional().nullable(),
  targetPhaseId: z.string().optional().nullable(),
  linkedTaskId: z.string().optional().nullable(),
  businessGoal: z.string().optional().nullable(),
  projectGoal: z.string().optional().nullable(),
  successMetric: z.string().optional().nullable(),
  acceptanceCriteria: z.string().optional().nullable(),
  decisionNote: z.string().optional().nullable(),
});

export const requirementsRouter = router({
  /**
   * 统一需求池列表。一套池子、多视图:
   * - 传 projectId → 项目视图(本项目提出 ∪ 本产品待承接);需项目查看权限
   * - 传 productId → 产品视图;登录即可见
   * - 都不传    → 全局视图;登录即可见
   */
  list: protectedProcedure
    .input(z.object({
      projectId: z.string().optional(),
      productId: z.string().optional(),
      scope: z.enum(["project", "product", "global"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const scope = input.scope ?? (input.projectId ? "project" : input.productId ? "product" : "global");
      if (scope === "project") {
        if (!input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "缺少 projectId" });
        const project = await getProjectById(input.projectId);
        if (!project) throw new TRPCError({ code: "NOT_FOUND" });
        const role = await getEffectiveRole(input.projectId, ctx.user.id);
        if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
        if (!canRoleViewInternalWorkspace(role)) return [];
        return getRequirements({ scope: "project", projectId: input.projectId, productId: project.productId ?? null });
      }
      if (scope === "product") {
        if (!input.productId) throw new TRPCError({ code: "BAD_REQUEST", message: "缺少 productId" });
        return getRequirements({ scope: "product", productId: input.productId });
      }
      return getRequirements({ scope: "global" });
    }),

  /**
   * 创建需求。
   * - 传 projectId → 项目内提需求,需 canEditRequirements,productId 继承自项目
   * - 不传 projectId → 产品/全局 backlog 收集,登录即可提(可带 productId)
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string().optional().nullable(),
        productId: z.string().optional().nullable(),
        title: z.string().min(1),
        description: z.string().optional().nullable(),
        source: z.enum(REQUIREMENT_SOURCES).default("internal"),
        sourceDetail: z.string().optional().nullable(),
        type: z.enum(REQUIREMENT_TYPES).default("functional"),
        priority: z.enum(REQUIREMENT_PRIORITIES).default("P2"),
        status: z.enum(REQUIREMENT_STATUSES).default("new"),
        owner: z.string().optional().nullable(),
        targetPhaseId: z.string().optional().nullable(),
        linkedTaskId: z.string().optional().nullable(),
        businessGoal: z.string().optional().nullable(),
        projectGoal: z.string().optional().nullable(),
        successMetric: z.string().optional().nullable(),
        acceptanceCriteria: z.string().optional().nullable(),
        decisionNote: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, productId, ...rest } = input;
      let resolvedProductId = productId ?? null;
      if (projectId) {
        const role = await getEffectiveRole(projectId, ctx.user.id);
        if (!role || !ROLE_PERMISSIONS[role].canEditRequirements) {
          throw new TRPCError({ code: "FORBIDDEN", message: "没有维护需求池的权限" });
        }
        const project = await getProjectById(projectId);
        if (!project) throw new TRPCError({ code: "NOT_FOUND" });
        resolvedProductId = project.productId ?? resolvedProductId;
        rest.businessGoal = rest.businessGoal ?? project.value ?? null;
        rest.projectGoal = rest.projectGoal ?? project.description ?? project.background ?? null;
      }

      const id = await createProjectRequirement({
        ...rest,
        projectId: projectId ?? null,
        productId: resolvedProductId,
        creatorId: ctx.user.id,
      });
      if (projectId) {
        await createActivityLog({
          projectId,
          userId: ctx.user.id,
          action: "requirement.create",
          entityType: "requirement",
          entityId: String(id),
          meta: { title: input.title, source: input.source, priority: input.priority },
        });
      }
      return { success: true, id };
    }),

  /** Update a requirement. 鉴权按需求自身归属(项目角色 / admin+创建人)。 */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        projectId: z.string().optional().nullable(), // 兼容旧调用,鉴权不依赖它
        patch: requirementPatchSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getRequirementById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanEditRequirement(ctx.user, existing);

      await updateProjectRequirement(input.id, input.patch);
      if (existing.projectId) {
        await createActivityLog({
          projectId: existing.projectId,
          userId: ctx.user.id,
          action: "requirement.update",
          entityType: "requirement",
          entityId: String(input.id),
          meta: { patch: input.patch },
        });
      }
      return { success: true };
    }),

  /** Delete a requirement. */
  delete: protectedProcedure
    .input(z.object({ id: z.number(), projectId: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getRequirementById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanEditRequirement(ctx.user, existing);

      await deleteProjectRequirement(input.id);
      if (existing.projectId) {
        await createActivityLog({
          projectId: existing.projectId,
          userId: ctx.user.id,
          action: "requirement.delete",
          entityType: "requirement",
          entityId: String(input.id),
          meta: { title: existing.title },
        });
      }
      return { success: true };
    }),

  /**
   * 采纳转化:把需求转成项目任务 / 问题 / 变更。
   * - issue/change:在目标项目自动创建实体并回链
   * - task:关联到目标项目的某个 SOP 任务(taskId)
   * 转化后需求归属目标项目、状态置 accepted、记录 convertedType/convertedId。
   */
  convert: protectedProcedure
    .input(z.object({
      id: z.number(),
      target: z.enum(["task", "issue", "change"]),
      projectId: z.string(),                  // 目标项目(产品/全局 backlog 转化时由前端指定)
      phaseId: z.string().optional(),         // issue/task 用
      taskId: z.string().optional(),          // target=task:关联到的 SOP 任务
      changeType: z.enum(CHANGE_TYPES).optional(),
      note: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const req = await getRequirementById(input.id);
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanEditRequirement(ctx.user, req);

      // 目标项目编辑权限
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditRequirements) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有在目标项目转化需求的权限" });
      }
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "目标项目不存在" });
      const productId = req.productId ?? project.productId ?? null;

      let convertedId: string;
      if (input.target === "issue") {
        const phaseId = input.phaseId || req.targetPhaseId || project.currentPhase;
        const issueId = await createProjectIssue({
          projectId: input.projectId,
          phaseId,
          title: req.title,
          description: req.description ?? null,
          severity: req.priority,                 // 需求优先级 P0-P3 与问题严重度同枚举
          category: "other",
          relatedTaskId: req.linkedTaskId ?? null,
          productId,
          creatorId: ctx.user.id,
        });
        convertedId = String(issueId);
      } else if (input.target === "change") {
        const changeId = await createProjectChangeRecord({
          projectId: input.projectId,
          title: req.title,
          description: req.description ?? null,
          reason: req.description ?? null,
          type: input.changeType ?? "other",
          productId,
          creatorId: ctx.user.id,
        });
        convertedId = String(changeId);
      } else {
        if (!input.taskId) throw new TRPCError({ code: "BAD_REQUEST", message: "转为任务需指定 taskId" });
        convertedId = input.taskId;
      }

      await adoptAndLinkRequirement(req.id, {
        projectId: input.projectId,
        status: "accepted",
        convertedType: input.target,
        convertedId,
        ...(input.target === "task"
          ? { targetPhaseId: input.phaseId ?? req.targetPhaseId, linkedTaskId: input.taskId }
          : {}),
        decisionNote: input.note ?? req.decisionNote,
      });

      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "requirement.convert",
        entityType: "requirement",
        entityId: String(req.id),
        meta: { target: input.target, convertedId, title: req.title },
      });
      return { success: true, target: input.target, convertedId };
    }),
});
