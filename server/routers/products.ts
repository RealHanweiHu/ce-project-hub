import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createProduct, getProductById, listProductsByCategory,
  createPlatform, listProductRevisions,
  setProjectProduct, getOpenP0P1Count, releaseProject, getProjectById,
  getReleaseGateStatus, isReleaseOverrideAuthorized,
  createCustomerVariant, listVariantsByCustomer, listVariantsByParentProduct,
  getDownstreamVariantImpact,
} from "../db";
import { VARIANT_DIMENSIONS } from "../../shared/oem-variant";
import { emitAutomationEvent } from "../automation/events";
import { assertProjectAccess, assertProjectPermission } from "../project-access";

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

  // ── OEM 客户变体（PLM 侧登记） ──────────────────────────────────────────────
  variantsByCustomer: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .query(({ input }) => listVariantsByCustomer(input.customerId)),

  variantsByProduct: protectedProcedure
    .input(z.object({ parentProductId: z.string() }))
    .query(({ input }) => listVariantsByParentProduct(input.parentProductId)),

  /** 平台一改即列出受影响客户变体（自有 ECO Gate 数据源） */
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
      baseRevision: z.string().default(""),
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
      sourceType: z.enum(["plm_change", "project"]).default("plm_change"),
      sourceRefId: z.string().nullable().optional(),
      introducedAt: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
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
      await createProduct({ id, createdBy: ctx.user.id, ...input });
      return { id };
    }),

  createPlatform: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.string().default(""),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      await createPlatform({ id, createdBy: ctx.user.id, ...input });
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

      // 平台/产品变更（ECO）发布时，列出该产品下游客户变体（非阻断，仅提示复核）。
      const downstreamVariants = project.productId
        ? await getDownstreamVariantImpact(project.productId, { onlyActive: true })
        : [];

      return {
        hasProduct,
        productId: project.productId ?? null,
        downstreamVariants,
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
        const project = await getProjectById(input.projectId);
        const product = project?.productId ? await getProductById(project.productId) : undefined;
        const result = await releaseProject({
          projectId: input.projectId,
          actor: { id: ctx.user.id, role: ctx.user.role },
          notes: input.notes,
          override: input.override,
        });
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
