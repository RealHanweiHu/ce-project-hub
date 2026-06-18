import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  addBomLine, updateBomLine, deleteBomLine,
  listWorkingBom, listFrozenBom, whereUsed, bomDiff, getBomLineById,
} from "../db";
import { assertProjectAccess, assertProjectAnyPermission } from "../project-access";

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

async function assertCanEditWorkingBom(projectId: string, user: { id: number; role: string }) {
  await assertProjectAnyPermission(
    projectId,
    user,
    ["canEditProjectInfo", "canEditChangelog"],
    "没有编辑 BOM 的权限",
  );
}

export const bomRouter = router({
  working: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(input.projectId, ctx.user);
      return listWorkingBom(input.projectId);
    }),

  frozen: protectedProcedure
    .input(z.object({ revisionId: z.number().int() }))
    .query(({ input }) => listFrozenBom(input.revisionId)),

  add: protectedProcedure
    .input(z.object({ projectId: z.string(), line: lineInput }))
    .mutation(async ({ ctx, input }) => {
      await assertCanEditWorkingBom(input.projectId, ctx.user);
      const id = await addBomLine(input.projectId, input.line);
      return { id };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int(), patch: lineInput.partial() }))
    .mutation(async ({ ctx, input }) => {
      const line = await getBomLineById(input.id);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "BOM 行不存在" });
      if (!line.projectId) throw new TRPCError({ code: "FORBIDDEN", message: "冻结 BOM 不可直接修改" });
      await assertCanEditWorkingBom(line.projectId, ctx.user);
      await updateBomLine(input.id, input.patch);
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const line = await getBomLineById(input.id);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "BOM 行不存在" });
      if (!line.projectId) throw new TRPCError({ code: "FORBIDDEN", message: "冻结 BOM 不可直接删除" });
      await assertCanEditWorkingBom(line.projectId, ctx.user);
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
