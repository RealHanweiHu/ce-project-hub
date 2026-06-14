import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createProduct, getProductById, listProductsByCategory,
  createPlatform, listProductRevisions,
  setProjectProduct, getOpenP0P1Count, releaseProject, getProjectById,
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
    .query(async ({ input }) => {
      const project = await getProjectById(input.projectId);
      const openP0P1 = await getOpenP0P1Count(input.projectId);
      return {
        hasProduct: !!project?.productId,
        productId: project?.productId ?? null,
        openP0P1,
        canRelease: !!project?.productId && openP0P1 === 0,
      };
    }),

  release: protectedProcedure
    .input(z.object({ projectId: z.string(), notes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const project = await getProjectById(input.projectId);
        const product = project?.productId ? await getProductById(project.productId) : undefined;
        const result = await releaseProject({ projectId: input.projectId, releasedBy: ctx.user.id, notes: input.notes });
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
