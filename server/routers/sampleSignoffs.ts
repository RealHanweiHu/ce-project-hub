import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createActivityLog,
  createProjectSampleSignoff,
  getProjectFileById,
  getProjectSampleSignoffById,
  getProjectSampleSignoffs,
  respondProjectSampleSignoff,
  updateProjectSampleSignoff,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { canRoleViewFileVisibility, canRoleViewInternalWorkspace } from "../file-visibility";
import { assertProjectAccess, type ProjectAccess } from "../project-access";
import { getPhasesForCategory } from "../../shared/sop-templates";
import {
  SAMPLE_SIGNOFF_AUDIENCES,
  SAMPLE_SIGNOFF_STATUSES,
  SAMPLE_SIGNOFF_TYPES,
  type ProjectFileVisibility,
  type ProjectMemberRole,
  type SampleSignoffAudience,
} from "../../drizzle/schema";

const SIGNOFF_MANAGER_ROLES = new Set<ProjectMemberRole>([
  "owner",
  "manager",
  "project_manager",
  "pm",
  "sales",
  "scm",
]);

function visibleAudienceForRole(role: ProjectMemberRole): SampleSignoffAudience | null {
  if (role === "external_customer" || role === "sales") return "customer";
  if (role === "supplier") return "supplier";
  return null;
}

function assertCanManageSignoff(access: ProjectAccess) {
  if (access.isAdmin) return;
  if (!SIGNOFF_MANAGER_ROLES.has(access.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 PM、项目经理、销售/客户经理、SCM 或管理层可以维护样品签样项" });
  }
}

function assertPhaseExists(access: ProjectAccess, phaseId: string) {
  const exists = getPhasesForCategory(access.project.category).some((phase) => phase.id === phaseId);
  if (!exists) throw new TRPCError({ code: "BAD_REQUEST", message: "项目阶段不存在" });
}

function expectedFileVisibility(audience: SampleSignoffAudience): ProjectFileVisibility[] {
  if (audience === "customer") return ["customer", "public"];
  if (audience === "supplier") return ["supplier", "public"];
  return ["internal"];
}

async function assertSignoffFile(input: {
  fileId: number | null | undefined;
  projectId: string;
  phaseId: string;
  audience: SampleSignoffAudience;
}) {
  if (input.fileId == null) return;
  const file = await getProjectFileById(input.fileId);
  if (!file || file.projectId !== input.projectId || file.phaseId !== input.phaseId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "签样文件不属于当前阶段" });
  }
  const allowed = expectedFileVisibility(input.audience);
  if (!allowed.includes(file.visibility as ProjectFileVisibility)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: input.audience === "customer"
        ? "客户签样只能绑定 customer/public 可见文件"
        : input.audience === "supplier"
          ? "供应商签样只能绑定 supplier/public 可见文件"
          : "内部签样只能绑定 internal 文件",
    });
  }
}

function canRespond(access: ProjectAccess, audience: SampleSignoffAudience, status: "approved" | "rejected" | "waived") {
  if (access.isAdmin) return true;
  if (access.role === "external_customer") return audience === "customer" && status !== "waived";
  if (access.role === "supplier") return audience === "supplier" && status !== "waived";
  return SIGNOFF_MANAGER_ROLES.has(access.role);
}

export const sampleSignoffsRouter = router({
  list: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      const audience = visibleAudienceForRole(access.role);
      if (audience) return getProjectSampleSignoffs(input.projectId, input.phaseId, audience);
      if (!canRoleViewInternalWorkspace(access.role)) return [];
      return getProjectSampleSignoffs(input.projectId, input.phaseId);
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      title: z.string().trim().min(1).max(256),
      signoffType: z.enum(SAMPLE_SIGNOFF_TYPES).default("other"),
      audience: z.enum(SAMPLE_SIGNOFF_AUDIENCES).default("customer"),
      sampleSerials: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
      fileId: z.number().int().nullable().optional(),
      dueDate: z.string().trim().max(32).nullable().optional(),
      notes: z.string().trim().max(5000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      assertCanManageSignoff(access);
      assertPhaseExists(access, input.phaseId);
      if (input.audience === "internal" && !canRoleViewInternalWorkspace(access.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "外部协作者不能创建内部签样项" });
      }
      if (input.fileId != null && !canRoleViewFileVisibility(access.role, input.audience === "customer" ? "customer" : input.audience === "supplier" ? "supplier" : "internal")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权绑定该可见性范围的文件" });
      }
      await assertSignoffFile({
        fileId: input.fileId,
        projectId: input.projectId,
        phaseId: input.phaseId,
        audience: input.audience,
      });

      const id = await createProjectSampleSignoff({
        projectId: input.projectId,
        phaseId: input.phaseId,
        title: input.title,
        signoffType: input.signoffType,
        audience: input.audience,
        status: "pending",
        sampleSerials: input.sampleSerials,
        fileId: input.fileId ?? null,
        dueDate: input.dueDate ?? null,
        requestedBy: ctx.user.id,
        notes: input.notes ?? null,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "sample_signoff.create",
        entityType: "sample_signoff",
        entityId: String(id),
        meta: { phaseId: input.phaseId, title: input.title, audience: input.audience, signoffType: input.signoffType },
      });
      return { success: true, id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      projectId: z.string(),
      title: z.string().trim().min(1).max(256).optional(),
      signoffType: z.enum(SAMPLE_SIGNOFF_TYPES).optional(),
      sampleSerials: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
      fileId: z.number().int().nullable().optional(),
      dueDate: z.string().trim().max(32).nullable().optional(),
      notes: z.string().trim().max(5000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const signoff = await getProjectSampleSignoffById(input.id);
      if (!signoff || signoff.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "样品签样项不存在" });
      }
      const access = await assertProjectAccess(signoff.projectId, ctx.user);
      assertCanManageSignoff(access);
      if (input.fileId !== undefined) {
        await assertSignoffFile({
          fileId: input.fileId,
          projectId: signoff.projectId,
          phaseId: signoff.phaseId,
          audience: signoff.audience,
        });
      }

      const { id, projectId, ...patch } = input;
      await updateProjectSampleSignoff(id, patch);
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "sample_signoff.update",
        entityType: "sample_signoff",
        entityId: String(id),
        meta: { phaseId: signoff.phaseId, patch },
      });
      return { success: true };
    }),

  respond: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(SAMPLE_SIGNOFF_STATUSES).refine((status) => status !== "pending", {
        message: "签样回应必须是 approved、rejected 或 waived",
      }),
      responseNote: z.string().trim().max(5000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const signoff = await getProjectSampleSignoffById(input.id);
      if (!signoff) throw new TRPCError({ code: "NOT_FOUND", message: "样品签样项不存在" });
      const access = await assertProjectAccess(signoff.projectId, ctx.user);
      if (!canRespond(access, signoff.audience, input.status as "approved" | "rejected" | "waived")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权回应该签样项" });
      }
      await respondProjectSampleSignoff(
        input.id,
        ctx.user.id,
        input.status as "approved" | "rejected" | "waived",
        input.responseNote ?? null,
      );
      await createActivityLog({
        projectId: signoff.projectId,
        userId: ctx.user.id,
        action: "sample_signoff.respond",
        entityType: "sample_signoff",
        entityId: String(input.id),
        meta: { phaseId: signoff.phaseId, title: signoff.title, audience: signoff.audience, status: input.status },
      });
      return { success: true };
    }),
});
