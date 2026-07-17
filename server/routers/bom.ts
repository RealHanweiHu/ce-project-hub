import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  addBomLine, updateBomLine, deleteBomLine,
  listWorkingBom, listFrozenBom, whereUsed, bomDiff, getBomLineById,
  userCanSeeProductCommercials, getProductIdByRevisionId, createActivityLog, getDb,
  acquireProjectReleaseStateLock,
} from "../db";
import { bomItems, mpReleases, type BomItem } from "../../drizzle/schema";
import { assertNotExternalOnlyAccount, assertProjectAccess } from "../project-access";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import { isSystemAdminRole } from "../../shared/system-roles";
import {
  BOM_DIGEST_VERSION,
  resolveImportedBomCommercials,
  stableBomDigestPayload,
} from "../../shared/bom-import";

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

const unitCostInput = z.string().trim().max(64).refine(
  (value) => value === "" || /^\d+(?:\.\d+)?$/.test(value),
  "单价必须是大于或等于 0 的数字",
);

const lineInput = z.object({
  name: z.string().min(1),
  partNumber: z.string().default(""),
  spec: z.string().default(""),
  quantity: z.number().int().positive().default(1),
  refDesignator: z.string().default(""),
  componentProductId: z.string().nullable().optional(),
  componentRevisionId: z.number().int().nullable().optional(),
  supplierName: z.string().default(""),
  unitCost: unitCostInput.default(""),
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
  quantity: z.number().int().positive(),
  refDesignator: z.string(),
  componentProductId: z.string().nullable(),
  componentRevisionId: z.number().int().nullable(),
  supplierName: z.string(),
  unitCost: unitCostInput,
}).partial();

/**
 * 批量导入接收客户端已经解析、映射并展示过的行。文件解析留在客户端，服务端
 * 仍对最终受信边界做整单校验；任意一行不合法时 mutation 在进入事务前失败。
 */
const bulkLineInput = z.object({
  /** Excel/openBOM 的行号；写入 sortOrder，并用于发现重复映射。 */
  lineNumber: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "物料名称不能为空"),
  partNumber: z.string().trim().default(""),
  spec: z.string().trim().default(""),
  quantity: z.number().int().positive("数量必须大于 0").default(1),
  refDesignator: z.string().trim().default(""),
  componentProductId: z.string().trim().min(1).nullable().optional(),
  componentRevisionId: z.number().int().positive().nullable().optional(),
  supplierName: z.string().trim().default(""),
  unitCost: unitCostInput.default(""),
}).superRefine((line, ctx) => {
  if (!line.partNumber && !line.refDesignator) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["partNumber"],
      message: "物料编号和位号至少填写一个",
    });
  }
});

const bulkUpsertInput = z.object({
  projectId: z.string().min(1),
  mode: z.enum(["merge", "replace"]),
  /** 预览与确认复用同一个契约，避免客户端预览与真实写入校验漂移。 */
  dryRun: z.boolean().default(false),
  /** dry-run 返回的工作态 BOM 快照令牌；正式写入必须原样带回。 */
  expectedBomDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  expectedBomDigestVersion: z.literal(BOM_DIGEST_VERSION).optional(),
  lines: z.array(bulkLineInput).min(1, "至少需要一行 BOM").max(2_000, "单次最多导入 2000 行"),
}).superRefine((input, ctx) => {
  if (!input.dryRun && (
    !input.expectedBomDigest
    || input.expectedBomDigestVersion !== BOM_DIGEST_VERSION
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expectedBomDigest"],
      message: "请先预览当前 BOM，再确认导入",
    });
  }
  const materialRows = new Map<string, number>();
  const lineNumberRows = new Map<number, number>();
  input.lines.forEach((line, index) => {
    const materialKey = bomLineIdentity(line);
    const previousMaterial = materialRows.get(materialKey);
    if (previousMaterial !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines", index, "partNumber"],
        message: `物料标识与第 ${previousMaterial + 1} 行重复`,
      });
    } else {
      materialRows.set(materialKey, index);
    }

    if (line.lineNumber !== undefined) {
      const previousLine = lineNumberRows.get(line.lineNumber);
      if (previousLine !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index, "lineNumber"],
          message: `行号与第 ${previousLine + 1} 行重复`,
        });
      } else {
        lineNumberRows.set(line.lineNumber, index);
      }
    }
  });
});

type BulkBomLine = z.infer<typeof bulkLineInput>;

function normalizePartNumber(value: string): string {
  return value.trim().toLocaleUpperCase();
}

function normalizeRefDesignator(value: string): string {
  return value.trim().toLocaleUpperCase();
}

function bomLineIdentity(line: Pick<BomItem, "partNumber" | "refDesignator">): string {
  const partNumber = normalizePartNumber(line.partNumber);
  return partNumber
    ? `part:${partNumber}`
    : `ref:${normalizeRefDesignator(line.refDesignator)}`;
}

function createWorkingBomDigest(rows: BomItem[]): string {
  const payload = rows
    .slice()
    .sort((left, right) => left.id - right.id)
    .map((line) => ({
      id: line.id,
      revisionId: line.revisionId,
      projectId: line.projectId,
      partNumber: line.partNumber,
      name: line.name,
      spec: line.spec,
      quantity: line.quantity,
      refDesignator: line.refDesignator,
      componentProductId: line.componentProductId,
      componentRevisionId: line.componentRevisionId,
      keyModuleId: line.keyModuleId,
      keyModuleSnapshot: line.keyModuleSnapshot,
      supplierName: line.supplierName,
      unitCost: line.unitCost,
      sortOrder: line.sortOrder,
      createdAt: line.createdAt.toISOString(),
    }));
  return createHash("sha256")
    .update(stableBomDigestPayload(payload))
    .digest("hex");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lockProjectBom(tx: any, projectId: string) {
  await acquireProjectReleaseStateLock(tx, projectId);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`bom:${projectId}`}))`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertProjectBomStillEditable(tx: any, projectId: string) {
  const [release] = await tx.select({ id: mpReleases.id }).from(mpReleases)
    .where(eq(mpReleases.projectId, projectId))
    .limit(1);
  if (release) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "产品技术基线已发布，项目 BOM 已冻结；后续设计变更请创建 ECO",
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertNoBomIdentityConflict(tx: any, input: {
  projectId: string;
  partNumber: string;
  refDesignator: string;
  ignoreId?: number;
}) {
  const identity = bomLineIdentity(input);
  if (identity === "ref:") return;
  const rows: BomItem[] = await tx.select().from(bomItems)
    .where(eq(bomItems.projectId, input.projectId));
  const conflict = rows.find((line) =>
    line.id !== input.ignoreId && bomLineIdentity(line) === identity
  );
  if (conflict) {
    throw new TRPCError({
      code: "CONFLICT",
      message: conflict.keyModuleId
        ? `物料 ${input.partNumber || input.refDesignator} 已由受控关键模块占用，普通 BOM 行不可覆盖`
        : `物料 ${input.partNumber || input.refDesignator} 已存在，请直接更新原行`,
    });
  }
}

function normalizedBulkLine(line: BulkBomLine, index: number) {
  return {
    name: line.name.trim(),
    partNumber: line.partNumber.trim(),
    spec: line.spec.trim(),
    quantity: line.quantity,
    refDesignator: line.refDesignator.trim(),
    // undefined means the spreadsheet did not carry this PLM-only reference;
    // Drizzle will leave it untouched during merge and use the DB default on insert.
    componentProductId: line.componentProductId,
    componentRevisionId: line.componentRevisionId,
    supplierName: line.supplierName.trim(),
    unitCost: line.unitCost.trim(),
    sortOrder: line.lineNumber ?? ((index + 1) * 10),
  };
}

function resolveBulkMergeRow(
  line: ReturnType<typeof normalizedBulkLine>,
  current: BomItem,
  structureOnly: boolean,
) {
  const commercials = resolveImportedBomCommercials(
    line,
    current,
    !structureOnly,
  );
  return {
    id: current.id,
    name: line.name,
    partNumber: line.partNumber,
    spec: line.spec,
    quantity: line.quantity,
    refDesignator: line.refDesignator,
    componentProductId: line.componentProductId === undefined
      ? current.componentProductId
      : line.componentProductId,
    componentRevisionId: line.componentRevisionId === undefined
      ? current.componentRevisionId
      : line.componentRevisionId,
    // Blank optional commercial columns mean "not supplied". Explicit clearing
    // remains available in row edit where the user's intent is unambiguous.
    supplierName: commercials.supplierName,
    unitCost: commercials.unitCost,
    sortOrder: line.sortOrder,
  };
}

const CONTROLLED_MODULE_STRUCTURAL_FIELDS = new Set([
  "name",
  "partNumber",
  "spec",
  "quantity",
  "refDesignator",
  "componentProductId",
  "componentRevisionId",
]);

function assertControlledModuleStructureUntouched(
  line: Pick<BomItem, "keyModuleId">,
  patch: z.infer<typeof linePatchInput>,
) {
  if (!line.keyModuleId) return;
  const touchesStructure = Object.keys(patch)
    .some((field) => CONTROLLED_MODULE_STRUCTURAL_FIELDS.has(field));
  if (touchesStructure) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "受控关键模块的结构不可在普通 BOM 中修改；请新建并审批新的模块编号",
    });
  }
}

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
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const id = await db.transaction(async (tx) => {
        await lockProjectBom(tx, input.projectId);
        await assertProjectBomStillEditable(tx, input.projectId);
        await assertNoBomIdentityConflict(tx, {
          projectId: input.projectId,
          partNumber: input.line.partNumber,
          refDesignator: input.line.refDesignator,
        });
        const insertedId = await addBomLine(input.projectId, input.line, tx);
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "bom.add",
          entityType: "bom_item",
          entityId: String(insertedId),
          meta: { after: { id: insertedId, projectId: input.projectId, ...input.line } },
        }, tx);
        return insertedId;
      });
      return { id };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int(), patch: linePatchInput }))
    .mutation(async ({ ctx, input }) => {
      const initialLine = await getBomLineById(input.id);
      if (!initialLine) throw new TRPCError({ code: "NOT_FOUND", message: "BOM 行不存在" });
      if (!initialLine.projectId) throw new TRPCError({ code: "FORBIDDEN", message: "冻结 BOM 不可直接修改" });
      const projectId = initialLine.projectId;
      const { structureOnly } = await assertCanEditWorkingBom(projectId, ctx.user);
      if (structureOnly) assertStructureOnlyCommercials(input.patch, false);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      await db.transaction(async (tx) => {
        await lockProjectBom(tx, projectId);
        await assertProjectBomStillEditable(tx, projectId);
        const line = await getBomLineById(input.id, tx);
        if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "BOM 行不存在" });
        if (line.projectId !== projectId) {
          throw new TRPCError({ code: "CONFLICT", message: "BOM 行状态已变化，请刷新后重试" });
        }
        assertControlledModuleStructureUntouched(line, input.patch);
        const after = { ...line, ...input.patch };
        if (!line.keyModuleId) {
          await assertNoBomIdentityConflict(tx, {
            projectId,
            partNumber: after.partNumber,
            refDesignator: after.refDesignator,
            ignoreId: line.id,
          });
        }
        await updateBomLine(input.id, input.patch, tx);
        await createActivityLog({
          projectId,
          userId: ctx.user.id,
          action: "bom.update",
          entityType: "bom_item",
          entityId: String(input.id),
          meta: { patch: input.patch, before: line, after },
        }, tx);
      });
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const initialLine = await getBomLineById(input.id);
      if (!initialLine) throw new TRPCError({ code: "NOT_FOUND", message: "BOM 行不存在" });
      if (!initialLine.projectId) throw new TRPCError({ code: "FORBIDDEN", message: "冻结 BOM 不可直接删除" });
      const projectId = initialLine.projectId;
      await assertCanEditWorkingBom(projectId, ctx.user);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      await db.transaction(async (tx) => {
        await lockProjectBom(tx, projectId);
        await assertProjectBomStillEditable(tx, projectId);
        const line = await getBomLineById(input.id, tx);
        if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "BOM 行不存在" });
        if (line.projectId !== projectId) {
          throw new TRPCError({ code: "CONFLICT", message: "BOM 行状态已变化，请刷新后重试" });
        }
        if (line.keyModuleId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "受控关键模块不可从普通 BOM 中删除；请通过项目模块基线调整",
          });
        }
        await deleteBomLine(input.id, tx);
        await createActivityLog({
          projectId,
          userId: ctx.user.id,
          action: "bom.delete",
          entityType: "bom_item",
          entityId: String(input.id),
          meta: { before: line },
        }, tx);
      });
      return { ok: true };
    }),

  /**
   * 批量预览/写入 working BOM。
   *
   * - merge：优先按物料编号，料号为空时按位号（均忽略大小写和首尾空格）更新或新增；
   * - replace：删除全部普通行后写入本批数据；
   * - 两种模式都保留 keyModuleId 非空的受控模块行，且禁止导入同料号覆盖它；
   * - dryRun 与真实写入走同一份 DB 冲突检查，只跳过 mutation。
   */
  bulkUpsert: protectedProcedure
    .input(bulkUpsertInput)
    .mutation(async ({ ctx, input }) => {
      const { structureOnly } = await assertCanEditWorkingBom(input.projectId, ctx.user);
      const normalizedLines = input.lines.map(normalizedBulkLine);
      if (structureOnly) {
        normalizedLines.forEach((line) => assertStructureOnlyCommercials(line, true));
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

      const result = await db.transaction(async (tx) => {
        // 同一项目的批量导入保持串行，避免两个 replace/merge 相互覆盖。
        // projectId 通过参数绑定；advisory lock 只覆盖当前事务生命周期。
        await lockProjectBom(tx, input.projectId);
        await assertProjectBomStillEditable(tx, input.projectId);
        const existing = await tx.select().from(bomItems)
          .where(eq(bomItems.projectId, input.projectId));
        const bomDigest = createWorkingBomDigest(existing);
        if (!input.dryRun && (
          input.expectedBomDigestVersion !== BOM_DIGEST_VERSION
          || input.expectedBomDigest !== bomDigest
        )) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "BOM 在预览后已发生变化，请重新预览再导入",
          });
        }
        const controlled = existing.filter((line) => Boolean(line.keyModuleId));
        const ordinary = existing.filter((line) => !line.keyModuleId);

        const controlledIdentities = new Set(controlled.map(bomLineIdentity));
        const conflictingLine = normalizedLines.find((line) =>
          controlledIdentities.has(bomLineIdentity(line))
        );
        if (conflictingLine) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `物料 ${conflictingLine.partNumber || conflictingLine.refDesignator} 已由受控关键模块占用，普通 BOM 导入不可覆盖`,
          });
        }

        const ordinaryByIdentity = new Map<string, BomItem>();
        const duplicateOrdinaryIdentities = new Set<string>();
        for (const line of ordinary) {
          const key = bomLineIdentity(line);
          // 旧手工数据可能同时没有料号和位号，不能参与 merge，但 replace 仍可清理。
          if (key === "ref:") continue;
          if (ordinaryByIdentity.has(key)) {
            if (input.mode === "merge") {
              throw new TRPCError({
                code: "CONFLICT",
                message: `现有 BOM 中物料标识 ${line.partNumber || line.refDesignator} 重复；可使用“替换普通物料”清理`,
              });
            }
            // Replace is the recovery path for legacy duplicate identities.
            // Do not inherit PLM-only metadata from an ambiguous source row.
            duplicateOrdinaryIdentities.add(key);
            ordinaryByIdentity.delete(key);
            continue;
          }
          if (!duplicateOrdinaryIdentities.has(key)) ordinaryByIdentity.set(key, line);
        }

        const preview = input.mode === "replace"
          ? {
              dryRun: input.dryRun,
              mode: input.mode,
              inserted: normalizedLines.length,
              updated: 0,
              deleted: ordinary.length,
              preservedControlled: controlled.length,
              bomDigest,
              bomDigestVersion: BOM_DIGEST_VERSION,
            }
          : {
              dryRun: input.dryRun,
              mode: input.mode,
              inserted: normalizedLines.filter((line) =>
                !ordinaryByIdentity.has(bomLineIdentity(line))
              ).length,
              updated: normalizedLines.filter((line) =>
                ordinaryByIdentity.has(bomLineIdentity(line))
              ).length,
              deleted: 0,
              preservedControlled: controlled.length,
              bomDigest,
              bomDigestVersion: BOM_DIGEST_VERSION,
            };

        if (input.dryRun) return preview;

        if (input.mode === "replace") {
          await tx.delete(bomItems).where(and(
            eq(bomItems.projectId, input.projectId),
            isNull(bomItems.keyModuleId),
          ));
          await tx.insert(bomItems).values(normalizedLines.map((line) => ({
            ...line,
            ...resolveImportedBomCommercials(
              line,
              ordinaryByIdentity.get(bomLineIdentity(line)),
              !structureOnly,
            ),
            ...(ordinaryByIdentity.has(bomLineIdentity(line))
              ? {
                  componentProductId: line.componentProductId === undefined
                    ? ordinaryByIdentity.get(bomLineIdentity(line))!.componentProductId
                    : line.componentProductId,
                  componentRevisionId: line.componentRevisionId === undefined
                    ? ordinaryByIdentity.get(bomLineIdentity(line))!.componentRevisionId
                    : line.componentRevisionId,
                }
              : {}),
            projectId: input.projectId,
            revisionId: null,
          })));
          return preview;
        }

        const newLines: typeof normalizedLines = [];
        const updatedLines: ReturnType<typeof resolveBulkMergeRow>[] = [];
        for (const line of normalizedLines) {
          const current = ordinaryByIdentity.get(bomLineIdentity(line));
          if (!current) {
            newLines.push(line);
            continue;
          }
          updatedLines.push(resolveBulkMergeRow(line, current, structureOnly));
        }
        if (updatedLines.length > 0) {
          const values = updatedLines.map((line) => sql`(
            ${line.id}::integer,
            ${line.name}::text,
            ${line.partNumber}::text,
            ${line.spec}::text,
            ${line.quantity}::integer,
            ${line.refDesignator}::text,
            ${line.componentProductId}::varchar,
            ${line.componentRevisionId}::integer,
            ${line.supplierName}::text,
            ${line.unitCost}::text,
            ${line.sortOrder}::integer
          )`);
          await tx.execute(sql`
            UPDATE "bom_items" AS target
            SET
              "name" = source.name,
              "partNumber" = source.part_number,
              "spec" = source.spec,
              "quantity" = source.quantity,
              "refDesignator" = source.ref_designator,
              "componentProductId" = source.component_product_id,
              "componentRevisionId" = source.component_revision_id,
              "supplierName" = source.supplier_name,
              "unitCost" = source.unit_cost,
              "sortOrder" = source.sort_order
            FROM (VALUES ${sql.join(values, sql`, `)}) AS source(
              id, name, part_number, spec, quantity, ref_designator,
              component_product_id, component_revision_id, supplier_name,
              unit_cost, sort_order
            )
            WHERE target.id = source.id
          `);
        }
        if (newLines.length > 0) {
          await tx.insert(bomItems).values(newLines.map((line) => ({
            ...line,
            projectId: input.projectId,
            revisionId: null,
          })));
        }
        return preview;
      });

      if (!input.dryRun) {
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "bom.bulk_upsert",
          entityType: "bom_item",
          entityId: input.projectId,
          meta: {
            mode: input.mode,
            rows: input.lines.length,
            inserted: result.inserted,
            updated: result.updated,
            deleted: result.deleted,
            preservedControlled: result.preservedControlled,
          },
        });
      }
      return result;
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
