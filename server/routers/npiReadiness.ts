import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createActivityLog,
  createProjectIssue,
  createProjectNpiReadinessCheck,
  getProjectFileById,
  getProjectNpiReadinessCheckById,
  getProjectNpiReadinessChecks,
  linkProjectNpiReadinessIssue,
  updateProjectNpiReadinessCheck,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import { assertProjectAccess, type ProjectAccess } from "../project-access";
import { getEffectivePhasesForProjectLike } from "../../shared/npd-v3";
import { NPI_READINESS_CATEGORIES, NPI_READINESS_STATUSES } from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";

const NPI_PHASES = new Set(["verification", "dvt", "pvt", "mp"]);

function assertNpiAuthority(access: ProjectAccess) {
  if (!access.isAdmin && !access.permissions.canNpiGateBlock) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 PE/NPI、生产或管理层可以维护 NPI readiness" });
  }
}

function assertInternalWorkspace(access: ProjectAccess) {
  if (!canRoleViewInternalWorkspace(access.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "外部协作者不能访问内部 NPI readiness" });
  }
}

function assertNpiPhase(access: ProjectAccess, phaseId: string) {
  const exists = getEffectivePhasesForProjectLike(access.project).some((phase) => phase.id === phaseId);
  if (!exists) throw new TRPCError({ code: "BAD_REQUEST", message: "项目阶段不存在" });
  if (!NPI_PHASES.has(phaseId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "NPI readiness 仅适用于验证、DVT、PVT、MP 阶段" });
  }
}

export const npiReadinessRouter = router({
  list: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) return [];
      return getProjectNpiReadinessChecks(input.projectId, input.phaseId);
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      title: z.string().trim().min(1).max(256),
      category: z.enum(NPI_READINESS_CATEGORIES).default("other"),
      status: z.enum(NPI_READINESS_STATUSES).default("pending"),
      ownerUserId: z.number().int().nullable().optional(),
      dueDate: z.string().trim().max(32).nullable().optional(),
      evidenceFileId: z.number().int().nullable().optional(),
      notes: z.string().trim().max(5000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertNpiAuthority(access);
      assertNpiPhase(access, input.phaseId);

      if (input.evidenceFileId != null) {
        const file = await getProjectFileById(input.evidenceFileId);
        if (!file || file.projectId !== input.projectId || file.phaseId !== input.phaseId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "NPI readiness 证据文件不属于当前阶段" });
        }
      }

      const id = await createProjectNpiReadinessCheck({
        projectId: input.projectId,
        phaseId: input.phaseId,
        title: input.title,
        category: input.category,
        status: input.status,
        ownerUserId: input.ownerUserId ?? null,
        dueDate: input.dueDate ?? null,
        evidenceFileId: input.evidenceFileId ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "npi_readiness.create",
        entityType: "npi_readiness",
        entityId: String(id),
        meta: { phaseId: input.phaseId, title: input.title, category: input.category, status: input.status },
      });
      return { success: true, id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      projectId: z.string(),
      title: z.string().trim().min(1).max(256).optional(),
      category: z.enum(NPI_READINESS_CATEGORIES).optional(),
      status: z.enum(NPI_READINESS_STATUSES).optional(),
      ownerUserId: z.number().int().nullable().optional(),
      dueDate: z.string().trim().max(32).nullable().optional(),
      evidenceFileId: z.number().int().nullable().optional(),
      notes: z.string().trim().max(5000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertNpiAuthority(access);
      const check = await getProjectNpiReadinessCheckById(input.id);
      if (!check || check.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NPI readiness 检查不存在" });
      }
      if (input.evidenceFileId != null) {
        const file = await getProjectFileById(input.evidenceFileId);
        if (!file || file.projectId !== input.projectId || file.phaseId !== check.phaseId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "NPI readiness 证据文件不属于当前阶段" });
        }
      }

      const { id, projectId, ...patch } = input;
      await updateProjectNpiReadinessCheck(id, { ...patch, updatedBy: ctx.user.id });
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "npi_readiness.update",
        entityType: "npi_readiness",
        entityId: String(id),
        meta: { phaseId: check.phaseId, patch },
      });
      return { success: true };
    }),

  createIssueFromCheck: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      owner: z.string().trim().max(256).nullable().optional(),
      targetDate: z.string().trim().max(32).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const check = await getProjectNpiReadinessCheckById(input.id);
      if (!check) throw new TRPCError({ code: "NOT_FOUND", message: "NPI readiness 检查不存在" });
      const access = await assertProjectAccess(check.projectId, ctx.user);
      assertInternalWorkspace(access);
      if (!access.isAdmin && !access.permissions.canEditIssues && !access.permissions.canNpiGateBlock) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有 PE/NPI、工程或管理层可以把 NPI 阻断转为 Issue" });
      }
      if (check.status !== "blocked") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只有阻断状态的 NPI readiness 需要转 Issue" });
      }
      if (check.relatedIssueId) {
        return { success: true, id: check.relatedIssueId, existed: true };
      }

      const description = [
        `来源 NPI readiness：${check.title}`,
        `类别：${check.category}`,
        check.notes ? `说明：${check.notes}` : null,
      ].filter(Boolean).join("\n");
      const issueId = await createProjectIssue({
        projectId: check.projectId,
        phaseId: check.phaseId,
        title: `[NPI 阻断] ${check.title}`,
        description,
        severity: "P1",
        status: "open",
        category: "other",
        owner: input.owner ?? null,
        reporter: ctx.user.name ?? null,
        foundDate: new Date().toISOString().slice(0, 10),
        targetDate: input.targetDate ?? null,
        relatedTaskId: null,
        creatorId: ctx.user.id,
        productId: access.project.productId ?? null,
      });
      const afterIssue = {
        id: issueId,
        projectId: check.projectId,
        phaseId: check.phaseId,
        title: `[NPI 阻断] ${check.title}`,
        description,
        severity: "P1",
        status: "open",
        category: "other",
        owner: input.owner ?? null,
        reporter: ctx.user.name ?? null,
        targetDate: input.targetDate ?? null,
        creatorId: ctx.user.id,
      };
      await linkProjectNpiReadinessIssue(check.id, issueId, ctx.user.id);
      await createActivityLog({
        projectId: check.projectId,
        userId: ctx.user.id,
        action: "npi_readiness.issue_create",
        entityType: "npi_readiness",
        entityId: String(check.id),
        meta: { phaseId: check.phaseId, issueId, title: check.title },
      });
      await createActivityLog({
        projectId: check.projectId,
        userId: ctx.user.id,
        action: "issue.create",
        entityType: "issue",
        entityId: String(issueId),
        meta: { phaseId: check.phaseId, title: afterIssue.title, severity: "P1", after: afterIssue },
      });
      await emitAutomationEvent({
        action: "issue.create",
        projectId: check.projectId,
        entityType: "issue",
        entityId: issueId,
        actorId: ctx.user.id,
        after: afterIssue,
      });
      return { success: true, id: issueId, existed: false };
    }),
});
