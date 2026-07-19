import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  bomItems,
  keyModuleAuditEvents,
  keyModuleItems,
  keyModules,
  productModuleAssignments,
  productTechnicalBaselines,
  products,
  projectModuleBaselines,
  projectProductModuleBindings,
  projects,
  users,
  type KeyModuleAuditAction,
  type KeyModule,
  type KeyModuleEvidenceRef,
  type KeyModuleItem,
} from "../../drizzle/schema";
import {
  KEY_MODULE_STATUSES,
  KEY_MODULE_TYPE_IDS,
  type KeyModuleStatus,
  type KeyModuleType,
} from "../../shared/key-modules";
import { getDb } from "../db";

export type KeyModuleItemInput = {
  partNumber: string;
  name: string;
  spec?: string | null;
  quantity: number;
  refDesignator?: string | null;
  componentProductId?: string | null;
  sortOrder?: number;
};

export type CreateKeyModuleInput = {
  id?: string;
  moduleNumber: string;
  moduleType: KeyModuleType;
  name: string;
  category?: string | null;
  model?: string | null;
  attributes?: Record<string, unknown>;
  evidenceRefs?: KeyModuleEvidenceRef[];
  items: KeyModuleItemInput[];
};

export type UpdateKeyModuleDraftInput = Partial<Pick<
  CreateKeyModuleInput,
  "moduleNumber" | "name" | "category" | "model" | "attributes" | "evidenceRefs" | "items"
>>;

export type KeyModuleBundle = { module: KeyModule; items: KeyModuleItem[] };

export class KeyModuleServiceError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "EMPTY_INTERNAL_BOM"
      | "DUPLICATE_ITEM"
      | "INVALID_STATE"
      | "IMMUTABLE_MODULE",
    message: string,
  ) {
    super(message);
    this.name = "KeyModuleServiceError";
  }
}

function normalizeRequired(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new KeyModuleServiceError("INVALID_INPUT", `${label}不能为空`);
  return normalized;
}

function normalizeModuleNumber(value: string) {
  return normalizeRequired(value, "模块编号").toUpperCase();
}

function normalizeItems(items: KeyModuleItemInput[], allowEmpty = false) {
  if (!allowEmpty && items.length === 0) {
    throw new KeyModuleServiceError("EMPTY_INTERNAL_BOM", "关键模块至少需要一个内部 BOM 部件");
  }
  const seen = new Set<string>();
  return items.map((item, index) => {
    const partNumber = normalizeRequired(item.partNumber, `第 ${index + 1} 行部件编号`);
    const name = normalizeRequired(item.name, `第 ${index + 1} 行部件名称`);
    const refDesignator = item.refDesignator?.trim() ?? "";
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new KeyModuleServiceError("INVALID_INPUT", `第 ${index + 1} 行数量必须是正整数`);
    }
    const key = `${partNumber}\u0000${refDesignator}`;
    if (seen.has(key)) {
      throw new KeyModuleServiceError("DUPLICATE_ITEM", `内部 BOM 存在重复部件位置：${partNumber}`);
    }
    seen.add(key);
    return {
      partNumber,
      name,
      spec: item.spec?.trim() ?? "",
      quantity,
      refDesignator,
      componentProductId: item.componentProductId?.trim() || null,
      sortOrder: item.sortOrder ?? index,
    };
  });
}

async function requireModule(id: string, executor?: Awaited<ReturnType<typeof getDb>>) {
  const db = executor ?? await getDb();
  if (!db) throw new Error("Database not available");
  const [module] = await db.select().from(keyModules).where(eq(keyModules.id, id)).limit(1);
  if (!module) throw new KeyModuleServiceError("NOT_FOUND", "关键模块不存在");
  return module;
}

// Drizzle's transaction executor is structurally compatible with the main DB,
// but its inferred generic is intentionally kept behind this service boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = any;

async function lockModule(id: string, executor: Executor): Promise<KeyModule> {
  const [module] = await executor.select().from(keyModules)
    .where(eq(keyModules.id, id))
    .limit(1)
    .for("update");
  if (!module) throw new KeyModuleServiceError("NOT_FOUND", "关键模块不存在");
  return module;
}

async function appendAuditEvent(executor: Executor, input: {
  moduleId: string;
  action: KeyModuleAuditAction;
  fromStatus: KeyModuleStatus | null;
  toStatus: KeyModuleStatus | null;
  actorId: number;
  reason?: string | null;
  meta?: Record<string, unknown>;
}) {
  await executor.insert(keyModuleAuditEvents).values({
    moduleId: input.moduleId,
    action: input.action,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    actorId: input.actorId,
    reason: input.reason?.trim() || null,
    meta: input.meta ?? {},
  });
}

async function readBundle(id: string, executor?: Awaited<ReturnType<typeof getDb>>): Promise<KeyModuleBundle> {
  const db = executor ?? await getDb();
  if (!db) throw new Error("Database not available");
  const module = await requireModule(id, db);
  const items = await db.select().from(keyModuleItems)
    .where(eq(keyModuleItems.moduleId, id))
    .orderBy(asc(keyModuleItems.sortOrder), asc(keyModuleItems.id));
  return { module, items };
}

export async function getKeyModuleDetail(id: string): Promise<KeyModuleBundle | null> {
  try {
    return await readBundle(id);
  } catch (error) {
    if (error instanceof KeyModuleServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function createKeyModule(input: CreateKeyModuleInput, actorId: number): Promise<KeyModuleBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const items = normalizeItems(input.items);
  const id = input.id?.trim() || `km_${nanoid(16)}`;
  const moduleNumber = normalizeModuleNumber(input.moduleNumber);
  return db.transaction(async tx => {
    await tx.insert(keyModules).values({
      id,
      moduleNumber,
      moduleType: input.moduleType,
      name: normalizeRequired(input.name, "模块名称"),
      category: input.category?.trim() ?? "",
      model: input.model?.trim() || null,
      attributes: input.attributes ?? {},
      evidenceRefs: input.evidenceRefs ?? [],
      createdBy: actorId,
    });
    await tx.insert(keyModuleItems).values(items.map(item => ({ moduleId: id, ...item })));
    await appendAuditEvent(tx, {
      moduleId: id,
      action: "create",
      fromStatus: null,
      toStatus: "draft",
      actorId,
      meta: { moduleNumber, moduleType: input.moduleType },
    });
    return readBundle(id, tx as never);
  });
}

export async function updateKeyModuleDraft(
  id: string,
  patch: UpdateKeyModuleDraftInput,
  actorId: number,
): Promise<KeyModuleBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const current = await lockModule(id, tx);
    if (current.status !== "draft") {
      throw new KeyModuleServiceError(
        "IMMUTABLE_MODULE",
        current.status === "approved" || current.status === "restricted" || current.status === "obsolete"
          ? "已批准的关键模块不可直接修改，请派生新模块编号"
          : "技术确认后的模块需先退回草稿再修改",
      );
    }
    const beforeItems = await tx.select().from(keyModuleItems)
      .where(eq(keyModuleItems.moduleId, id))
      .orderBy(asc(keyModuleItems.sortOrder), asc(keyModuleItems.id));
    const beforeSnapshotHash = hashKeyModuleSnapshot(
      buildKeyModuleSnapshotFromBundle({ module: current, items: beforeItems }),
    );
    const update: Partial<typeof keyModules.$inferInsert> = { updatedAt: new Date() };
    if (patch.moduleNumber !== undefined) update.moduleNumber = normalizeModuleNumber(patch.moduleNumber);
    if (patch.name !== undefined) update.name = normalizeRequired(patch.name, "模块名称");
    if (patch.category !== undefined) update.category = patch.category?.trim() ?? "";
    if (patch.model !== undefined) update.model = patch.model?.trim() || null;
    if (patch.attributes !== undefined) update.attributes = patch.attributes;
    if (patch.evidenceRefs !== undefined) update.evidenceRefs = patch.evidenceRefs;
    await tx.update(keyModules).set(update).where(eq(keyModules.id, id));
    if (patch.items !== undefined) {
      const items = normalizeItems(patch.items);
      await tx.delete(keyModuleItems).where(eq(keyModuleItems.moduleId, id));
      await tx.insert(keyModuleItems).values(items.map(item => ({ moduleId: id, ...item })));
    }
    const updatedBundle = await readBundle(id, tx as never);
    const afterSnapshotHash = hashKeyModuleSnapshot(buildKeyModuleSnapshotFromBundle(updatedBundle));
    await appendAuditEvent(tx, {
      moduleId: id,
      action: "update_draft",
      fromStatus: "draft",
      toStatus: "draft",
      actorId,
      meta: {
        snapshotSchemaVersion: 1,
        snapshotHashAlgorithm: "sha256",
        snapshotHashScope: "controlled_module_definition_and_internal_bom",
        beforeSnapshotHash,
        afterSnapshotHash,
        changedFields: Object.entries(patch)
          .filter(([, value]) => value !== undefined)
          .map(([field]) => field)
          .sort(),
      },
    });
    return updatedBundle;
  });
}

export async function confirmKeyModuleTechnical(id: string, actorId: number): Promise<KeyModuleBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const current = await lockModule(id, tx);
    if (current.status !== "draft") {
      throw new KeyModuleServiceError("INVALID_STATE", "只有草稿模块可以完成技术确认");
    }
    const items = await tx.select().from(keyModuleItems).where(eq(keyModuleItems.moduleId, id));
    normalizeItems(items.map(item => ({
      partNumber: item.partNumber,
      name: item.name,
      spec: item.spec,
      quantity: item.quantity,
      refDesignator: item.refDesignator,
      componentProductId: item.componentProductId,
      sortOrder: item.sortOrder,
    })));
    await tx.update(keyModules).set({
      status: "technical_confirmed",
      technicalConfirmedBy: actorId,
      technicalConfirmedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(keyModules.id, id));
    await appendAuditEvent(tx, {
      moduleId: id,
      action: "technical_confirm",
      fromStatus: "draft",
      toStatus: "technical_confirmed",
      actorId,
    });
    return readBundle(id, tx as never);
  });
}

export async function reopenKeyModuleDraft(
  id: string,
  actorId: number,
  reason: string,
): Promise<KeyModuleBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedReason = normalizeRequired(reason, "退回原因");
  return db.transaction(async tx => {
    const current = await lockModule(id, tx);
    if (current.status !== "technical_confirmed") {
      throw new KeyModuleServiceError("INVALID_STATE", "只有待批准的模块可以退回草稿");
    }
    await tx.update(keyModules).set({
      status: "draft",
      technicalConfirmedBy: null,
      technicalConfirmedAt: null,
      updatedAt: new Date(),
    }).where(eq(keyModules.id, id));
    await appendAuditEvent(tx, {
      moduleId: id,
      action: "return_to_draft",
      fromStatus: "technical_confirmed",
      toStatus: "draft",
      actorId,
      reason: normalizedReason,
    });
    return readBundle(id, tx as never);
  });
}

export async function approveKeyModule(id: string, actorId: number): Promise<KeyModuleBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const current = await lockModule(id, tx);
    if (current.status !== "technical_confirmed") {
      throw new KeyModuleServiceError("INVALID_STATE", "只有已完成技术确认的模块可以批准");
    }
    await tx.update(keyModules).set({
      status: "approved",
      approvedBy: actorId,
      approvedAt: new Date(),
      restrictionReason: null,
      updatedAt: new Date(),
    }).where(eq(keyModules.id, id));
    await appendAuditEvent(tx, {
      moduleId: id,
      action: "approve",
      fromStatus: "technical_confirmed",
      toStatus: "approved",
      actorId,
    });
    return readBundle(id, tx as never);
  });
}

export async function restrictKeyModule(id: string, reason: string, actorId: number): Promise<KeyModuleBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedReason = normalizeRequired(reason, "限制原因");
  return db.transaction(async tx => {
    const current = await lockModule(id, tx);
    if (current.status !== "approved") {
      throw new KeyModuleServiceError("INVALID_STATE", "只有已批准模块可以限制新项目选用");
    }
    await tx.update(keyModules).set({
      status: "restricted",
      restrictionReason: normalizedReason,
      updatedAt: new Date(),
    }).where(eq(keyModules.id, id));
    await appendAuditEvent(tx, {
      moduleId: id,
      action: "restrict",
      fromStatus: "approved",
      toStatus: "restricted",
      actorId,
      reason: normalizedReason,
    });
    return readBundle(id, tx as never);
  });
}

export async function obsoleteKeyModule(id: string, reason: string, actorId: number): Promise<KeyModuleBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedReason = normalizeRequired(reason, "停用原因");
  return db.transaction(async tx => {
    const current = await lockModule(id, tx);
    if (current.status !== "approved" && current.status !== "restricted") {
      throw new KeyModuleServiceError("INVALID_STATE", "只有已批准或受限模块可以停用");
    }
    await tx.update(keyModules).set({
      status: "obsolete",
      restrictionReason: normalizedReason,
      updatedAt: new Date(),
    }).where(eq(keyModules.id, id));
    await appendAuditEvent(tx, {
      moduleId: id,
      action: "obsolete",
      fromStatus: current.status,
      toStatus: "obsolete",
      actorId,
      reason: normalizedReason,
    });
    return readBundle(id, tx as never);
  });
}

export async function deriveKeyModule(
  sourceId: string,
  input: { id?: string; moduleNumber: string; name?: string; model?: string | null },
  actorId: number,
): Promise<KeyModuleBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = input.id?.trim() || `km_${nanoid(16)}`;
  const moduleNumber = normalizeModuleNumber(input.moduleNumber);
  return db.transaction(async tx => {
    const sourceModule = await lockModule(sourceId, tx);
    if (sourceModule.status === "draft" || sourceModule.status === "technical_confirmed") {
      throw new KeyModuleServiceError("INVALID_STATE", "只有已发布的模块可以派生新编号");
    }
    const sourceItems = await tx.select().from(keyModuleItems)
      .where(eq(keyModuleItems.moduleId, sourceId))
      .orderBy(asc(keyModuleItems.sortOrder), asc(keyModuleItems.id));
    const items = normalizeItems(sourceItems.map(item => ({
      partNumber: item.partNumber,
      name: item.name,
      spec: item.spec,
      quantity: item.quantity,
      refDesignator: item.refDesignator,
      componentProductId: item.componentProductId,
      sortOrder: item.sortOrder,
    })));
    await tx.insert(keyModules).values({
      id,
      moduleNumber,
      moduleType: sourceModule.moduleType,
      name: input.name?.trim() || `${sourceModule.name}（派生）`,
      category: sourceModule.category,
      model: input.model === undefined ? sourceModule.model : input.model?.trim() || null,
      attributes: sourceModule.attributes,
      evidenceRefs: sourceModule.evidenceRefs,
      derivedFromModuleId: sourceId,
      createdBy: actorId,
    });
    await tx.insert(keyModuleItems).values(items.map(item => ({ moduleId: id, ...item })));
    await appendAuditEvent(tx, {
      moduleId: id,
      action: "derive",
      fromStatus: null,
      toStatus: "draft",
      actorId,
      meta: {
        moduleNumber,
        moduleType: sourceModule.moduleType,
        sourceModuleId: sourceId,
        sourceModuleNumber: sourceModule.moduleNumber,
      },
    });
    return readBundle(id, tx as never);
  });
}

export async function getKeyModuleHistory(id: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select({
    id: keyModuleAuditEvents.id,
    moduleId: keyModuleAuditEvents.moduleId,
    action: keyModuleAuditEvents.action,
    fromStatus: keyModuleAuditEvents.fromStatus,
    toStatus: keyModuleAuditEvents.toStatus,
    actorId: keyModuleAuditEvents.actorId,
    actorName: users.name,
    actorUsername: users.username,
    reason: keyModuleAuditEvents.reason,
    meta: keyModuleAuditEvents.meta,
    createdAt: keyModuleAuditEvents.createdAt,
  }).from(keyModuleAuditEvents)
    .leftJoin(users, eq(users.id, keyModuleAuditEvents.actorId))
    .where(eq(keyModuleAuditEvents.moduleId, id))
    .orderBy(asc(keyModuleAuditEvents.createdAt), asc(keyModuleAuditEvents.id));
}

export async function listKeyModules(input: {
  query?: string;
  moduleType?: KeyModuleType;
  category?: string;
  statuses?: KeyModuleStatus[];
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const conditions = [];
  if (input.moduleType) conditions.push(eq(keyModules.moduleType, input.moduleType));
  const statuses = input.statuses?.length ? input.statuses : ["approved" as const];
  conditions.push(inArray(keyModules.status, statuses));
  const query = input.query?.trim();
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(or(
      ilike(keyModules.moduleNumber, pattern),
      ilike(keyModules.name, pattern),
      ilike(keyModules.model, pattern),
      ilike(keyModules.category, pattern),
    )!);
  }
  const where = and(...conditions);
  const sameCategory = input.category?.trim();
  const [rows, totals] = await Promise.all([
    db.select().from(keyModules)
      .where(where)
      .orderBy(
        sameCategory ? sql`CASE WHEN ${keyModules.category} = ${sameCategory} THEN 0 ELSE 1 END` : sql`0`,
        desc(keyModules.approvedAt),
        asc(keyModules.moduleNumber),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(keyModules).where(where),
  ]);
  const totalItems = Number(totals[0]?.total ?? 0);
  return {
    data: rows,
    pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
  };
}

export async function buildKeyModuleSnapshot(id: string) {
  const bundle = await readBundle(id);
  return buildKeyModuleSnapshotFromBundle(bundle);
}

export function buildKeyModuleSnapshotFromBundle(bundle: KeyModuleBundle) {
  const definition = {
    id: bundle.module.id,
    moduleNumber: bundle.module.moduleNumber,
    moduleType: bundle.module.moduleType,
    name: bundle.module.name,
    category: bundle.module.category,
    model: bundle.module.model,
    attributes: bundle.module.attributes,
    status: bundle.module.status,
    derivedFromModuleId: bundle.module.derivedFromModuleId,
    evidenceRefs: bundle.module.evidenceRefs.map(reference => ({ ...reference })),
    createdBy: bundle.module.createdBy,
    technicalConfirmedBy: bundle.module.technicalConfirmedBy,
    technicalConfirmedAt: snapshotTimestamp(bundle.module.technicalConfirmedAt),
    approvedBy: bundle.module.approvedBy,
    approvedAt: snapshotTimestamp(bundle.module.approvedAt),
    restrictionReason: bundle.module.restrictionReason,
    items: bundle.items.map(item => ({
      partNumber: item.partNumber,
      name: item.name,
      spec: item.spec,
      quantity: item.quantity,
      refDesignator: item.refDesignator,
      componentProductId: item.componentProductId,
      sortOrder: item.sortOrder,
    })),
  };
  return {
    ...definition,
    internalBomHash: hashKeyModuleSnapshot(definition.items),
  };
}

function snapshotTimestamp(value: Date | null) {
  return value ? value.toISOString() : null;
}

function canonicalizeForHash(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeForHash(nested)]),
    );
  }
  return value;
}

/** Deterministic digest used by append-only audit records and frozen module baselines. */
export function hashKeyModuleSnapshot(snapshot: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeForHash(snapshot)))
    .digest("hex");
}

export async function resolveApprovedKeyModuleForReuse(id: string, expectedType: KeyModuleType) {
  const bundle = await readBundle(id);
  if (bundle.module.status !== "approved") {
    throw new KeyModuleServiceError("INVALID_STATE", `关键模块 ${bundle.module.moduleNumber} 尚未批准，不能用于项目复用`);
  }
  if (bundle.module.moduleType !== expectedType) {
    throw new KeyModuleServiceError(
      "INVALID_INPUT",
      `关键模块 ${bundle.module.moduleNumber} 的类型与所选 DRV 模块不匹配`,
    );
  }
  return { bundle, snapshot: buildKeyModuleSnapshotFromBundle(bundle) };
}

export async function getKeyModuleWhereUsed(id: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [productUses, reuseProjectUses, deliveryProjectUses, bomUses] = await Promise.all([
    db.select({
      technicalBaselineId: productModuleAssignments.technicalBaselineId,
      productId: productTechnicalBaselines.productId,
      productName: products.name,
      baselineLabel: productTechnicalBaselines.baselineLabel,
    }).from(productModuleAssignments)
      .innerJoin(productTechnicalBaselines, eq(productTechnicalBaselines.id, productModuleAssignments.technicalBaselineId))
      .innerJoin(products, eq(products.id, productTechnicalBaselines.productId))
      .where(eq(productModuleAssignments.moduleId, id)),
    db.select({
      projectId: projectModuleBaselines.projectId,
      projectName: projects.name,
      drvModuleKey: projectModuleBaselines.drvModuleKey,
      confirmedAt: projectModuleBaselines.confirmedAt,
    }).from(projectModuleBaselines)
      .innerJoin(projects, eq(projects.id, projectModuleBaselines.projectId))
      .where(eq(projectModuleBaselines.keyModuleId, id)),
    db.select({
      projectId: projectProductModuleBindings.projectId,
      projectName: projects.name,
      moduleType: projectProductModuleBindings.moduleType,
      boundAt: projectProductModuleBindings.boundAt,
      customerConfirmationRef: projectProductModuleBindings.customerConfirmationRef,
    }).from(projectProductModuleBindings)
      .innerJoin(projects, eq(projects.id, projectProductModuleBindings.projectId))
      .where(eq(projectProductModuleBindings.moduleId, id)),
    db.select({ projectId: bomItems.projectId, partNumber: bomItems.partNumber, name: bomItems.name })
      .from(bomItems)
      .where(eq(bomItems.keyModuleId, id)),
  ]);
  const projectUses = [
    ...deliveryProjectUses.map((use) => ({
      ...use,
      usageKind: "final_delivery_selection" as const,
      isFinalDeliverySelection: true,
      drvModuleKey: null,
      confirmedAt: use.boundAt,
    })),
    ...reuseProjectUses.map((use) => ({
      ...use,
      usageKind: "drv_reuse_baseline" as const,
      isFinalDeliverySelection: false,
      moduleType: null,
      boundAt: null,
      customerConfirmationRef: null,
    })),
  ];
  return { products: productUses, projects: projectUses, bomItems: bomUses };
}

export async function compareKeyModules(leftId: string, rightId: string) {
  const [left, right] = await Promise.all([readBundle(leftId), readBundle(rightId)]);
  const itemKey = (item: KeyModuleItem) => `${item.partNumber}\u0000${item.refDesignator}`;
  const leftItems = new Map(left.items.map(item => [itemKey(item), item]));
  const rightItems = new Map(right.items.map(item => [itemKey(item), item]));
  const added = right.items.filter(item => !leftItems.has(itemKey(item)));
  const removed = left.items.filter(item => !rightItems.has(itemKey(item)));
  const changed = right.items.flatMap(item => {
    const before = leftItems.get(itemKey(item));
    if (!before) return [];
    return before.name !== item.name || before.spec !== item.spec || before.quantity !== item.quantity || before.componentProductId !== item.componentProductId
      ? [{ before, after: item }]
      : [];
  });
  return { left: left.module, right: right.module, added, removed, changed };
}

export const KEY_MODULE_API_STATUSES = KEY_MODULE_STATUSES;
export const KEY_MODULE_API_TYPES = KEY_MODULE_TYPE_IDS;
