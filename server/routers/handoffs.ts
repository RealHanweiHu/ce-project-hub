import { nanoid } from "nanoid";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  acceptProjectCloseHandoff,
  createActivityLog,
  createProductServiceCase,
  createProjectWithSeed,
  evaluateProductCertificationCoverage,
  getProjectById,
  getProjectCloseHandoff,
  getProjectCloseHandoffReadiness,
  getProjectMembers,
  getProductById,
  getUserById,
  listProductServiceCases,
  saveProjectCloseHandoffDraft,
  submitProjectCloseHandoff,
  updateProductServiceCase,
} from "../db";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";
import { ROLE_PERMISSIONS } from "./members";
import {
  PRODUCT_SERVICE_CASE_SEVERITIES,
  PRODUCT_SERVICE_CASE_STATUSES,
  PROJECT_CLOSE_HANDOFF_ITEM_KEYS,
} from "../../drizzle/schema";
import {
  isSystemAdminRole,
  isSystemExternalRole,
  systemRoleCanCreateProject,
} from "../../shared/system-roles";
import {
  deriveSopRiskAssessment,
  EMPTY_CHANGE_SCOPE_DECLARATION,
} from "../../shared/sop-risk";
import {
  getPhasesForCategory,
  SOP_TEMPLATE_VERSION_CURRENT,
} from "../../shared/sop-templates";
import { certificationRequirementLabel } from "../../shared/certification";

const changeScopeDeclarationSchema = z.object({
  batteryCellChange: z.boolean().default(false),
  batteryPackOrBmsChange: z.boolean().default(false),
  protectionParameterChange: z.boolean().default(false),
  powerOrThermalBoundaryChange: z.boolean().default(false),
  pressurizedStructureChange: z.boolean().default(false),
  targetMarketExpansion: z.boolean().default(false),
  criticalSafetySupplierChange: z.boolean().default(false),
  safetyRelatedSoftwareChange: z.boolean().default(false),
  eolTestChange: z.boolean().default(false),
  otherSafetyOrRegulatoryChange: z.boolean().default(false),
  targetMarkets: z.array(z.string().trim().min(1).max(32)).max(32).default([]),
  notes: z.string().trim().max(2000).nullable().optional(),
}).default(EMPTY_CHANGE_SCOPE_DECLARATION);

async function projectAccess(projectId: string, userId: number) {
  const role = await getEffectiveRole(projectId, userId);
  if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
  return role;
}

async function assertInternalHandoffOwner(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  const members = await getProjectMembers(projectId);
  const member = members.find((item) => item.userId === userId);
  if (project.createdBy !== userId && !member) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "移交责任人必须先加入项目，确保其能查看并接收移交" });
  }
  if (member && ["external_customer", "supplier"].includes(member.role)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "外部客户或供应商不能承接内部产品维护责任" });
  }
  const user = await getUserById(userId);
  if (!user) throw new TRPCError({ code: "BAD_REQUEST", message: "责任人不存在" });
}

async function assertInternalProductAccess(user: { role: string }) {
  if (isSystemExternalRole(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "外部协作账号不能访问产品运营入口" });
  }
}

export const handoffsRouter = router({
  detail: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await projectAccess(input.projectId, ctx.user.id);
      return getProjectCloseHandoff(input.projectId);
    }),

  readiness: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await projectAccess(input.projectId, ctx.user.id);
      return getProjectCloseHandoffReadiness(input.projectId);
    }),

  saveDraft: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      maintenanceOwnerUserId: z.number().int().positive(),
      afterSalesOwnerUserId: z.number().int().positive(),
      scopeSummary: z.string().trim().min(1).max(5000),
      items: z.array(z.object({
        itemKey: z.enum(PROJECT_CLOSE_HANDOFF_ITEM_KEYS),
        completed: z.boolean(),
        evidenceReference: z.string().trim().max(5000).nullable(),
      })).length(PROJECT_CLOSE_HANDOFF_ITEM_KEYS.length),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await projectAccess(input.projectId, ctx.user.id);
      if (!isSystemAdminRole(ctx.user.role) && !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有项目 Owner、管理层或项目经理可以编制关闭移交单" });
      }
      await Promise.all([
        assertInternalHandoffOwner(input.projectId, input.maintenanceOwnerUserId),
        assertInternalHandoffOwner(input.projectId, input.afterSalesOwnerUserId),
      ]);
      try {
        const row = await saveProjectCloseHandoffDraft({ ...input, savedBy: ctx.user.id });
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "handoff.save",
          entityType: "close_handoff",
          entityId: String(row.handoff.id),
          meta: { status: row.handoff.status, maintenanceOwnerUserId: input.maintenanceOwnerUserId, afterSalesOwnerUserId: input.afterSalesOwnerUserId },
        });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "移交单保存失败" });
      }
    }),

  submit: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const role = await projectAccess(input.projectId, ctx.user.id);
      if (!isSystemAdminRole(ctx.user.role) && !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有提交移交的权限" });
      }
      try {
        const row = await submitProjectCloseHandoff(input.projectId, ctx.user.id);
        await createActivityLog({ projectId: input.projectId, userId: ctx.user.id, action: "handoff.submit", entityType: "close_handoff", entityId: String(row.handoff.id), meta: { maintenanceOwnerUserId: row.handoff.maintenanceOwnerUserId } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "移交提交失败" });
      }
    }),

  accept: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await projectAccess(input.projectId, ctx.user.id);
      try {
        const row = await acceptProjectCloseHandoff(input.projectId, ctx.user.id, isSystemAdminRole(ctx.user.role));
        await createActivityLog({ projectId: input.projectId, userId: ctx.user.id, action: "handoff.accept", entityType: "close_handoff", entityId: String(row.handoff.id), meta: { productId: row.handoff.productId, revisionId: row.handoff.revisionId } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "移交接收失败" });
      }
    }),

  serviceCases: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertInternalProductAccess(ctx.user);
      const product = await getProductById(input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
      return listProductServiceCases(input.productId);
    }),

  createServiceCase: protectedProcedure
    .input(z.object({
      productId: z.string(),
      title: z.string().trim().min(1).max(256),
      description: z.string().trim().min(1).max(5000),
      severity: z.enum(PRODUCT_SERVICE_CASE_SEVERITIES).default("P2"),
      sourceProjectId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertInternalProductAccess(ctx.user);
      const product = await getProductById(input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
      if (!product.afterSalesOwnerUserId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "产品尚未完成关闭移交，未配置售后责任人" });
      }
      const row = await createProductServiceCase({
        caseNumber: `AS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${nanoid(6).toUpperCase()}`,
        productId: input.productId,
        revisionId: product.currentRevisionId,
        sourceProjectId: input.sourceProjectId ?? null,
        title: input.title,
        description: input.description,
        severity: input.severity,
        ownerUserId: product.afterSalesOwnerUserId,
        createdBy: ctx.user.id,
      });
      return row;
    }),

  updateServiceCase: protectedProcedure
    .input(z.object({
      productId: z.string(),
      id: z.number().int().positive(),
      status: z.enum(PRODUCT_SERVICE_CASE_STATUSES),
      ownerUserId: z.number().int().positive().optional(),
      resolutionNote: z.string().trim().max(5000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertInternalProductAccess(ctx.user);
      const product = await getProductById(input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
      const allowed = isSystemAdminRole(ctx.user.role) ||
        product.maintenanceOwnerUserId === ctx.user.id ||
        product.afterSalesOwnerUserId === ctx.user.id;
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "只有产品维护或售后责任人可以更新售后记录" });
      return updateProductServiceCase({
        id: input.id,
        productId: input.productId,
        status: input.status,
        ownerUserId: input.ownerUserId,
        resolutionNote: input.resolutionNote,
      });
    }),

  createEco: protectedProcedure
    .input(z.object({
      productId: z.string(),
      serviceCaseId: z.number().int().positive().nullable().optional(),
      name: z.string().trim().min(1).max(256),
      reason: z.string().trim().min(1).max(5000),
      changeScopeDeclaration: changeScopeDeclarationSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      await assertInternalProductAccess(ctx.user);
      const product = await getProductById(input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
      if (product.lifecycleState === "eol") throw new TRPCError({ code: "BAD_REQUEST", message: "产品已停产，不能发起新的 ECO" });
      const allowed = isSystemAdminRole(ctx.user.role) ||
        systemRoleCanCreateProject(ctx.user) ||
        product.maintenanceOwnerUserId === ctx.user.id;
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "只有产品维护责任人或具备建项权限的人员可以发起 ECO" });
      const id = `eco_${nanoid(16)}`;
      const serviceCase = input.serviceCaseId
        ? (await listProductServiceCases(product.id)).find((item) => item.id === input.serviceCaseId)
        : null;
      if (input.serviceCaseId && !serviceCase) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "关联售后记录不存在" });
      }
      const declaration = changeScopeDeclarationSchema.parse(input.changeScopeDeclaration);
      const coverage = await evaluateProductCertificationCoverage({
        productId: product.id,
        projectId: id,
        declaration,
        baselineTargetMarkets: product.targetMarkets ?? [],
        baseRevisionId: null,
      });
      const assessment = deriveSopRiskAssessment({
        declaration,
        baselineTargetMarkets: product.targetMarkets ?? [],
        certificateCoverageMissingReasons: coverage.missing.map(certificationRequirementLabel),
      });
      const firstPhase = getPhasesForCategory("eco", SOP_TEMPLATE_VERSION_CURRENT)[0];
      const projectNumberBase = (product.productNumber || product.name).replace(/\s+/g, "-").slice(0, 28);
      await createProjectWithSeed({
        id,
        name: input.name,
        projectNumber: `ECO-${projectNumberBase}-${nanoid(5).toUpperCase()}`,
        category: "eco",
        sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
        pmUserId: product.maintenanceOwnerUserId ?? ctx.user.id,
        productId: null,
        baseRevisionId: null,
        resultRevisionId: null,
        productDefinitionSnapshotId: null,
        safetyRiskLevel: assessment.safetyRiskLevel,
        regulatoryRiskLevel: assessment.regulatoryRiskLevel,
        description: input.reason,
        customer: null,
        background: "由产品维护轴发起",
        value: null,
        customFields: {
          sourceProductId: product.id,
          sourceServiceCaseId: serviceCase?.id ?? null,
          productType: product.category,
        },
        risk: "low",
        currentPhase: firstPhase?.id ?? "change_request",
        progress: 0,
        startDate: new Date().toISOString().slice(0, 10),
        targetDate: null,
        createdBy: ctx.user.id,
        archived: false,
      }, "eco", ctx.user.id, { declaration, assessment });
      if (serviceCase) {
        await updateProductServiceCase({
          id: serviceCase.id,
          productId: product.id,
          status: "in_progress",
          linkedEcoProjectId: id,
          resolutionNote: `已转入 ECO：${id}`,
        });
      }
      await createActivityLog({ projectId: id, userId: ctx.user.id, action: "project.create", entityType: "project", entityId: id, meta: { source: "product_maintenance", productId: product.id, serviceCaseId: input.serviceCaseId ?? null } });
      return { id };
    }),
});
