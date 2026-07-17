import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  keyModules,
  productTechnicalBaselines,
  products,
  projectModuleBaselines,
  projectProductModuleBindings,
  projects,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { adminRouter } from "./routers/admin";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const numericSuffix = Number(String(Date.now()).slice(-6));
const ADMIN_ID = 1_700_000_000 + numericSuffix;
const TARGET_ID = ADMIN_ID + 1;
const PROJECT_ID = `admin-plm-proj-${suffix}`.slice(0, 32);
const PRODUCT_ID = `admin-plm-prod-${suffix}`.slice(0, 32);
const MODULE_ID = `admin-plm-mod-${suffix}`.slice(0, 32);
const BASELINE_ID = `admin-plm-tb-${suffix}`.slice(0, 32);

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectProductModuleBindings).where(eq(projectProductModuleBindings.projectId, PROJECT_ID));
  await db.delete(projectModuleBaselines).where(eq(projectModuleBaselines.projectId, PROJECT_ID));
  await db.delete(productTechnicalBaselines).where(eq(productTechnicalBaselines.id, BASELINE_ID));
  await db.delete(keyModules).where(eq(keyModules.id, MODULE_ID));
  await db.delete(projects).where(eq(projects.id, PROJECT_ID));
  await db.delete(products).where(eq(products.id, PRODUCT_ID));
  await db.delete(users).where(eq(users.id, TARGET_ID));
  await db.delete(users).where(eq(users.id, ADMIN_ID));
}

afterAll(cleanup);

describe("admin.deleteUser PLM ownership handoff", () => {
  it("transfers controlled PLM actors and product ownership before deleting the account", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await cleanup();
    await db.insert(users).values([
      {
        id: ADMIN_ID,
        openId: `admin-plm-replacement-${suffix}`,
        username: `admin-plm-replacement-${suffix}`,
        name: "PLM replacement admin",
        role: "admin",
      },
      {
        id: TARGET_ID,
        openId: `admin-plm-target-${suffix}`,
        username: `admin-plm-target-${suffix}`,
        name: "PLM target user",
        role: "member",
      },
    ]);
    await db.insert(products).values({
      id: PRODUCT_ID,
      productNumber: `P-${suffix}`,
      name: "受控产品",
      createdBy: TARGET_ID,
      productManagerUserId: TARGET_ID,
      maintenanceOwnerUserId: TARGET_ID,
      afterSalesOwnerUserId: TARGET_ID,
    });
    await db.insert(projects).values({
      id: PROJECT_ID,
      name: "受控项目",
      projectNumber: `PRJ-${suffix}`,
      category: "derivative",
      currentPhase: "planning",
      createdBy: TARGET_ID,
      productOwnerUserId: TARGET_ID,
      customerSignoffOwnerUserId: TARGET_ID,
      productId: PRODUCT_ID,
    });
    await db.insert(keyModules).values({
      id: MODULE_ID,
      moduleNumber: `KM-${suffix}`,
      moduleType: "battery_energy",
      name: "受控电池模块",
      status: "approved",
      createdBy: TARGET_ID,
      technicalConfirmedBy: TARGET_ID,
      technicalConfirmedAt: new Date(),
      approvedBy: TARGET_ID,
      approvedAt: new Date(),
    });
    await db.insert(projectModuleBaselines).values({
      projectId: PROJECT_ID,
      drvModuleKey: "battery",
      reuseState: "reused",
      keyModuleId: MODULE_ID,
      moduleSnapshot: { moduleNumber: `KM-${suffix}` },
      confirmedBy: TARGET_ID,
      confirmedAt: new Date(),
    });
    await db.insert(projectProductModuleBindings).values({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_ID,
      moduleSnapshot: { moduleNumber: `KM-${suffix}` },
      boundBy: TARGET_ID,
      boundAt: new Date(),
    });
    await db.insert(productTechnicalBaselines).values({
      id: BASELINE_ID,
      productId: PRODUCT_ID,
      baselineLabel: "TB-001",
      sourceProjectId: PROJECT_ID,
      keyModulesSnapshot: {},
      bomSnapshot: [],
      specSnapshot: {},
      releasedBy: TARGET_ID,
      releasedAt: new Date(),
    });

    const caller = adminRouter.createCaller({
      user: {
        id: ADMIN_ID,
        role: "admin",
        name: "PLM replacement admin",
        canCreateProject: true,
      },
    } as any);
    await expect(caller.deleteUser({ userId: TARGET_ID })).resolves.toEqual({ success: true });

    const [target, project, product, module, projectBaseline, deliveryBinding, technicalBaseline] = await Promise.all([
      db.select({ id: users.id }).from(users).where(eq(users.id, TARGET_ID)).limit(1).then(rows => rows[0] ?? null),
      db.select().from(projects).where(eq(projects.id, PROJECT_ID)).limit(1).then(rows => rows[0]),
      db.select().from(products).where(eq(products.id, PRODUCT_ID)).limit(1).then(rows => rows[0]),
      db.select().from(keyModules).where(eq(keyModules.id, MODULE_ID)).limit(1).then(rows => rows[0]),
      db.select().from(projectModuleBaselines).where(eq(projectModuleBaselines.projectId, PROJECT_ID)).limit(1).then(rows => rows[0]),
      db.select().from(projectProductModuleBindings).where(eq(projectProductModuleBindings.projectId, PROJECT_ID)).limit(1).then(rows => rows[0]),
      db.select().from(productTechnicalBaselines).where(eq(productTechnicalBaselines.id, BASELINE_ID)).limit(1).then(rows => rows[0]),
    ]);

    expect(target).toBeNull();
    expect(project).toMatchObject({
      createdBy: ADMIN_ID,
      productOwnerUserId: ADMIN_ID,
      customerSignoffOwnerUserId: ADMIN_ID,
    });
    expect(product).toMatchObject({
      createdBy: ADMIN_ID,
      productManagerUserId: ADMIN_ID,
      maintenanceOwnerUserId: ADMIN_ID,
      afterSalesOwnerUserId: ADMIN_ID,
    });
    expect(module).toMatchObject({
      createdBy: ADMIN_ID,
      technicalConfirmedBy: ADMIN_ID,
      approvedBy: ADMIN_ID,
    });
    expect(projectBaseline?.confirmedBy).toBe(ADMIN_ID);
    expect(deliveryBinding?.boundBy).toBe(ADMIN_ID);
    expect(technicalBaseline?.releasedBy).toBe(ADMIN_ID);
  });
});
