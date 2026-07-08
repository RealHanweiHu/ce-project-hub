import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  addBomLine, updateBomLine, deleteBomLine,
  listWorkingBom, listFrozenBom, whereUsed, bomDiff, getBomLineById,
  userCanSeeProductCommercials, getProductIdByRevisionId, createActivityLog,
} from "../db";
import type { BomItem } from "../../drizzle/schema";
import { assertNotExternalOnlyAccount, assertProjectAccess } from "../project-access";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import { isSystemAdminRole } from "../../shared/system-roles";

/** 冻结 BOM 结构随产品库全员可读，但成本/供应商仅对该产品线成员或管理员可见 */
function redactBomCommercials<T extends Pick<BomItem, "unitCost" | "supplierName">>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, unitCost: "", supplierName: "" }));
}

async function canSeeCommercialsForRevision(
  revisionId: number,
  user: { id: number; role: string },
): Promise<boolean> {
  const productId = await getProductIdByRevisionId(revisionId);
  return userCanSeeProductCommercials(user.id, isSystemAdminRole(user.role), productId);
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

/**
 * update 专用 patch：不能复用 lineInput.partial()——zod 会把 default("") 注入
 * 缺省键，updateBomLine 直接 set(patch)，导致改任意一格都会把成本/供应商等
 * 其余字段静默清空（存量数据丢失 bug）。无默认值的 partial 让缺省键真正缺省。
 */
const linePatchInput = z.object({
  name: z.string().min(1),
  partNumber: z.string(),
  spec: z.string(),
  quantity: z.number().int(),
  refDesignator: z.string(),
  componentProductId: z.string().nullable(),
  componentRevisionId: z.number().int().nullable(),
  supplierName: z.string(),
  unitCost: z.string(),
}).partial();

/**
 * working BOM 编辑权，两档：
 * - 全字段（SCM/PM/管理）：canEditProjectInfo | canEditChangelog
 * - 结构档（rd_hw/rd_mech）：canEditBomStructure —— EBOM 作者可维护料号/规格/
 *   数量/位号，但商业字段（unitCost/supplierName）只归 SCM，含写入与清空。
 */
async function assertCanEditWorkingBom(
  projectId: string,
  user: { id: number; role: string },
): Promise<{ structureOnly: boolean }> {
  const access = await assertProjectAccess(projectId, user);
  const full = access.isAdmin
    || access.permissions.canEditProjectInfo
    || access.permissions.canEditChangelog;
  if (full) return { structureOnly: false };
  if (access.permissions.canEditBomStructure) return { structureOnly: true };
  throw new TRPCError({ code: "FORBIDDEN", message: "没有编辑 BOM 的权限" });
}

function assertStructureOnlyCommercials(patch: { unitCost?: string; supplierName?: string }, isAdd: boolean) {
  // add：lineInput 有 default ""，字段恒存在——只拦非空值；
  // update：partial 会把缺省键留成 undefined，须按值判断——显式传入（含空串，
  // 空串会静默清掉 SCM 录入的成本）即拦，undefined 视为未触碰。
  const touchesCommercials = isAdd
    ? Boolean(patch.unitCost?.trim() || patch.supplierName?.trim())
    : (patch.unitCost !== undefined || patch.supplierName !== undefined);
  if (touchesCommercials) {
    throw new TRPCError({ code: "FORBIDDEN", message: "成本与供应商字段由 SCM/项目经理维护，结构编辑权不可修改" });
  }
}

export const bomRouter = router({
  working: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) return [];
      const rows = await listWorkingBom(input.projectId);
      return access.permissions.canViewCommercials ? rows : redactBomCommercials(rows);
    }),

  frozen: protectedProcedure
    .input(z.object({ revisionId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await assertNotExternalOnlyAccount(ctx.user);
      const rows = await listFrozenBom(input.revisionId);
      if (await canSeeCommercialsForRevision(input.revisionId, ctx.user)) return rows;
      return redactBomCommercials(rows);
    }),

  add: protectedProcedure
    .input(z.object({ projectId: z.string(), line: lineInput }))
    .mutation(async ({ ctx, input }) => {
      const { structureOnly } = await assertCanEditWorkingBom(input.projectId, ctx.user);
      if (structureOnly) assertStructureOnlyCommercials(input.line, true);
      const id = await addBomLine(input.projectId, input.line);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "bom.add",
        entityType: "bom_item",
        entityId: String(id),
        meta: { after: { id, projectId: input.projectId, ...input.line } },
      });
      return { id };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int(), patch: linePatchInput }))
    .mutation(async ({ ctx, input }) => {
      const line = await getBomLineById(input.id);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "BOM 行不存在" });
      if (!line.projectId) throw new TRPCError({ code: "FORBIDDEN", message: "冻结 BOM 不可直接修改" });
      const { structureOnly } = await assertCanEditWorkingBom(line.projectId, ctx.user);
      if (structureOnly) assertStructureOnlyCommercials(input.patch, false);
      await updateBomLine(input.id, input.patch);
      await createActivityLog({
        projectId: line.projectId,
        userId: ctx.user.id,
        action: "bom.update",
        entityType: "bom_item",
        entityId: String(input.id),
        meta: { patch: input.patch, before: line, after: { ...line, ...input.patch } },
      });
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
      await createActivityLog({
        projectId: line.projectId,
        userId: ctx.user.id,
        action: "bom.delete",
        entityType: "bom_item",
        entityId: String(input.id),
        meta: { before: line },
      });
      return { ok: true };
    }),

  whereUsed: protectedProcedure
    .input(z.object({ componentProductId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertNotExternalOnlyAccount(ctx.user);
      return whereUsed(input.componentProductId);
    }),

  diff: protectedProcedure
    .input(z.object({ revA: z.number().int(), revB: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await assertNotExternalOnlyAccount(ctx.user);
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
