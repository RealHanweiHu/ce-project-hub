import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  bomItems,
  keyModules,
  productModuleAssignments,
  products,
  productTechnicalBaselines,
  projectModuleBaselines,
  projects,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";

const SUFFIX = randomUUID().replaceAll("-", "").slice(0, 12);
const USER_OPEN_ID = `technical-baseline-${SUFFIX}`;
const PROJECT_ID = `tb-project-${SUFFIX}`;
const PRODUCT_ID = `tb-product-${SUFFIX}`;
const MODULE_ID = `tb-module-${SUFFIX}`;
const BASELINE_ID = `tb-baseline-${SUFFIX}`;
let userId = 0;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.update(products)
    .set({ currentTechnicalBaselineId: null })
    .where(eq(products.id, PRODUCT_ID));
  await db.delete(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
  await db.delete(projectModuleBaselines).where(eq(projectModuleBaselines.projectId, PROJECT_ID));
  await db.delete(productModuleAssignments)
    .where(eq(productModuleAssignments.technicalBaselineId, BASELINE_ID));
  await db.delete(productTechnicalBaselines)
    .where(eq(productTechnicalBaselines.id, BASELINE_ID));
  await db.delete(projects).where(eq(projects.id, PROJECT_ID));
  await db.delete(keyModules).where(eq(keyModules.id, MODULE_ID));
  await db.delete(products).where(eq(products.id, PRODUCT_ID));
  await db.delete(users).where(eq(users.openId, USER_OPEN_ID));
}

async function expectPgError(promise: Promise<unknown>, code: string) {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, "database operation should be rejected").toBeDefined();
  expect((error as { cause?: { code?: string } }).cause?.code).toBe(code);
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await cleanup();
  const [user] = await db.insert(users).values({
    openId: USER_OPEN_ID,
    username: USER_OPEN_ID,
    name: "Technical Baseline Test",
  }).returning({ id: users.id });
  userId = user.id;

  await db.insert(projects).values({
    id: PROJECT_ID,
    name: "Technical baseline source project",
    projectNumber: PROJECT_ID,
    category: "derivative",
    currentPhase: "iteration",
    createdBy: userId,
  });
  await db.insert(products).values({
    id: PRODUCT_ID,
    productNumber: PRODUCT_ID,
    name: "Technical baseline product",
    createdBy: userId,
  });
  await db.insert(keyModules).values({
    id: MODULE_ID,
    moduleNumber: `BAT-${SUFFIX}`,
    moduleType: "battery_energy",
    name: "Approved battery module",
    category: "test",
    status: "approved",
    createdBy: userId,
    technicalConfirmedBy: userId,
    technicalConfirmedAt: new Date(),
    approvedBy: userId,
    approvedAt: new Date(),
  });
  await db.insert(productTechnicalBaselines).values({
    id: BASELINE_ID,
    productId: PRODUCT_ID,
    baselineLabel: "TB-001",
    sourceProjectId: PROJECT_ID,
    keyModulesSnapshot: { battery: { moduleId: MODULE_ID } },
    bomSnapshot: [{ partNumber: "BAT-001", keyModuleId: MODULE_ID }],
    specSnapshot: { voltage: "14.8V" },
    releasedBy: userId,
    releasedAt: new Date(),
  });
  await db.insert(productModuleAssignments).values({
    technicalBaselineId: BASELINE_ID,
    moduleType: "battery_energy",
    moduleId: MODULE_ID,
    moduleSnapshot: { moduleNumber: `BAT-${SUFFIX}`, internalBomHash: "hash-1" },
  });
  await db.insert(projectModuleBaselines).values([
    {
      projectId: PROJECT_ID,
      drvModuleKey: "battery",
      reuseState: "reused",
      keyModuleId: MODULE_ID,
      sourceProductId: PRODUCT_ID,
      sourceTechnicalBaselineId: BASELINE_ID,
      moduleSnapshot: { moduleNumber: `BAT-${SUFFIX}`, internalBomHash: "hash-1" },
      confirmedBy: userId,
      confirmedAt: new Date(),
    },
    {
      projectId: PROJECT_ID,
      drvModuleKey: "software_connectivity",
      reuseState: "reused",
      confirmedBy: userId,
      confirmedAt: new Date(),
    },
    {
      projectId: PROJECT_ID,
      drvModuleKey: "electronics",
      reuseState: "not_reused",
      confirmedBy: userId,
      confirmedAt: new Date(),
    },
  ]);
  await db.insert(bomItems).values({
    projectId: PROJECT_ID,
    partNumber: `BAT-${SUFFIX}`,
    name: "Controlled battery module",
    keyModuleId: MODULE_ID,
    keyModuleSnapshot: { moduleNumber: `BAT-${SUFFIX}`, internalBomHash: "hash-1" },
  });
  await db.update(products)
    .set({ currentTechnicalBaselineId: BASELINE_ID })
    .where(eq(products.id, PRODUCT_ID));
});

afterAll(cleanup);

describe.sequential("technical baseline schema", () => {
  it("links a product current baseline, module assignment, project baseline and BOM snapshot", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const [product] = await db.select().from(products).where(eq(products.id, PRODUCT_ID));
    const assignments = await db.select().from(productModuleAssignments)
      .where(eq(productModuleAssignments.technicalBaselineId, BASELINE_ID));
    const projectBaselines = await db.select().from(projectModuleBaselines)
      .where(eq(projectModuleBaselines.projectId, PROJECT_ID));
    const bom = await db.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));

    expect(product.currentTechnicalBaselineId).toBe(BASELINE_ID);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ moduleId: MODULE_ID, moduleType: "battery_energy" });
    expect(projectBaselines).toHaveLength(3);
    expect(projectBaselines.find(row => row.drvModuleKey === "battery")).toMatchObject({
      reuseState: "reused",
      keyModuleId: MODULE_ID,
      sourceTechnicalBaselineId: BASELINE_ID,
    });
    expect(bom[0]).toMatchObject({
      keyModuleId: MODULE_ID,
      keyModuleSnapshot: { moduleNumber: `BAT-${SUFFIX}`, internalBomHash: "hash-1" },
    });
  });

  it("requires a key module reference when a physical module is reused", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(projectModuleBaselines).values({
      projectId: PROJECT_ID,
      drvModuleKey: "core_function",
      reuseState: "reused",
      confirmedBy: userId,
      confirmedAt: new Date(),
    }), "23514");
  });

  it("rejects a key module reference when the physical module is not reused", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(projectModuleBaselines).values({
      projectId: PROJECT_ID,
      drvModuleKey: "core_function",
      reuseState: "not_reused",
      keyModuleId: MODULE_ID,
      confirmedBy: userId,
      confirmedAt: new Date(),
    }), "23514");
  });

  it("never allows physical key module references on nonphysical DRV modules", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(projectModuleBaselines).values({
      projectId: PROJECT_ID,
      drvModuleKey: "structure_mold",
      reuseState: "reused",
      keyModuleId: MODULE_ID,
      confirmedBy: userId,
      confirmedAt: new Date(),
    }), "23514");
  });

  it("enforces one project baseline row per DRV module", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(projectModuleBaselines).values({
      projectId: PROJECT_ID,
      drvModuleKey: "software_connectivity",
      reuseState: "reused",
      confirmedBy: userId,
      confirmedAt: new Date(),
    }), "23505");
  });

  it("enforces one assignment per physical module type in a technical baseline", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(productModuleAssignments).values({
      technicalBaselineId: BASELINE_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_ID,
      moduleSnapshot: { duplicate: true },
    }), "23505");
  });

  it("prevents deleting a key module that is referenced by a released or project baseline", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(
      db.delete(keyModules).where(eq(keyModules.id, MODULE_ID)),
      "23503",
    );
  });

  it("rejects a product pointer to a nonexistent technical baseline", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.update(products)
      .set({ currentTechnicalBaselineId: "missing-baseline" })
      .where(eq(products.id, PRODUCT_ID)), "23503");
  });
});
