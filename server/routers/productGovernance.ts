import { nanoid } from "nanoid";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  approveProductEolPlan,
  cancelProductEolPlan,
  cancelProductSoftwareRelease,
  completeProductEolPlan,
  createProductGovernanceEvent,
  getProductById,
  getProductEolPlan,
  getProductEolReadiness,
  getUserById,
  listProductGovernanceEvents,
  listProductSoftwareReleases,
  rollbackProductSoftwareRelease,
  rolloutProductSoftwareRelease,
  saveProductEolPlanDraft,
  saveProductSoftwareReleaseDraft,
  submitProductEolPlan,
  submitProductSoftwareRelease,
  updateProductEolPlanItems,
  validateProductSoftwareRelease,
} from "../db";
import { PRODUCT_EOL_ITEM_KEYS } from "../../drizzle/schema";
import { isSystemAdminRole, isSystemExternalRole } from "../../shared/system-roles";
import { isISODate } from "../../shared/scheduling";

const isoDate = z.string().refine(isISODate, "日期必须是 YYYY-MM-DD");

async function productAccess(productId: string, user: { id: number; role: string }) {
  if (isSystemExternalRole(user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "外部协作账号不能访问产品治理" });
  const product = await getProductById(productId);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
  const canMaintain = isSystemAdminRole(user.role) ||
    product.createdBy === user.id ||
    product.productManagerUserId === user.id ||
    product.maintenanceOwnerUserId === user.id;
  return { product, canMaintain };
}

async function assertInternalUser(userId: number, label: string) {
  const user = await getUserById(userId);
  if (!user || isSystemExternalRole(user.role)) throw new TRPCError({ code: "BAD_REQUEST", message: `${label}必须是内部有效用户` });
}

const softwareDraftSchema = z.object({
  id: z.number().int().positive().nullable().optional(),
  productId: z.string(),
  version: z.string().trim().min(1).max(64),
  scopeSummary: z.string().trim().min(1).max(5000),
  releaseNotes: z.string().trim().min(1).max(5000),
  compatibilityNotes: z.string().trim().min(1).max(5000),
  regressionEvidenceReference: z.string().trim().min(1).max(5000),
  rolloutPlan: z.string().trim().min(1).max(5000),
  rollbackPlan: z.string().trim().min(1).max(5000),
  qaOwnerUserId: z.number().int().positive(),
  safetyRelated: z.boolean().default(false),
  bomOrManufacturingImpact: z.boolean().default(false),
});

export const productGovernanceRouter = router({
  softwareReleases: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ ctx, input }) => {
      await productAccess(input.productId, ctx.user);
      return listProductSoftwareReleases(input.productId);
    }),

  saveSoftwareDraft: protectedProcedure
    .input(softwareDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN", message: "只有产品经理或维护责任人可以编制软件发版单" });
      if (product.lifecycleState === "eol") throw new TRPCError({ code: "BAD_REQUEST", message: "产品已停产，不能新建软件发版单" });
      if (!product.currentRevisionId) throw new TRPCError({ code: "BAD_REQUEST", message: "产品没有已发布基线 Revision" });
      if (input.safetyRelated || input.bomOrManufacturingImpact) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "涉及安全保护、BOM、生产烧录或产线/EOL 影响时必须转 ECO，不能走轻量软件发版",
        });
      }
      await assertInternalUser(input.qaOwnerUserId, "验证责任人");
      if (!isSystemAdminRole(ctx.user.role) && input.qaOwnerUserId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "软件发版编制人与验证责任人不能是同一人" });
      }
      try {
        const row = await saveProductSoftwareReleaseDraft({
          ...input,
          releaseNumber: `SWR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${nanoid(6).toUpperCase()}`,
          baseRevisionId: product.currentRevisionId,
          savedBy: ctx.user.id,
        });
        await createProductGovernanceEvent({ productId: product.id, entityType: "software_release", entityId: String(row.id), action: input.id ? "draft_updated" : "draft_created", actorUserId: ctx.user.id, snapshot: { version: row.version, baseRevisionId: row.baseRevisionId, qaOwnerUserId: row.qaOwnerUserId } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "软件发版单保存失败" });
      }
    }),

  submitSoftware: protectedProcedure
    .input(z.object({ productId: z.string(), id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const row = await submitProductSoftwareRelease(input.id, input.productId, ctx.user.id);
        await createProductGovernanceEvent({ productId: product.id, entityType: "software_release", entityId: String(row.id), action: "submitted_for_validation", actorUserId: ctx.user.id, snapshot: { version: row.version, qaOwnerUserId: row.qaOwnerUserId } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "提交失败" });
      }
    }),

  validateSoftware: protectedProcedure
    .input(z.object({ productId: z.string(), id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { product } = await productAccess(input.productId, ctx.user);
      const existing = (await listProductSoftwareReleases(input.productId)).find((item) => item.id === input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.createdBy === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "发版编制人不能自验通过" });
      }
      try {
        const row = await validateProductSoftwareRelease(input.id, input.productId, ctx.user.id, isSystemAdminRole(ctx.user.role));
        await createProductGovernanceEvent({ productId: product.id, entityType: "software_release", entityId: String(row.id), action: "validated", actorUserId: ctx.user.id, snapshot: { regressionEvidenceReference: row.regressionEvidenceReference } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "验证失败" });
      }
    }),

  rolloutSoftware: protectedProcedure
    .input(z.object({ productId: z.string(), id: z.number().int().positive(), rolloutPercent: z.number().int().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN", message: "只有产品维护责任人可以推进灰度" });
      try {
        const row = await rolloutProductSoftwareRelease({ ...input, releasedBy: ctx.user.id });
        await createProductGovernanceEvent({ productId: product.id, entityType: "software_release", entityId: String(row.id), action: row.status === "released" ? "released" : "rollout_advanced", actorUserId: ctx.user.id, snapshot: { rolloutPercent: row.rolloutPercent } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "灰度推进失败" });
      }
    }),

  rollbackSoftware: protectedProcedure
    .input(z.object({ productId: z.string(), id: z.number().int().positive(), reason: z.string().trim().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const row = await rollbackProductSoftwareRelease({ ...input, rolledBackBy: ctx.user.id });
        await createProductGovernanceEvent({ productId: product.id, entityType: "software_release", entityId: String(row.id), action: "rolled_back", actorUserId: ctx.user.id, snapshot: { reason: row.rollbackReason, rolloutPercent: row.rolloutPercent } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "回滚失败" });
      }
    }),

  cancelSoftware: protectedProcedure
    .input(z.object({ productId: z.string(), id: z.number().int().positive(), reason: z.string().trim().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const row = await cancelProductSoftwareRelease(input);
        await createProductGovernanceEvent({ productId: product.id, entityType: "software_release", entityId: String(row.id), action: "cancelled", actorUserId: ctx.user.id, snapshot: { reason: input.reason } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "取消失败" });
      }
    }),

  eolPlan: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ ctx, input }) => {
      await productAccess(input.productId, ctx.user);
      return getProductEolPlan(input.productId);
    }),

  eolReadiness: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ ctx, input }) => {
      await productAccess(input.productId, ctx.user);
      return getProductEolReadiness(input.productId);
    }),

  saveEolDraft: protectedProcedure
    .input(z.object({
      productId: z.string(),
      reason: z.string().trim().min(1).max(5000),
      lastOrderDate: isoDate,
      lastShipDate: isoDate,
      serviceEndDate: isoDate,
      sparePartsYears: z.number().int().min(0).max(20),
      inventoryDisposition: z.string().trim().min(1).max(5000),
      customerCommunicationPlan: z.string().trim().min(1).max(5000),
      supplierExitPlan: z.string().trim().min(1).max(5000),
      replacementProductId: z.string().nullable().optional(),
      ownerUserId: z.number().int().positive(),
      approverUserId: z.number().int().positive(),
      items: z.array(z.object({ itemKey: z.enum(PRODUCT_EOL_ITEM_KEYS), completed: z.boolean(), evidenceReference: z.string().trim().max(5000).nullable() })).length(PRODUCT_EOL_ITEM_KEYS.length),
    }))
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN", message: "只有产品经理或维护责任人可以编制 EOL 方案" });
      if (product.lifecycleState === "eol") throw new TRPCError({ code: "BAD_REQUEST", message: "产品已完成停产" });
      if (input.ownerUserId === input.approverUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "EOL 责任人与审批人不能是同一人" });
      await Promise.all([assertInternalUser(input.ownerUserId, "EOL 责任人"), assertInternalUser(input.approverUserId, "EOL 审批人")]);
      if (input.replacementProductId) {
        if (input.replacementProductId === product.id) throw new TRPCError({ code: "BAD_REQUEST", message: "替代产品不能是当前产品本身" });
        if (!await getProductById(input.replacementProductId)) throw new TRPCError({ code: "BAD_REQUEST", message: "替代产品不存在" });
      }
      try {
        const row = await saveProductEolPlanDraft({ ...input, replacementProductId: input.replacementProductId ?? null, savedBy: ctx.user.id });
        await createProductGovernanceEvent({ productId: product.id, entityType: "eol_plan", entityId: String(row.plan.id), action: "draft_saved", actorUserId: ctx.user.id, snapshot: { lastOrderDate: row.plan.lastOrderDate, lastShipDate: row.plan.lastShipDate, serviceEndDate: row.plan.serviceEndDate, sparePartsYears: row.plan.sparePartsYears } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "EOL 方案保存失败" });
      }
    }),

  submitEol: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const plan = await submitProductEolPlan(input.productId, ctx.user.id);
        await createProductGovernanceEvent({ productId: product.id, entityType: "eol_plan", entityId: String(plan.id), action: "submitted", actorUserId: ctx.user.id, snapshot: { approverUserId: plan.approverUserId } });
        return plan;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "EOL 提交失败" });
      }
    }),

  saveEolItems: protectedProcedure
    .input(z.object({
      productId: z.string(),
      items: z.array(z.object({ itemKey: z.enum(PRODUCT_EOL_ITEM_KEYS), completed: z.boolean(), evidenceReference: z.string().trim().max(5000).nullable() })).length(PRODUCT_EOL_ITEM_KEYS.length),
    }))
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      const bundle = await getProductEolPlan(input.productId);
      if (!canMaintain && bundle?.plan.ownerUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const row = await updateProductEolPlanItems({ ...input, updatedBy: ctx.user.id });
        await createProductGovernanceEvent({ productId: product.id, entityType: "eol_plan", entityId: String(row.plan.id), action: "checklist_updated", actorUserId: ctx.user.id, snapshot: { completed: row.items.filter((item) => item.completed).map((item) => item.itemKey) } });
        return row;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "EOL 清单更新失败" });
      }
    }),

  approveEol: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { product } = await productAccess(input.productId, ctx.user);
      const bundle = await getProductEolPlan(input.productId);
      if (!bundle) throw new TRPCError({ code: "NOT_FOUND" });
      if (bundle.plan.createdBy === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "EOL 方案编制人不能自批" });
      }
      try {
        const plan = await approveProductEolPlan(input.productId, ctx.user.id, isSystemAdminRole(ctx.user.role));
        await createProductGovernanceEvent({ productId: product.id, entityType: "eol_plan", entityId: String(plan.id), action: "approved", actorUserId: ctx.user.id, snapshot: { approvedAt: plan.approvedAt?.toISOString() ?? null } });
        return plan;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "EOL 审批失败" });
      }
    }),

  completeEol: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      const plan = await getProductEolPlan(input.productId);
      if (!canMaintain && plan?.plan.ownerUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const completed = await completeProductEolPlan(input.productId, ctx.user.id);
        await createProductGovernanceEvent({ productId: product.id, entityType: "eol_plan", entityId: String(completed.id), action: "completed", actorUserId: ctx.user.id, snapshot: { lifecycleState: "eol" } });
        return completed;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "EOL 完成失败" });
      }
    }),

  cancelEol: protectedProcedure
    .input(z.object({ productId: z.string(), reason: z.string().trim().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const { product, canMaintain } = await productAccess(input.productId, ctx.user);
      if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const plan = await cancelProductEolPlan(input.productId, ctx.user.id, input.reason);
        await createProductGovernanceEvent({ productId: product.id, entityType: "eol_plan", entityId: String(plan.id), action: "cancelled", actorUserId: ctx.user.id, snapshot: { reason: input.reason } });
        return plan;
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "EOL 取消失败" });
      }
    }),

  events: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ ctx, input }) => {
      await productAccess(input.productId, ctx.user);
      return listProductGovernanceEvents(input.productId);
    }),
});
