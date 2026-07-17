import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  keyModuleAuditEvents,
  keyModules,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { keyModulesRouter } from "./routers/keyModules";
import {
  KeyModuleServiceError,
  approveKeyModule,
  buildKeyModuleSnapshotFromBundle,
  confirmKeyModuleTechnical,
  createKeyModule,
  deriveKeyModule,
  getKeyModuleHistory,
  hashKeyModuleSnapshot,
  obsoleteKeyModule,
  reopenKeyModuleDraft,
  restrictKeyModule,
  updateKeyModuleDraft,
} from "./services/key-module-service";

const SUFFIX = Date.now().toString(36);
const MODULE_ID = `kma-main-${SUFFIX}`;
const DERIVED_ID = `kma-child-${SUFFIX}`;
const CONCURRENT_ID = `kma-race-${SUFFIX}`;
const OPEN_IDS = [`kma-engineer-${SUFFIX}`, `kma-manager-${SUFFIX}`];
let engineerId = 0;
let managerId = 0;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(keyModules).where(eq(keyModules.id, DERIVED_ID));
  await db.delete(keyModules).where(inArray(keyModules.id, [MODULE_ID, CONCURRENT_ID]));
  await db.delete(users).where(inArray(users.openId, OPEN_IDS));
}

function baseModule(id: string, moduleNumber: string) {
  return {
    id,
    moduleNumber,
    moduleType: "electronics_hardware" as const,
    name: "审计测试 PCBA",
    category: "测试",
    items: [{ partNumber: "PCB-001", name: "主板", quantity: 1 }],
  };
}

async function expectPgError(promise: Promise<unknown>, code: string) {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, "database mutation should be rejected").toBeDefined();
  expect((error as { cause?: { code?: string } }).cause?.code).toBe(code);
}

describe.sequential("key module append-only audit", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await cleanup();
    const actors = await db.insert(users).values([
      { openId: OPEN_IDS[0], username: OPEN_IDS[0], name: "Audit Engineer" },
      { openId: OPEN_IDS[1], username: OPEN_IDS[1], name: "Audit Manager", canCreateProject: true },
    ]).returning({ id: users.id, openId: users.openId });
    engineerId = actors.find(actor => actor.openId === OPEN_IDS[0])!.id;
    managerId = actors.find(actor => actor.openId === OPEN_IDS[1])!.id;
  });

  afterAll(cleanup);

  it("records every lifecycle action in the same controlled history", async () => {
    const created = await createKeyModule(baseModule(MODULE_ID, `AUD-${SUFFIX}`), engineerId);
    const beforeSnapshotHash = hashKeyModuleSnapshot(buildKeyModuleSnapshotFromBundle(created));
    const updated = await updateKeyModuleDraft(MODULE_ID, {
      name: "审计测试 PCBA V2",
      items: [{ partNumber: "PCB-001", name: "主板 V2", quantity: 1 }],
    }, engineerId);
    const afterSnapshotHash = hashKeyModuleSnapshot(buildKeyModuleSnapshotFromBundle(updated));
    await confirmKeyModuleTechnical(MODULE_ID, engineerId);

    const managerCaller = keyModulesRouter.createCaller({
      user: { id: managerId, role: "member", name: "Audit Manager", canCreateProject: true },
    } as any);
    await expect(managerCaller.returnToDraft({ id: MODULE_ID } as any))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(reopenKeyModuleDraft(MODULE_ID, managerId, "   "))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await reopenKeyModuleDraft(MODULE_ID, managerId, "技术证据需补充");
    await confirmKeyModuleTechnical(MODULE_ID, engineerId);
    await approveKeyModule(MODULE_ID, managerId);
    await deriveKeyModule(MODULE_ID, {
      id: DERIVED_ID,
      moduleNumber: `AUD-D-${SUFFIX}`,
    }, engineerId);
    await restrictKeyModule(MODULE_ID, "暂停新项目选用", managerId);
    await obsoleteKeyModule(MODULE_ID, "已由新编号替代", managerId);

    const history = await getKeyModuleHistory(MODULE_ID);
    expect(history.map(event => event.action)).toEqual([
      "create",
      "update_draft",
      "technical_confirm",
      "return_to_draft",
      "technical_confirm",
      "approve",
      "restrict",
      "obsolete",
    ]);
    expect(history.map(event => [event.fromStatus, event.toStatus])).toEqual([
      [null, "draft"],
      ["draft", "draft"],
      ["draft", "technical_confirmed"],
      ["technical_confirmed", "draft"],
      ["draft", "technical_confirmed"],
      ["technical_confirmed", "approved"],
      ["approved", "restricted"],
      ["restricted", "obsolete"],
    ]);
    expect(history[1]?.meta).toMatchObject({
      snapshotSchemaVersion: 1,
      snapshotHashAlgorithm: "sha256",
      snapshotHashScope: "controlled_module_definition_and_internal_bom",
      beforeSnapshotHash,
      afterSnapshotHash,
      changedFields: ["items", "name"],
    });
    expect(beforeSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(afterSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(afterSnapshotHash).not.toBe(beforeSnapshotHash);
    expect(history[3]).toMatchObject({ actorId: managerId, reason: "技术证据需补充" });
    expect(history[6]).toMatchObject({ actorId: managerId, reason: "暂停新项目选用" });
    expect(history[7]).toMatchObject({ actorId: managerId, reason: "已由新编号替代" });
    expect(history[0]?.actorName).toBe("Audit Engineer");

    const derivedHistory = await getKeyModuleHistory(DERIVED_ID);
    expect(derivedHistory).toHaveLength(1);
    expect(derivedHistory[0]).toMatchObject({
      action: "derive",
      fromStatus: null,
      toStatus: "draft",
      actorId: engineerId,
      meta: {
        sourceModuleId: MODULE_ID,
        sourceModuleNumber: `AUD-${SUFFIX}`.toUpperCase(),
      },
    });

    const internalCaller = keyModulesRouter.createCaller({
      user: { id: engineerId, role: "member", name: "Audit Engineer" },
    } as any);
    expect((await internalCaller.history({ id: MODULE_ID })).map(event => event.action))
      .toEqual(history.map(event => event.action));

    const externalCaller = keyModulesRouter.createCaller({
      user: { id: 999, role: "external" },
    } as any);
    await expect(externalCaller.history({ id: MODULE_ID }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("serializes competing state transitions so only one approval is recorded", async () => {
    await createKeyModule(baseModule(CONCURRENT_ID, `RACE-${SUFFIX}`), engineerId);
    await confirmKeyModuleTechnical(CONCURRENT_ID, engineerId);

    const results = await Promise.allSettled([
      approveKeyModule(CONCURRENT_ID, managerId),
      approveKeyModule(CONCURRENT_ID, managerId),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining<KeyModuleServiceError>({ code: "INVALID_STATE" }),
    });

    const history = await getKeyModuleHistory(CONCURRENT_ID);
    expect(history.filter(event => event.action === "approve")).toHaveLength(1);
  });

  it("rejects database updates and deletes against audit history", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const [event] = await db.select().from(keyModuleAuditEvents)
      .where(eq(keyModuleAuditEvents.moduleId, MODULE_ID))
      .limit(1);
    expect(event).toBeDefined();

    await expectPgError(
      db.update(keyModuleAuditEvents)
        .set({ reason: "篡改" })
        .where(eq(keyModuleAuditEvents.id, event.id)),
      "55000",
    );
    await expectPgError(
      db.delete(keyModuleAuditEvents)
        .where(eq(keyModuleAuditEvents.id, event.id)),
      "55000",
    );

    const [unchanged] = await db.select().from(keyModuleAuditEvents)
      .where(eq(keyModuleAuditEvents.id, event.id));
    expect(unchanged).toMatchObject({ id: event.id, reason: event.reason });
  });
});
