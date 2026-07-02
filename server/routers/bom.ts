import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  addBomLine, updateBomLine, deleteBomLine,
  listWorkingBom, listFrozenBom, whereUsed, bomDiff, getBomLineById,
  userCanSeeProductCommercials, getProductIdByRevisionId,
} from "../db";
import type { BomItem } from "../../drizzle/schema";
import { assertProjectAccess, assertProjectAnyPermission } from "../project-access";

/** 冻结 BOM 结构随产品库全员可读，但成本/供应商仅对该产品线成员或管理员可见 */
function redactBomCommercials<T extends Pick<BomItem, "unitCost" | "supplierName">>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, unitCost: "", supplierName: "" }));
}

async function canSeeCommercialsForRevision(
  revisionId: number,
  user: { id: number; role: string },
): Promise<boolean> {
  const productId = await getProductIdByRevisionId(revisionId);
  return userCanSeeProductCommercials(user.id, user.role === "admin", productId);
}

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
    .query(async ({ ctx, input }) => {
      const rows = await listFrozenBom(input.revisionId);
      if (await canSeeCommercialsForRevision(input.revisionId, ctx.user)) return rows;
      return redactBomCommercials(rows);
    }),

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
    .query(async ({ ctx, input }) => {
      const d = await bomDiff(input.revA, input.revB);
      // 只要对任一比较版本无商业权限就脱敏（两版本通常同产品线）
      const canA = await canSeeCommercialsForRevision(input.revA, ctx.user);
      const canB = await canSeeCommercialsForRevision(input.revB, ctx.user);
      if (canA && canB) return d;
      return {
        added: redactBomCommercials(d.added),
        removed: redactBomCommercials(d.removed),
        changed: redactBomCommercials(d.changed),
      };
    }),
});
