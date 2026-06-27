import { z } from "zod";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDb,
  createProduct, getProductById, listProductsByCategory,
  getProductDefinitionByProductId, listProductDefinitionStatuses,
  upsertProductDefinition, confirmProductDefinition, listProductDefinitionSnapshots,
  listProductDefinitionChanges, createProductDefinitionChange,
  getProductDefinitionChangeById, updateProductDefinitionChange,
  getProductDefinitionDeviation,
  createPlatform, listProductRevisions,
  setProjectProduct, getOpenP0P1Count, releaseProject, getProjectById,
  getReleaseGateStatus, isReleaseOverrideAuthorized,
  createCustomerVariant, listVariantsByCustomer, listVariantsByParentProduct,
  getDownstreamVariantImpact,
  getApprovalConfig, getExternalApprovalByProcessInstanceId,
} from "../db";
import { VARIANT_DIMENSIONS } from "../../shared/oem-variant";
import {
  findBestMatchingProductCategory,
  tidyProductCategory,
  uniqueProductCategories,
} from "../../shared/product-categories";
import {
  CHANGE_STATUSES, PRODUCT_DEFINITION_CHANGE_AREAS,
  products, projects, productDefinitions, productDefinitionSnapshots,
  productDefinitionChanges, productRevisions, customerVariants,
} from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";
import { assertProjectAccess, assertProjectPermission } from "../project-access";
import { cancelAndRecordProjectMeeting } from "../services/project-meeting-lifecycle";
import {
  listReleaseApprovals,
  MP_RELEASE_APPROVAL,
  submitReleaseApproval,
  syncExternalApprovalByProcessInstanceId,
} from "../services/external-approval-service";

const competitorSchema = z.object({
  brand: z.string().optional(),
  model: z.string().optional(),
  price: z.string().optional(),
  channel: z.string().optional(),
  strengths: z.string().optional(),
  weaknesses: z.string().optional(),
  notes: z.string().optional(),
});

const specSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  target: z.string().min(1),
  tolerance: z.string().optional(),
  verification: z.string().optional(),
  ownerRole: z.string().optional(),
});

const skuSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  targetMarket: z.string().optional(),
  price: z.string().optional(),
  differences: z.string().optional(),
  customerName: z.string().optional(),
});

const productDefinitionPatchSchema = z.object({
  title: z.string().default(""),
  opportunityName: z.string().default(""),
  opportunitySource: z.string().default(""),
  targetCustomers: z.string().nullable().optional(),
  targetMarkets: z.array(z.string()).default([]),
  applicationScenarios: z.string().nullable().optional(),
  competitors: z.array(competitorSchema).default([]),
  priceBand: z.string().default(""),
  positioning: z.string().nullable().optional(),
  sellingPoints: z.array(z.string()).default([]),
  differentiationStrategy: z.string().nullable().optional(),
  prdSummary: z.string().nullable().optional(),
  specs: z.array(specSchema).default([]),
  targetCost: z.string().default(""),
  targetPrice: z.string().default(""),
  targetGrossMargin: z.string().default(""),
  skuPlan: z.array(skuSchema).default([]),
});

const productDefinitionChangeCreateSchema = z.object({
  productId: z.string(),
  sourceProjectId: z.string().optional().nullable(),
  area: z.enum(PRODUCT_DEFINITION_CHANGE_AREAS).default("other"),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  requestedByCustomer: z.string().optional().nullable(),
  baselineValue: z.string().optional().nullable(),
  requestedValue: z.string().optional().nullable(),
  impactScope: z.array(z.string()).default([]),
  costImpact: z.string().optional().nullable(),
  priceImpact: z.string().optional().nullable(),
  scheduleImpact: z.string().optional().nullable(),
  status: z.enum(CHANGE_STATUSES).default("proposed"),
  decisionNotes: z.string().optional().nullable(),
});

const productDefinitionChangeUpdateSchema = productDefinitionChangeCreateSchema
  .omit({ productId: true })
  .partial()
  .extend({
    id: z.number(),
    productId: z.string(),
  });

function canMaintainProductDefinition(user: { id: number; role: string; canCreateProject?: boolean | null }, product: { createdBy: number }) {
  return user.role === "admin" || user.canCreateProject === true || product.createdBy === user.id;
}

async function resolveProductCategoryName(value: string): Promise<string> {
  const category = tidyProductCategory(value);
  if (!category) return "";
  const productRows = await listProductsByCategory();
  const existingCategories = uniqueProductCategories(productRows.map((row) => row.category));
  return findBestMatchingProductCategory(category, existingCategories)?.category ?? category;
}

export const productsRouter = router({
  list: protectedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(({ input }) => listProductsByCategory(input?.category)),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getProductById(input.id)),

  revisions: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(({ input }) => listProductRevisions(input.productId)),

  definition: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ input }) => (await getProductDefinitionByProductId(input.productId)) ?? null),

  definitionStatuses: protectedProcedure
    .query(() => listProductDefinitionStatuses()),

  definitionSnapshots: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(({ input }) => listProductDefinitionSnapshots(input.productId)),

  saveDefinition: protectedProcedure
    .input(z.object({
      productId: z.string(),
      patch: productDefinitionPatchSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const product = await getProductById(input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
      if (!canMaintainProductDefinition(ctx.user, product)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有维护产品定义的权限" });
      }
      const definition = await upsertProductDefinition(input.productId, ctx.user.id, {
        ...input.patch,
        targetCustomers: input.patch.targetCustomers ?? null,
        applicationScenarios: input.patch.applicationScenarios ?? null,
        positioning: input.patch.positioning ?? null,
        differentiationStrategy: input.patch.differentiationStrategy ?? null,
        prdSummary: input.patch.prdSummary ?? null,
      });
      return definition;
    }),

  confirmDefinition: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const product = await getProductById(input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
      if (!canMaintainProductDefinition(ctx.user, product)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有确认产品定义的权限" });
      }
      const existing = await getProductDefinitionByProductId(input.productId);
      if (!existing) throw new TRPCError({ code: "BAD_REQUEST", message: "请先保存产品定义" });
      if (!existing.positioning?.trim() || !existing.prdSummary?.trim() || existing.specs.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "定位、PRD 摘要和至少 1 条目标规格是确认产品定义的必填项" });
      }
      return confirmProductDefinition(input.productId, ctx.user.id);
    }),

  definitionChanges: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ input }) => listProductDefinitionChanges(input.productId)),

  definitionDeviation: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ input }) => getProductDefinitionDeviation(input.productId)),

  createDefinitionChange: protectedProcedure
    .input(productDefinitionChangeCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const product = await getProductById(input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
      if (!canMaintainProductDefinition(ctx.user, product)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有登记产品定义变更的权限" });
      }
      const change = await createProductDefinitionChange({
        ...input,
        sourceProjectId: input.sourceProjectId ?? null,
        description: input.description ?? null,
        reason: input.reason ?? null,
        requestedByCustomer: input.requestedByCustomer ?? null,
        baselineValue: input.baselineValue ?? null,
        requestedValue: input.requestedValue ?? null,
        costImpact: input.costImpact ?? null,
        priceImpact: input.priceImpact ?? null,
        scheduleImpact: input.scheduleImpact ?? null,
        decisionNotes: input.decisionNotes ?? null,
        createdBy: ctx.user.id,
      });
      return change;
    }),

  updateDefinitionChange: protectedProcedure
    .input(productDefinitionChangeUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const product = await getProductById(input.productId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
      if (!canMaintainProductDefinition(ctx.user, product)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有更新产品定义变更的权限" });
      }
      const existing = await getProductDefinitionChangeById(input.id);
      if (!existing || existing.productId !== input.productId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "产品定义变更不存在" });
      }
      const { id, productId, ...patch } = input;
      const change = await updateProductDefinitionChange(id, ctx.user.id, {
        ...patch,
        sourceProjectId: patch.sourceProjectId ?? undefined,
        description: patch.description ?? undefined,
        reason: patch.reason ?? undefined,
        requestedByCustomer: patch.requestedByCustomer ?? undefined,
        baselineValue: patch.baselineValue ?? undefined,
        requestedValue: patch.requestedValue ?? undefined,
        costImpact: patch.costImpact ?? undefined,
        priceImpact: patch.priceImpact ?? undefined,
        scheduleImpact: patch.scheduleImpact ?? undefined,
        decisionNotes: patch.decisionNotes ?? undefined,
      });
      return change;
    }),

  // ── OEM 客户版本 / Customer Revision（PLM 侧登记） ─────────────────────────
  variantsByCustomer: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .query(({ input }) => listVariantsByCustomer(input.customerId)),

  variantsByProduct: protectedProcedure
    .input(z.object({ parentProductId: z.string() }))
    .query(({ input }) => listVariantsByParentProduct(input.parentProductId)),

  /** 主版本 / BOM Revision 一改即列出受影响客户版本与 SKU（自有 ECO Gate 数据源） */
  downstreamImpact: protectedProcedure
    .input(z.object({
      parentProductId: z.string(),
      onlyActive: z.boolean().optional(),
      changedBomLines: z.array(z.string()).optional(),
    }))
    .query(({ input }) => getDownstreamVariantImpact(input.parentProductId, {
      onlyActive: input.onlyActive,
      changedBomLines: input.changedBomLines,
    })),

  createVariant: protectedProcedure
    .input(z.object({
      variantCode: z.string().min(1),
      customerSku: z.string().nullable().optional(),
      parentProductId: z.string().min(1),
      baseRevision: z.string().min(1),
      customerId: z.string().default(""),
      customerName: z.string().default(""),
      status: z.enum(["draft", "active", "on_hold", "eol"]).default("draft"),
      deltas: z.array(z.object({
        dimension: z.enum(VARIANT_DIMENSIONS as [string, ...string[]]),
        baseValue: z.string().optional(),
        variantValue: z.string(),
        bomImpact: z.array(z.string()).optional(),
        artworkRef: z.string().optional(),
        note: z.string().optional(),
      })).default([]),
      certReuseParent: z.boolean().default(true),
      certAffectedMarks: z.array(z.string()).default([]),
      certNotes: z.string().nullable().optional(),
      goldenSampleRef: z.string().nullable().optional(),
      customerApproved: z.boolean().default(false),
      approvedDate: z.string().nullable().optional(),
      sourceType: z.enum(["eco", "ecn"]),
      sourceRefId: z.string().min(1),
      introducedAt: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const product = await getProductById(input.parentProductId);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品型号不存在" });
      const hasCustomerBomRevision = input.deltas.some((delta) => delta.note === "customer_bom_revision" && delta.variantValue.trim());
      if (!hasCustomerBomRevision) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "客户版本必须登记基于标准 BOM 的 Customer BOM Revision，并通过 ECO/ECN 留痕。",
        });
      }
      const id = await createCustomerVariant({
        ...input,
        deltas: input.deltas as never,
        createdBy: ctx.user.id,
      });
      return { id };
    }),

  create: protectedProcedure
    .input(z.object({
      productNumber: z.string().default(""),
      name: z.string().min(1),
      type: z.enum(["finished", "component"]).default("finished"),
      category: z.string().default(""),
      platformId: z.string().optional(),
      targetMarkets: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      const category = await resolveProductCategoryName(input.category);
      await createProduct({ id, createdBy: ctx.user.id, ...input, category });
      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [product] = await db.select().from(products).where(eq(products.id, input.id));
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
      const allowed = ctx.user.role === "admin" || product.createdBy === ctx.user.id;
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const refs = await db.select({ id: projects.id }).from(projects).where(eq(projects.productId, input.id));
      if (refs.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `该产品被 ${refs.length} 个项目引用，请先在项目里解绑后再删除` });
      }

      await db.transaction(async (tx) => {
        await tx.delete(customerVariants).where(eq(customerVariants.parentProductId, input.id));
        await tx.delete(productDefinitionChanges).where(eq(productDefinitionChanges.productId, input.id));
        await tx.delete(productRevisions).where(eq(productRevisions.productId, input.id));
        await tx.delete(productDefinitionSnapshots).where(eq(productDefinitionSnapshots.productId, input.id));
        await tx.delete(productDefinitions).where(eq(productDefinitions.productId, input.id));
        await tx.delete(products).where(eq(products.id, input.id));
      });
      return { success: true } as const;
    }),

  createPlatform: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.string().default(""),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      const category = await resolveProductCategoryName(input.category);
      await createPlatform({ id, createdBy: ctx.user.id, ...input, category });
      return { id };
    }),

  setProject: protectedProcedure
    .input(z.object({ projectId: z.string(), productId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectPermission(input.projectId, ctx.user, "canEditProjectInfo", "没有关联产品的权限");
      await setProjectProduct(input.projectId, input.productId);
      return { ok: true };
    }),

  releasePrecheck: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { project } = await assertProjectAccess(input.projectId, ctx.user);
      const openP0P1 = await getOpenP0P1Count(input.projectId);
      const gate = await getReleaseGateStatus(project);
      const hasProduct = !!project.productId;
      const failedHardDimensions = gate.dimensions.filter((d) => !d.ok && d.dimension !== "review_conditions");

      const hardPass =
        hasProduct && openP0P1 === 0 &&
        gate.phaseId !== null && failedHardDimensions.length === 0 &&
        gate.decision !== null && gate.decision !== "rejected";

      const canRelease = hardPass && gate.ready && gate.decision === "approved";
      const canForceRelease = hardPass && gate.decision === "conditional" &&
        await isReleaseOverrideAuthorized(project, { id: ctx.user.id, role: ctx.user.role });

      const blockers: string[] = [];
      if (!hasProduct) blockers.push("未关联产品");
      if (openP0P1 > 0) blockers.push(`${openP0P1} 个未关闭的 P0/P1 问题`);
      if (gate.phaseId === null) blockers.push("未定义 MP Release 前置 Gate");
      for (const dim of failedHardDimensions) {
        if (dim.dimension === "deliverables") {
          blockers.push(`前置 Gate 交付物未审核通过（${gate.deliverables.done}/${gate.deliverables.total}）`);
        } else if (dim.dimension === "prereq") {
          blockers.push(`前置 Gate 任务未完成：${dim.blockers.join("、")}`);
        } else if (dim.dimension === "critical_issues") {
          blockers.push(`前置 Gate 本阶段仍有 P0/P1：${dim.blockers.join("、")}`);
        } else {
          blockers.push(dim.summary);
        }
      }
      if (gate.decision === null) blockers.push("前置 Gate 无评审记录");
      else if (gate.decision === "rejected") blockers.push("前置 Gate 已驳回");
      else if (gate.decision === "conditional") blockers.push("前置 Gate 为有条件通过，需强制发布");

      // 产品主版本 / BOM Revision 变更发布时，列出下游客户版本与 SKU（非阻断，仅提示复核）。
      const downstreamVariants = project.productId
        ? await getDownstreamVariantImpact(project.productId, { onlyActive: true })
        : [];
      const approvalInstances = await listReleaseApprovals(input.projectId);
      const pendingApproval = approvalInstances.find((approval) => approval.status === "pending") ?? null;
      const approvalConfig = await getApprovalConfig(MP_RELEASE_APPROVAL);

      return {
        hasProduct,
        productId: project.productId ?? null,
        downstreamVariants,
        approvalRequired: !!approvalConfig?.enabled,
        approvalInstances,
        pendingApproval,
        openP0P1,
        releaseGate: gate.phaseId === null ? null : {
          phaseId: gate.phaseId, gateName: gate.gateName,
          decision: gate.decision, conditions: gate.conditions, roundNumber: gate.roundNumber,
          ready: gate.ready, dimensions: gate.dimensions,
        },
        deliverables: gate.deliverables,
        blockers, canRelease, canForceRelease,
      };
    }),

  submitReleaseApproval: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      override: z.object({
        overrideReason: z.string().min(1),
        followUpOwner: z.number(),
        dueDate: z.string().min(1),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectPermission(input.projectId, ctx.user, "canEditProjectInfo", "没有发起发布审批的权限");
      try {
        const result = await submitReleaseApproval({
          projectId: input.projectId,
          actor: { id: ctx.user.id, role: ctx.user.role },
          override: input.override,
        });
        return { success: true, approval: result.instance, alreadyPending: result.alreadyPending } as const;
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
    }),

  syncReleaseApproval: protectedProcedure
    .input(z.object({ projectId: z.string(), processInstanceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user);
      const existing = await getExternalApprovalByProcessInstanceId(input.processInstanceId);
      if (!existing || existing.entityId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "审批实例不存在" });
      }
      try {
        const approval = await syncExternalApprovalByProcessInstanceId(input.processInstanceId);
        return { success: true, approval } as const;
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
    }),

  release: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      notes: z.string().optional(),
      override: z.object({
        overrideReason: z.string().min(1),
        followUpOwner: z.number(),
        dueDate: z.string().min(1),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectPermission(input.projectId, ctx.user, "canEditProjectInfo", "没有量产发布权限");
      try {
        const approvalConfig = await getApprovalConfig(MP_RELEASE_APPROVAL);
        if (approvalConfig?.enabled) {
          throw new Error("已启用钉钉发布审批，请先发起并通过 MP Release 审批");
        }
        const project = await getProjectById(input.projectId);
        const product = project?.productId ? await getProductById(project.productId) : undefined;
        const result = await releaseProject({
          projectId: input.projectId,
          actor: { id: ctx.user.id, role: ctx.user.role },
          notes: input.notes,
          override: input.override,
        });
        if (project && (project.dingtalkEventId || (project.meetingConfig as { enabled?: boolean } | null)?.enabled)) {
          try { await cancelAndRecordProjectMeeting(project); }
          catch (error) { console.warn("[meeting] cancel on release failed (non-fatal):", error); }
        }
        await emitAutomationEvent({
          action: "mp.release",
          projectId: input.projectId,
          entityType: "mp_release",
          entityId: `${input.projectId}:${result.revisionId}`,
          actorId: ctx.user.id,
          after: {
            projectId: input.projectId,
            productId: project?.productId ?? null,
            productName: product?.name ?? null,
            revisionId: result.revisionId,
            revisionLabel: result.revisionLabel,
          },
        });
        return result;
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
    }),
});
