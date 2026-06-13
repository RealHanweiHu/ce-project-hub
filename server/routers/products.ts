import { z } from "zod";
import { nanoid } from "nanoid";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createProduct, getProductById, listProductsByCategory,
  createPlatform, listProductRevisions,
} from "../db";

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
});
