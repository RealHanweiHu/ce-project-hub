import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createProduct, getProductById, listProductsByCategory,
  createPlatform, listProductRevisions,
  setProjectProduct, getOpenP0P1Count, releaseProject, getProjectById,
  getReleaseGateStatus, isReleaseOverrideAuthorized,
} from "../db";
import { emitAutomationEvent } from "../automation/events";

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
    .mutation(async ({ input }) => {
      await setProjectProduct(input.projectId, input.productId);
      return { ok: true };
    }),

  releasePrecheck: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) {
        return {
          hasProduct: false, productId: null, openP0P1: 0,
          releaseGate: null,
          deliverables: { done: 0, total: 0, missing: [] as string[] },
          blockers: ["项目不存在"], canRelease: false, canForceRelease: false,
        };
      }
      const openP0P1 = await getOpenP0P1Count(input.projectId);
      const gate = await getReleaseGateStatus(project);
      const hasProduct = !!project.productId;

      const hardPass =
        hasProduct && openP0P1 === 0 &&
        gate.phaseId !== null && gate.deliverables.missing.length === 0 &&
        gate.decision !== null && gate.decision !== "rejected";

      const canRelease = hardPass && gate.decision === "approved";
      const canForceRelease = hardPass && gate.decision === "conditional" &&
        await isReleaseOverrideAuthorized(project, { id: ctx.user.id, role: ctx.user.role });

      const blockers: string[] = [];
      if (!hasProduct) blockers.push("未关联产品");
      if (openP0P1 > 0) blockers.push(`${openP0P1} 个未关闭的 P0/P1 问题`);
      if (gate.phaseId === null) blockers.push("未定义 MP Release 前置 Gate");
      if (gate.deliverables.missing.length > 0) blockers.push(`前置 Gate 交付物未齐（${gate.deliverables.done}/${gate.deliverables.total}）`);
      if (gate.decision === null) blockers.push("前置 Gate 无评审记录");
      else if (gate.decision === "rejected") blockers.push("前置 Gate 已驳回");
      else if (gate.decision === "conditional") blockers.push("前置 Gate 为有条件通过，需强制发布");

      return {
        hasProduct,
        productId: project.productId ?? null,
        openP0P1,
        releaseGate: gate.phaseId === null ? null : {
          phaseId: gate.phaseId, gateName: gate.gateName,
          decision: gate.decision, conditions: gate.conditions, roundNumber: gate.roundNumber,
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
