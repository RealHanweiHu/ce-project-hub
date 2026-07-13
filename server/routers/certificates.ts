import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createActivityLog,
  createProductCertificate,
  getProjectById,
  getProjectCertificationCoverage,
  listProductCertificates,
  reviewProductCertificate,
} from "../db";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";
import { ROLE_PERMISSIONS } from "./members";
import { isSystemAdminRole } from "../../shared/system-roles";
import { CERTIFICATE_SCOPE_TYPES, CERTIFICATE_TYPES } from "../../shared/certification";
import { isISODate } from "../../shared/scheduling";
import { updateCertificateRenewalPlan } from "../services/sop-blindspot-service";

const optionalDate = z.string().refine(isISODate, "日期必须是 YYYY-MM-DD").nullable().optional();

async function assertView(projectId: string, userId: number) {
  const role = await getEffectiveRole(projectId, userId);
  if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
  return role;
}

export const certificatesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertView(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId);
      if (!project?.productId) return [];
      return listProductCertificates(project.productId);
    }),

  coverage: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertView(input.projectId, ctx.user.id);
      return getProjectCertificationCoverage(input.projectId);
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      type: z.enum(CERTIFICATE_TYPES),
      scopeType: z.enum(CERTIFICATE_SCOPE_TYPES),
      revisionId: z.number().int().positive().nullable().optional(),
      certificateNumber: z.string().trim().max(256).nullable().optional(),
      issuingBody: z.string().trim().max(256).nullable().optional(),
      targetMarkets: z.array(z.string().trim().min(1).max(64)).max(64).default([]),
      validFrom: optionalDate,
      validUntil: optionalDate,
      evidenceReference: z.string().trim().max(2000).nullable().optional(),
      reuseApproved: z.boolean().default(false),
      reuseBasis: z.string().trim().max(5000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project?.productId) throw new TRPCError({ code: "BAD_REQUEST", message: "项目尚未关联产品" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      const canManage = isSystemAdminRole(ctx.user.role) ||
        ["cert", "qa", "battery_safety"].includes(role ?? "") ||
        (!!role && ROLE_PERMISSIONS[role].canEditProjectInfo);
      if (!canManage) throw new TRPCError({ code: "FORBIDDEN", message: "当前角色不能登记证书" });
      try {
        const row = await createProductCertificate({
          productId: project.productId,
          projectId: input.projectId,
          revisionId: input.scopeType === "revision" ? input.revisionId ?? project.baseRevisionId ?? null : null,
          type: input.type,
          scopeType: input.scopeType,
          certificateNumber: input.certificateNumber ?? null,
          issuingBody: input.issuingBody ?? null,
          targetMarkets: input.targetMarkets,
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
          evidenceFileId: null,
          evidenceReference: input.evidenceReference ?? null,
          reuseApproved: input.reuseApproved,
          reuseBasis: input.reuseBasis ?? null,
          createdBy: ctx.user.id,
        });
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "certificate.create",
          entityType: "certificate",
          entityId: String(row.id),
          meta: { type: row.type, scopeType: row.scopeType },
        });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "证书登记失败" });
      }
    }),

  review: protectedProcedure
    .input(z.object({ projectId: z.string(), certificateId: z.number().int().positive(), status: z.enum(["valid", "revoked"]) }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!isSystemAdminRole(ctx.user.role) && !["cert", "qa", "battery_safety"].includes(role ?? "")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有认证、QA 或电池安全角色可以确认/撤销证书" });
      }
      try {
        const project = await getProjectById(input.projectId);
        if (!project?.productId) throw new Error("项目尚未关联产品");
        const belongsToProduct = (await listProductCertificates(project.productId))
          .some((certificate) => certificate.id === input.certificateId);
        if (!belongsToProduct) throw new Error("证书不属于当前项目产品");
        const row = await reviewProductCertificate({ id: input.certificateId, status: input.status, reviewedBy: ctx.user.id });
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "certificate.review",
          entityType: "certificate",
          entityId: String(row.id),
          meta: { status: row.status },
        });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "证书审核失败" });
      }
    }),

  updateRenewal: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      certificateId: z.number().int().positive(),
      renewalOwnerUserId: z.number().int().positive(),
      renewalStatus: z.enum(["not_started", "planned", "in_progress", "renewed"]),
      renewalNotes: z.string().trim().max(5000).nullable().optional(),
      replacementCertificateId: z.number().int().positive().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!isSystemAdminRole(ctx.user.role) && !["cert", "qa", "battery_safety"].includes(role ?? "") && !(role && ROLE_PERMISSIONS[role].canEditProjectInfo)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "当前角色不能维护证书续期计划" });
      }
      try {
        const project = await getProjectById(input.projectId);
        if (!project?.productId) throw new Error("项目尚未关联产品");
        const productCertificates = await listProductCertificates(project.productId);
        const certificate = productCertificates.find((row) => row.id === input.certificateId);
        if (!certificate) throw new Error("证书不属于当前项目产品");
        if (input.replacementCertificateId) {
          if (input.replacementCertificateId === input.certificateId) throw new Error("替代证书不能是原证书自身");
          if (!productCertificates.some((row) => row.id === input.replacementCertificateId)) throw new Error("替代证书必须属于同一产品");
        }
        return await updateCertificateRenewalPlan(input);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "续期计划更新失败" });
      }
    }),
});
