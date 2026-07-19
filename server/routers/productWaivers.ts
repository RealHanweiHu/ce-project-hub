import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { createProductGovernanceEvent, getProductById, getUserById } from "../db";
import { isSystemAdminRole, isSystemExternalRole } from "../../shared/system-roles";
import { isISODate } from "../../shared/scheduling";
import { PRODUCT_WAIVER_SCOPE_TYPES } from "../../drizzle/schema";
import {
  decideProductWaiver,
  listProductWaivers,
  resolveProductWaiver,
  saveProductWaiverDraft,
  submitProductWaiver,
} from "../services/sop-blindspot-service";

const isoDate = z.string().refine(isISODate, "日期必须是 YYYY-MM-DD");

async function access(productId: string, user: { id: number; role: string }) {
  if (isSystemExternalRole(user.role)) throw new TRPCError({ code: "FORBIDDEN" });
  const product = await getProductById(productId);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });
  const canMaintain = isSystemAdminRole(user.role) || product.createdBy === user.id || product.productManagerUserId === user.id || product.maintenanceOwnerUserId === user.id;
  return { product, canMaintain };
}

async function assertInternalUser(userId: number, label: string) {
  const user = await getUserById(userId);
  if (!user || isSystemExternalRole(user.role)) throw new TRPCError({ code: "BAD_REQUEST", message: `${label}必须是内部有效用户` });
}

const draft = z.object({
  id: z.number().int().positive().nullable().optional(),
  productId: z.string(),
  projectId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(256),
  deviationDescription: z.string().trim().min(1).max(5000),
  impactAssessment: z.string().trim().min(1).max(5000),
  containmentPlan: z.string().trim().min(1).max(5000),
  scopeType: z.enum(PRODUCT_WAIVER_SCOPE_TYPES),
  lotOrBatch: z.string().trim().max(256).nullable().optional(),
  quantityLimit: z.number().int().positive().nullable().optional(),
  affectedPartNumbers: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
  effectiveFrom: isoDate,
  expiresOn: isoDate,
  riskLevel: z.enum(["low", "medium", "high"]),
  ownerUserId: z.number().int().positive(),
  approverUserId: z.number().int().positive(),
  evidenceReference: z.string().trim().max(5000).nullable().optional(),
});
export const productWaiversRouter = router({
  list: protectedProcedure.input(z.object({ productId: z.string() })).query(async ({ ctx, input }) => {
    await access(input.productId, ctx.user);
    return listProductWaivers(input.productId);
  }),
  saveDraft: protectedProcedure.input(draft).mutation(async ({ ctx, input }) => {
    const { product, canMaintain } = await access(input.productId, ctx.user);
    if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN", message: "只有产品经理或维护责任人可以编制量产让步" });
    await Promise.all([assertInternalUser(input.ownerUserId, "让步责任人"), assertInternalUser(input.approverUserId, "让步批准人")]);
    try {
      const row = await saveProductWaiverDraft({ ...input, actorUserId: ctx.user.id });
      await createProductGovernanceEvent({ productId: product.id, entityType: "product_waiver", entityId: String(row.id), action: input.id ? "draft_updated" : "draft_created", actorUserId: ctx.user.id, snapshot: { waiverNumber: row.waiverNumber, scopeType: row.scopeType, expiresOn: row.expiresOn } });
      return row;
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "让步保存失败" }); }
  }),
  submit: protectedProcedure.input(z.object({ productId: z.string(), id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { product, canMaintain } = await access(input.productId, ctx.user);
    if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN" });
    try {
      const row = await submitProductWaiver(input.id, input.productId, ctx.user.id);
      await createProductGovernanceEvent({ productId: product.id, entityType: "product_waiver", entityId: String(row.id), action: "submitted", actorUserId: ctx.user.id, snapshot: { approverUserId: row.approverUserId } });
      return row;
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "让步提交失败" }); }
  }),
  decide: protectedProcedure.input(z.object({ productId: z.string(), id: z.number().int().positive(), approve: z.boolean(), note: z.string().trim().max(5000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const { product } = await access(input.productId, ctx.user);
    try {
      const row = await decideProductWaiver({ ...input, actorUserId: ctx.user.id, allowAdmin: isSystemAdminRole(ctx.user.role) });
      await createProductGovernanceEvent({ productId: product.id, entityType: "product_waiver", entityId: String(row.id), action: input.approve ? "approved" : "rejected", actorUserId: ctx.user.id, snapshot: { note: input.note ?? null } });
      return row;
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "让步审批失败" }); }
  }),
  resolve: protectedProcedure.input(z.object({ productId: z.string(), id: z.number().int().positive(), resolution: z.enum(["closed", "converted_to_eco", "cancelled"]), note: z.string().trim().min(1).max(5000), linkedEcoProjectId: z.string().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const { product, canMaintain } = await access(input.productId, ctx.user);
    if (!canMaintain) throw new TRPCError({ code: "FORBIDDEN" });
    try {
      const row = await resolveProductWaiver({ ...input, actorUserId: ctx.user.id });
      await createProductGovernanceEvent({ productId: product.id, entityType: "product_waiver", entityId: String(row.id), action: row.status, actorUserId: ctx.user.id, snapshot: { linkedEcoProjectId: row.linkedEcoProjectId, note: input.note } });
      return row;
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "让步闭环失败" }); }
  }),
});
