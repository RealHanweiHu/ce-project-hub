import { and, asc, eq, sql } from "drizzle-orm";
import {
  activityLogs,
  keyModuleItems,
  keyModules,
  productTechnicalBaselines,
  projectModuleBaselines,
  projectProductModuleBindings,
  projects,
  type ProjectProductModuleBinding,
} from "../../drizzle/schema";
import {
  KEY_MODULE_TYPES,
  type KeyModuleType,
} from "../../shared/key-modules";
import { acquireProjectReleaseStateLock, getDb } from "../db";
import { buildKeyModuleSnapshotFromBundle } from "./key-module-service";

const DELIVERY_MODULE_PROJECT_CATEGORIES = new Set(["npd", "jdm", "obt", "derivative", "eco"]);
const CUSTOMER_CONFIRMATION_PROJECT_CATEGORIES = new Set(["jdm", "obt"]);

export class ProjectDeliveryModuleError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_PROJECT_TYPE"
      | "INVALID_MODULE_TYPE"
      | "MODULE_NOT_APPROVED"
      | "REQUIRED_BASELINE"
      | "CUSTOMER_CONFIRMATION_REQUIRED"
      | "PROJECT_RELEASED",
    message: string,
  ) {
    super(message);
    this.name = "ProjectDeliveryModuleError";
  }
}

// Drizzle's transaction executor is structurally compatible with the main DB,
// but its inferred generic type is intentionally kept behind this small module boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = any;

async function lockProjectDeliveryModules(executor: Executor, projectId: string) {
  await acquireProjectReleaseStateLock(executor, projectId);
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`delivery-modules:${projectId}`}))`,
  );
}

async function requireSupportedProject(executor: Executor, projectId: string) {
  const [project] = await executor.select().from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
    .for("update");
  if (!project) throw new ProjectDeliveryModuleError("NOT_FOUND", "项目不存在");
  if (!DELIVERY_MODULE_PROJECT_CATEGORIES.has(project.category)) {
    throw new ProjectDeliveryModuleError(
      "INVALID_PROJECT_TYPE",
      "只有 NPD、JDM、OBT、DRV 或 ECO 项目可以维护产品交付模块",
    );
  }
  return project;
}

async function assertProjectNotReleased(executor: Executor, projectId: string) {
  const [released] = await executor.select({ id: productTechnicalBaselines.id })
    .from(productTechnicalBaselines)
    .where(eq(productTechnicalBaselines.sourceProjectId, projectId))
    .limit(1);
  if (released) {
    throw new ProjectDeliveryModuleError(
      "PROJECT_RELEASED",
      "项目已发布，产品交付模块已经冻结，不能再修改",
    );
  }
}

function normalizeCustomerConfirmationRef(
  projectCategory: string,
  value?: string | null,
): string | null {
  const normalized = value?.trim() || null;
  if (CUSTOMER_CONFIRMATION_PROJECT_CATEGORIES.has(projectCategory) && !normalized) {
    throw new ProjectDeliveryModuleError(
      "CUSTOMER_CONFIRMATION_REQUIRED",
      "JDM/OBT 的产品交付模块变更必须填写本次客户书面确认引用",
    );
  }
  return normalized;
}

function summarizeBinding(binding: ProjectProductModuleBinding | undefined | null) {
  if (!binding) return null;
  const snapshot = binding.moduleSnapshot ?? {};
  return {
    moduleId: binding.moduleId,
    moduleType: binding.moduleType,
    moduleNumber: typeof snapshot.moduleNumber === "string" ? snapshot.moduleNumber : null,
    moduleName: typeof snapshot.name === "string" ? snapshot.name : null,
    customerConfirmationRef: binding.customerConfirmationRef,
  };
}

export async function listProjectDeliveryModuleBindings(projectId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [bindings, released, reusedBaselines, projectRows] = await Promise.all([
    db.select().from(projectProductModuleBindings)
      .where(eq(projectProductModuleBindings.projectId, projectId))
      .orderBy(projectProductModuleBindings.moduleType),
    db.select({ id: productTechnicalBaselines.id })
      .from(productTechnicalBaselines)
      .where(eq(productTechnicalBaselines.sourceProjectId, projectId))
      .limit(1),
    db.select({ drvModuleKey: projectModuleBaselines.drvModuleKey })
      .from(projectModuleBaselines)
      .where(and(
        eq(projectModuleBaselines.projectId, projectId),
        eq(projectModuleBaselines.reuseState, "reused"),
      )),
    db.select({ category: projects.category }).from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
  ]);
  const moduleTypeByDrvKey = new Map(
    KEY_MODULE_TYPES.map(definition => [definition.drvModuleId, definition.id] as const),
  );
  const requiredModuleTypes = reusedBaselines.flatMap((baseline) => {
    const moduleType = moduleTypeByDrvKey.get(baseline.drvModuleKey as never);
    return moduleType ? [moduleType] : [];
  });
  const projectCategory = projectRows[0]?.category ?? null;
  return {
    projectId,
    projectCategory,
    requiresCustomerConfirmation: projectCategory
      ? CUSTOMER_CONFIRMATION_PROJECT_CATEGORIES.has(projectCategory)
      : false,
    isReleased: released.length > 0,
    requiredModuleTypes,
    bindings,
  };
}

export async function bindProjectDeliveryModule(input: {
  projectId: string;
  moduleType: KeyModuleType;
  moduleId: string;
  actorId: number;
  customerConfirmationRef?: string | null;
}): Promise<ProjectProductModuleBinding> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    await lockProjectDeliveryModules(tx, input.projectId);
    const project = await requireSupportedProject(tx, input.projectId);
    await assertProjectNotReleased(tx, input.projectId);
    const customerConfirmationRef = normalizeCustomerConfirmationRef(
      project.category,
      input.customerConfirmationRef,
    );

    const [module] = await tx.select().from(keyModules)
      .where(eq(keyModules.id, input.moduleId))
      .limit(1)
      .for("update");
    if (!module) throw new ProjectDeliveryModuleError("NOT_FOUND", "关键模块不存在");
    if (module.moduleType !== input.moduleType) {
      throw new ProjectDeliveryModuleError(
        "INVALID_MODULE_TYPE",
        `关键模块 ${module.moduleNumber} 的类型与交付模块位置不匹配`,
      );
    }
    if (module.status !== "approved") {
      throw new ProjectDeliveryModuleError(
        "MODULE_NOT_APPROVED",
        `关键模块 ${module.moduleNumber} 尚未批准，不能绑定到产品交付`,
      );
    }
    const items = await tx.select().from(keyModuleItems)
      .where(eq(keyModuleItems.moduleId, input.moduleId))
      .orderBy(asc(keyModuleItems.sortOrder), asc(keyModuleItems.id));
    const moduleSnapshot = buildKeyModuleSnapshotFromBundle({ module, items });
    const now = new Date();
    const [previousBinding] = await tx.select().from(projectProductModuleBindings)
      .where(and(
        eq(projectProductModuleBindings.projectId, input.projectId),
        eq(projectProductModuleBindings.moduleType, input.moduleType),
      ))
      .limit(1)
      .for("update");
    const [binding] = await tx.insert(projectProductModuleBindings).values({
      projectId: input.projectId,
      moduleType: input.moduleType,
      moduleId: input.moduleId,
      moduleSnapshot,
      customerConfirmationRef,
      boundBy: input.actorId,
      boundAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        projectProductModuleBindings.projectId,
        projectProductModuleBindings.moduleType,
      ],
      set: {
        moduleId: input.moduleId,
        moduleSnapshot,
        customerConfirmationRef,
        boundBy: input.actorId,
        boundAt: now,
        updatedAt: now,
      },
    }).returning();
    await tx.insert(activityLogs).values({
      projectId: input.projectId,
      userId: input.actorId,
      action: "delivery_module.bind",
      entityType: "delivery_module",
      entityId: `${input.projectId}:${input.moduleType}`,
      meta: {
        moduleType: input.moduleType,
        before: summarizeBinding(previousBinding),
        after: summarizeBinding(binding),
        customerConfirmationRef,
      },
    });
    return binding;
  });
}

export async function unbindProjectDeliveryModule(input: {
  projectId: string;
  moduleType: KeyModuleType;
  actorId: number;
  customerConfirmationRef?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    await lockProjectDeliveryModules(tx, input.projectId);
    const project = await requireSupportedProject(tx, input.projectId);
    await assertProjectNotReleased(tx, input.projectId);
    const customerConfirmationRef = normalizeCustomerConfirmationRef(
      project.category,
      input.customerConfirmationRef,
    );
    const drvModuleId = KEY_MODULE_TYPES.find(
      definition => definition.id === input.moduleType,
    )?.drvModuleId;
    if (drvModuleId) {
      const [requiredBaseline] = await tx.select({ id: projectModuleBaselines.id })
        .from(projectModuleBaselines)
        .where(and(
          eq(projectModuleBaselines.projectId, input.projectId),
          eq(projectModuleBaselines.drvModuleKey, drvModuleId),
          eq(projectModuleBaselines.reuseState, "reused"),
        ))
        .limit(1);
      if (requiredBaseline) {
        throw new ProjectDeliveryModuleError(
          "REQUIRED_BASELINE",
          "DRV 建项复用模块不能移除；如最终选型发生变化，请改选已批准的新模块编号",
        );
      }
    }
    const [previousBinding] = await tx.select().from(projectProductModuleBindings)
      .where(and(
        eq(projectProductModuleBindings.projectId, input.projectId),
        eq(projectProductModuleBindings.moduleType, input.moduleType),
      ))
      .limit(1)
      .for("update");
    await tx.delete(projectProductModuleBindings).where(and(
      eq(projectProductModuleBindings.projectId, input.projectId),
      eq(projectProductModuleBindings.moduleType, input.moduleType),
    ));
    if (previousBinding) {
      await tx.insert(activityLogs).values({
        projectId: input.projectId,
        userId: input.actorId,
        action: "delivery_module.unbind",
        entityType: "delivery_module",
        entityId: `${input.projectId}:${input.moduleType}`,
        meta: {
          moduleType: input.moduleType,
          before: summarizeBinding(previousBinding),
          after: null,
          customerConfirmationRef,
        },
      });
    }
  });
}
