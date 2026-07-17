import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  activityLogs,
  keyModuleItems,
  keyModules,
  productTechnicalBaselines,
  products,
  projectMembers,
  projectProductModuleBindings,
  projects,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { projectDeliveryModulesRouter } from "./routers/projectDeliveryModules";

const SUFFIX = Date.now().toString(36);
const OWNER_OPEN_ID = `delivery-owner-${SUFFIX}`;
const VIEWER_OPEN_ID = `delivery-viewer-${SUFFIX}`;
const EXTERNAL_OPEN_ID = `delivery-external-${SUFFIX}`;
const PROJECT_ID = `delivery-npd-${SUFFIX}`;
const ECO_PROJECT_ID = `delivery-eco-${SUFFIX}`;
const JDM_PROJECT_ID = `delivery-jdm-${SUFFIX}`;
const UNSUPPORTED_PROJECT_ID = `delivery-idr-${SUFFIX}`;
const PRODUCT_ID = `delivery-product-${SUFFIX}`;
const BASELINE_ID = `delivery-baseline-${SUFFIX}`;
const MODULE_IDS = {
  batteryA: `delivery-bat-a-${SUFFIX}`,
  batteryB: `delivery-bat-b-${SUFFIX}`,
  draftBattery: `delivery-bat-d-${SUFFIX}`,
  core: `delivery-core-${SUFFIX}`,
} as const;
let ownerId = 0;
let viewerId = 0;
let externalId = 0;

const makeCaller = (id: number, systemRole = "user") => projectDeliveryModulesRouter.createCaller({
  user: {
    id,
    role: systemRole,
    name: `u${id}`,
    email: null,
    canCreateProject: false,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
    passwordHash: null,
    username: null,
  },
} as never);

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.update(products).set({ currentTechnicalBaselineId: null })
    .where(eq(products.id, PRODUCT_ID));
  await db.delete(productTechnicalBaselines).where(eq(productTechnicalBaselines.id, BASELINE_ID));
  await db.delete(activityLogs)
    .where(inArray(activityLogs.projectId, [PROJECT_ID, ECO_PROJECT_ID, JDM_PROJECT_ID, UNSUPPORTED_PROJECT_ID]));
  await db.delete(projectProductModuleBindings)
    .where(inArray(projectProductModuleBindings.projectId, [PROJECT_ID, ECO_PROJECT_ID, JDM_PROJECT_ID, UNSUPPORTED_PROJECT_ID]));
  await db.delete(projectMembers)
    .where(inArray(projectMembers.projectId, [PROJECT_ID, ECO_PROJECT_ID, JDM_PROJECT_ID, UNSUPPORTED_PROJECT_ID]));
  await db.delete(projects).where(inArray(projects.id, [PROJECT_ID, ECO_PROJECT_ID, JDM_PROJECT_ID, UNSUPPORTED_PROJECT_ID]));
  await db.delete(keyModuleItems).where(inArray(keyModuleItems.moduleId, Object.values(MODULE_IDS)));
  await db.delete(keyModules).where(inArray(keyModules.id, Object.values(MODULE_IDS)));
  await db.delete(products).where(eq(products.id, PRODUCT_ID));
  await db.delete(users).where(inArray(users.openId, [OWNER_OPEN_ID, VIEWER_OPEN_ID, EXTERNAL_OPEN_ID]));
}

beforeAll(async () => {
  await cleanup();
  const db = await getDb();
  if (!db) throw new Error("no db");
  const createdUsers = await db.insert(users).values([
    { openId: OWNER_OPEN_ID, username: OWNER_OPEN_ID, name: "Delivery Owner" },
    { openId: VIEWER_OPEN_ID, username: VIEWER_OPEN_ID, name: "Delivery Viewer" },
    { openId: EXTERNAL_OPEN_ID, username: EXTERNAL_OPEN_ID, name: "Delivery External" },
  ]).returning({ id: users.id, openId: users.openId });
  ownerId = createdUsers.find((user) => user.openId === OWNER_OPEN_ID)!.id;
  viewerId = createdUsers.find((user) => user.openId === VIEWER_OPEN_ID)!.id;
  externalId = createdUsers.find((user) => user.openId === EXTERNAL_OPEN_ID)!.id;

  await db.insert(projects).values([
    {
      id: PROJECT_ID,
      name: "NPD delivery modules",
      projectNumber: PROJECT_ID,
      category: "npd",
      currentPhase: "design",
      createdBy: ownerId,
      pmUserId: ownerId,
    },
    {
      id: ECO_PROJECT_ID,
      name: "ECO delivery modules",
      projectNumber: ECO_PROJECT_ID,
      category: "eco",
      currentPhase: "assessment",
      createdBy: ownerId,
      pmUserId: ownerId,
    },
    {
      id: JDM_PROJECT_ID,
      name: "JDM delivery modules",
      projectNumber: JDM_PROJECT_ID,
      category: "jdm",
      currentPhase: "definition",
      createdBy: ownerId,
      pmUserId: ownerId,
    },
    {
      id: UNSUPPORTED_PROJECT_ID,
      name: "Retired IDR cannot bind delivery modules",
      projectNumber: UNSUPPORTED_PROJECT_ID,
      category: "idr",
      currentPhase: "concept",
      createdBy: ownerId,
      pmUserId: ownerId,
    },
  ]);
  await db.insert(projectMembers).values([
    { projectId: PROJECT_ID, userId: viewerId, role: "viewer", invitedBy: ownerId },
    { projectId: PROJECT_ID, userId: externalId, role: "external_customer", invitedBy: ownerId },
  ]);
  await db.insert(keyModules).values([
    { id: MODULE_IDS.batteryA, moduleNumber: `BAT-A-${SUFFIX}`, moduleType: "battery_energy", name: "Battery A", category: "test", status: "approved", createdBy: ownerId, technicalConfirmedBy: ownerId, technicalConfirmedAt: new Date(), approvedBy: ownerId, approvedAt: new Date() },
    { id: MODULE_IDS.batteryB, moduleNumber: `BAT-B-${SUFFIX}`, moduleType: "battery_energy", name: "Battery B", category: "test", status: "approved", createdBy: ownerId, technicalConfirmedBy: ownerId, technicalConfirmedAt: new Date(), approvedBy: ownerId, approvedAt: new Date() },
    { id: MODULE_IDS.draftBattery, moduleNumber: `BAT-D-${SUFFIX}`, moduleType: "battery_energy", name: "Draft battery", category: "test", status: "draft", createdBy: ownerId },
    { id: MODULE_IDS.core, moduleNumber: `CORE-${SUFFIX}`, moduleType: "core_function", name: "Core", category: "test", status: "approved", createdBy: ownerId, technicalConfirmedBy: ownerId, technicalConfirmedAt: new Date(), approvedBy: ownerId, approvedAt: new Date() },
  ]);
  await db.insert(keyModuleItems).values([
    { moduleId: MODULE_IDS.batteryA, partNumber: "CELL-A", name: "Cell A", quantity: 4 },
    { moduleId: MODULE_IDS.batteryB, partNumber: "CELL-B", name: "Cell B", quantity: 4 },
    { moduleId: MODULE_IDS.draftBattery, partNumber: "CELL-D", name: "Cell D", quantity: 4 },
    { moduleId: MODULE_IDS.core, partNumber: "MOTOR-1", name: "Motor", quantity: 1 },
  ]);
});

afterAll(cleanup);

describe.sequential("project delivery module bindings", () => {
  it("binds an approved module and returns its immutable definition snapshot", async () => {
    const bound = await makeCaller(ownerId).bind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.batteryA,
    });
    expect(bound).toMatchObject({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.batteryA,
      moduleSnapshot: expect.objectContaining({
        moduleNumber: `BAT-A-${SUFFIX}`,
        internalBomHash: expect.any(String),
        items: [expect.objectContaining({ partNumber: "CELL-A", quantity: 4 })],
      }),
    });

    const listed = await makeCaller(ownerId).list({ projectId: PROJECT_ID });
    expect(listed.isReleased).toBe(false);
    expect(listed.bindings).toHaveLength(1);

    const { getKeyModuleWhereUsed } = await import("./services/key-module-service");
    const whereUsed = await getKeyModuleWhereUsed(MODULE_IDS.batteryA);
    expect(whereUsed.projects).toContainEqual(expect.objectContaining({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
      usageKind: "final_delivery_selection",
      isFinalDeliverySelection: true,
    }));
  });

  it("atomically replaces the binding for the same module type", async () => {
    await makeCaller(ownerId).bind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.batteryB,
    });
    const listed = await makeCaller(ownerId).list({ projectId: PROJECT_ID });
    expect(listed.bindings).toHaveLength(1);
    expect(listed.bindings[0]).toMatchObject({ moduleId: MODULE_IDS.batteryB });
  });

  it("supports ECO module changes but rejects drafts, mismatched types, and retired tracks", async () => {
    await expect(makeCaller(ownerId).bind({
      projectId: ECO_PROJECT_ID,
      moduleType: "core_function",
      moduleId: MODULE_IDS.core,
    })).resolves.toMatchObject({ moduleId: MODULE_IDS.core });
    await expect(makeCaller(ownerId).unbind({
      projectId: ECO_PROJECT_ID,
      moduleType: "core_function",
    })).resolves.toEqual({ ok: true });
    await expect(makeCaller(ownerId).bind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.draftBattery,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(makeCaller(ownerId).bind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.core,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(makeCaller(ownerId).bind({
      projectId: UNSUPPORTED_PROJECT_ID,
      moduleType: "core_function",
      moduleId: MODULE_IDS.core,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("allows project viewers to query but not bind or unbind", async () => {
    await expect(makeCaller(viewerId).list({ projectId: PROJECT_ID })).resolves.toMatchObject({
      bindings: expect.any(Array),
    });
    await expect(makeCaller(viewerId).bind({
      projectId: PROJECT_ID,
      moduleType: "core_function",
      moduleId: MODULE_IDS.core,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(makeCaller(viewerId).unbind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not expose internal module snapshots to external project roles", async () => {
    await expect(makeCaller(externalId).list({ projectId: PROJECT_ID }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects system-external users before implicit owner or PM access is considered", async () => {
    const externalOwner = makeCaller(ownerId, "external");
    await expect(externalOwner.list({ projectId: PROJECT_ID }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(externalOwner.bind({
      projectId: PROJECT_ID,
      moduleType: "core_function",
      moduleId: MODULE_IDS.core,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(externalOwner.unbind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires a fresh customer confirmation reference for every JDM bind, replace, and unbind", async () => {
    const caller = makeCaller(ownerId);
    await expect(caller.bind({
      projectId: JDM_PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.batteryA,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(caller.bind({
      projectId: JDM_PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.batteryA,
      customerConfirmationRef: "MAIL-JDM-001",
    })).resolves.toMatchObject({
      moduleId: MODULE_IDS.batteryA,
      customerConfirmationRef: "MAIL-JDM-001",
    });
    await expect(caller.bind({
      projectId: JDM_PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.batteryB,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.bind({
      projectId: JDM_PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.batteryB,
      customerConfirmationRef: "MAIL-JDM-002",
    })).resolves.toMatchObject({
      moduleId: MODULE_IDS.batteryB,
      customerConfirmationRef: "MAIL-JDM-002",
    });

    const listed = await caller.list({ projectId: JDM_PROJECT_ID });
    expect(listed.requiresCustomerConfirmation).toBe(true);
    expect(listed.bindings[0]).toMatchObject({
      moduleId: MODULE_IDS.batteryB,
      customerConfirmationRef: "MAIL-JDM-002",
    });

    await expect(caller.unbind({
      projectId: JDM_PROJECT_ID,
      moduleType: "battery_energy",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.unbind({
      projectId: JDM_PROJECT_ID,
      moduleType: "battery_energy",
      customerConfirmationRef: "MAIL-JDM-003",
    })).resolves.toEqual({ ok: true });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const audit = await db.select().from(activityLogs).where(and(
      eq(activityLogs.projectId, JDM_PROJECT_ID),
      inArray(activityLogs.action, ["delivery_module.bind", "delivery_module.unbind"]),
    )).orderBy(asc(activityLogs.id));
    expect(audit.map((event) => event.action)).toEqual([
      "delivery_module.bind",
      "delivery_module.bind",
      "delivery_module.unbind",
    ]);
    expect(audit[0]?.meta).toMatchObject({
      before: null,
      after: { moduleId: MODULE_IDS.batteryA, customerConfirmationRef: "MAIL-JDM-001" },
      customerConfirmationRef: "MAIL-JDM-001",
    });
    expect(audit[1]?.meta).toMatchObject({
      before: { moduleId: MODULE_IDS.batteryA, customerConfirmationRef: "MAIL-JDM-001" },
      after: { moduleId: MODULE_IDS.batteryB, customerConfirmationRef: "MAIL-JDM-002" },
      customerConfirmationRef: "MAIL-JDM-002",
    });
    expect(audit[2]?.meta).toMatchObject({
      before: { moduleId: MODULE_IDS.batteryB, customerConfirmationRef: "MAIL-JDM-002" },
      after: null,
      customerConfirmationRef: "MAIL-JDM-003",
    });
  });

  it("unbinds a pre-release module selection", async () => {
    await expect(makeCaller(ownerId).unbind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
    })).resolves.toEqual({ ok: true });
    expect((await makeCaller(ownerId).list({ projectId: PROJECT_ID })).bindings).toEqual([]);
  });

  it("becomes immutable as soon as a product technical baseline is released", async () => {
    await makeCaller(ownerId).bind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.batteryA,
    });
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db.insert(products).values({
      id: PRODUCT_ID,
      productNumber: PRODUCT_ID,
      name: "Released product",
      createdBy: ownerId,
    });
    await db.insert(productTechnicalBaselines).values({
      id: BASELINE_ID,
      productId: PRODUCT_ID,
      baselineLabel: "TB-001",
      sourceProjectId: PROJECT_ID,
      keyModulesSnapshot: {},
      bomSnapshot: [],
      specSnapshot: {},
      releasedBy: ownerId,
      releasedAt: new Date(),
    });

    await expect(makeCaller(ownerId).bind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
      moduleId: MODULE_IDS.batteryB,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(makeCaller(ownerId).unbind({
      projectId: PROJECT_ID,
      moduleType: "battery_energy",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    const listed = await makeCaller(ownerId).list({ projectId: PROJECT_ID });
    expect(listed.isReleased).toBe(true);
    expect(listed.bindings[0]).toMatchObject({ moduleId: MODULE_IDS.batteryA });
  });
});
