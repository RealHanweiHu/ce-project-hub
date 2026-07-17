import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  keyModuleItems,
  keyModules,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";

const SUFFIX = Date.now().toString(36);
const USER_OPEN_ID = `key-module-schema-${SUFFIX}`;
const MODULE_ID = `km-schema-${SUFFIX}`;
const MODULE_NUMBER = `BAT-${SUFFIX}`;
let creatorId = 0;

async function expectPgError(promise: Promise<unknown>, code: string) {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, "insert should be rejected by PostgreSQL").toBeDefined();
  expect((error as { cause?: { code?: string } }).cause?.code).toBe(code);
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const [creator] = await db.insert(users).values({
    openId: USER_OPEN_ID,
    username: USER_OPEN_ID,
    name: "Key Module Schema Test",
  }).returning({ id: users.id });
  creatorId = creator.id;

  await db.insert(keyModules).values({
    id: MODULE_ID,
    moduleNumber: MODULE_NUMBER,
    moduleType: "battery_energy",
    name: "Test battery module",
    category: "test",
    createdBy: creatorId,
  });
  await db.insert(keyModuleItems).values({
    moduleId: MODULE_ID,
    partNumber: "CELL-001",
    name: "Cell set",
    quantity: 4,
    refDesignator: "CELL",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(keyModules).where(eq(keyModules.id, MODULE_ID));
  await db.delete(users).where(eq(users.openId, USER_OPEN_ID));
});

describe.sequential("key module schema", () => {
  it("stores a controlled module with draft defaults and internal BOM", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const [module] = await db.select().from(keyModules)
      .where(eq(keyModules.id, MODULE_ID));
    const items = await db.select().from(keyModuleItems)
      .where(eq(keyModuleItems.moduleId, MODULE_ID));

    expect(module).toMatchObject({
      moduleNumber: MODULE_NUMBER,
      moduleType: "battery_energy",
      status: "draft",
      attributes: {},
      evidenceRefs: [],
      createdBy: creatorId,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ partNumber: "CELL-001", quantity: 4 });
  });

  it("enforces unique module numbers", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(keyModules).values({
      id: `km-duplicate-${SUFFIX}`,
      moduleNumber: MODULE_NUMBER,
      moduleType: "battery_energy",
      name: "Duplicate",
      createdBy: creatorId,
    }), "23505");
  });

  it("rejects module types outside the three controlled physical types", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(keyModules).values({
      id: `km-invalid-type-${SUFFIX}`,
      moduleNumber: `INVALID-${SUFFIX}`,
      moduleType: "software" as never,
      name: "Invalid type",
      createdBy: creatorId,
    }), "22P02");
  });

  it("rejects a derived-from reference to a nonexistent module", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(keyModules).values({
      id: `km-invalid-parent-${SUFFIX}`,
      moduleNumber: `DERIVED-${SUFFIX}`,
      moduleType: "battery_energy",
      name: "Invalid derived module",
      derivedFromModuleId: "missing-module",
      createdBy: creatorId,
    }), "23503");
  });

  it("rejects non-positive internal BOM quantities", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(keyModuleItems).values({
      moduleId: MODULE_ID,
      partNumber: "BAD-QTY",
      name: "Invalid quantity",
      quantity: 0,
    }), "23514");
  });

  it("rejects duplicate part positions inside one module", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(db.insert(keyModuleItems).values({
      moduleId: MODULE_ID,
      partNumber: "CELL-001",
      name: "Duplicate cell set",
      quantity: 4,
      refDesignator: "CELL",
    }), "23505");
  });

  it("deleting a module cascades its internal BOM", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db.delete(keyModules).where(eq(keyModules.id, MODULE_ID));

    expect(await db.select().from(keyModuleItems)
      .where(eq(keyModuleItems.moduleId, MODULE_ID))).toEqual([]);
  });
});
