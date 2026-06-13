import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  addBomLine, updateBomLine, deleteBomLine,
  listWorkingBom, listFrozenBom, whereUsed, bomDiff,
} from "../db";

const lineInput = z.object({
  name: z.string().min(1),
  partNumber: z.string().default(""),
  spec: z.string().default(""),
  quantity: z.number().int().default(1),
  refDesignator: z.string().default(""),
  componentProductId: z.string().nullable().optional(),
  componentRevisionId: z.number().int().nullable().optional(),
  supplierName: z.string().default(""),
  unitCost: z.string().default(""),
});

export const bomRouter = router({
  working: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => listWorkingBom(input.projectId)),

  frozen: protectedProcedure
    .input(z.object({ revisionId: z.number().int() }))
    .query(({ input }) => listFrozenBom(input.revisionId)),

  add: protectedProcedure
    .input(z.object({ projectId: z.string(), line: lineInput }))
    .mutation(async ({ input }) => {
      const id = await addBomLine(input.projectId, input.line);
      return { id };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int(), patch: lineInput.partial() }))
    .mutation(async ({ input }) => {
      await updateBomLine(input.id, input.patch);
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await deleteBomLine(input.id);
      return { ok: true };
    }),

  whereUsed: protectedProcedure
    .input(z.object({ componentProductId: z.string() }))
    .query(({ input }) => whereUsed(input.componentProductId)),

  diff: protectedProcedure
    .input(z.object({ revA: z.number().int(), revB: z.number().int() }))
    .query(({ input }) => bomDiff(input.revA, input.revB)),
});
