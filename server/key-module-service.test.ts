import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { keyModuleItems, keyModules, users } from "../drizzle/schema";
import { getDb } from "./db";
import {
  approveKeyModule,
  buildKeyModuleSnapshotFromBundle,
  confirmKeyModuleTechnical,
  createKeyModule,
  deriveKeyModule,
  getKeyModuleDetail,
  listKeyModules,
  restrictKeyModule,
  updateKeyModuleDraft,
} from "./services/key-module-service";

const SUFFIX = Date.now().toString(36);
const USER_OPEN_ID = `key-module-service-${SUFFIX}`;
const MODULE_ID = `kms-${SUFFIX}`;
const DERIVED_ID = `kms-derived-${SUFFIX}`;
let userId = 0;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(keyModules).where(inArray(keyModules.id, [MODULE_ID, DERIVED_ID]));
  await db.delete(users).where(eq(users.openId, USER_OPEN_ID));
}

describe.sequential("key module service", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await cleanup();
    const [user] = await db.insert(users).values({
      openId: USER_OPEN_ID,
      username: USER_OPEN_ID,
      name: "Key Module Service Test",
    }).returning({ id: users.id });
    userId = user.id;
  });

  afterAll(cleanup);

  it("creates a draft and atomically replaces its internal BOM", async () => {
    const created = await createKeyModule({
      id: MODULE_ID,
      moduleNumber: `bat-${SUFFIX}`,
      moduleType: "battery_energy",
      name: "测试电池包",
      category: "充气泵",
      model: "BP-01",
      evidenceRefs: [{ type: "test_report", label: "电芯循环测试", ref: "TR-2026-001" }],
      items: [{ partNumber: "CELL-01", name: "电芯组", quantity: 4 }],
    }, userId);

    expect(created.module.moduleNumber).toBe(`BAT-${SUFFIX.toUpperCase()}`);
    expect(created.module.status).toBe("draft");
    expect(created.items).toHaveLength(1);

    const updated = await updateKeyModuleDraft(MODULE_ID, {
      name: "测试电池包 V1",
      items: [
        { partNumber: "CELL-02", name: "电芯组", quantity: 4, refDesignator: "CELL" },
        { partNumber: "BMS-01", name: "保护板", quantity: 1 },
      ],
    }, userId);
    expect(updated.items.map(item => item.partNumber)).toEqual(["CELL-02", "BMS-01"]);
  });

  it("requires a complete internal BOM before technical confirmation", async () => {
    await expect(updateKeyModuleDraft(MODULE_ID, { items: [] }, userId)).rejects.toMatchObject({
      code: "EMPTY_INTERNAL_BOM",
    });

    await updateKeyModuleDraft(MODULE_ID, {
      items: [{ partNumber: "CELL-02", name: "电芯组", quantity: 4 }],
    }, userId);
    const confirmed = await confirmKeyModuleTechnical(MODULE_ID, userId);
    expect(confirmed.module).toMatchObject({ status: "technical_confirmed", technicalConfirmedBy: userId });
  });

  it("makes approved module definitions immutable", async () => {
    const approved = await approveKeyModule(MODULE_ID, userId);
    expect(approved.module).toMatchObject({ status: "approved", approvedBy: userId });

    const snapshot = buildKeyModuleSnapshotFromBundle(approved);
    expect(snapshot).toMatchObject({
      status: "approved",
      createdBy: userId,
      technicalConfirmedBy: userId,
      technicalConfirmedAt: approved.module.technicalConfirmedAt?.toISOString(),
      approvedBy: userId,
      approvedAt: approved.module.approvedAt?.toISOString(),
      evidenceRefs: [{ type: "test_report", label: "电芯循环测试", ref: "TR-2026-001" }],
      restrictionReason: null,
      items: [{
        partNumber: "CELL-02",
        componentProductId: null,
        sortOrder: 0,
      }],
      internalBomHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    await expect(updateKeyModuleDraft(MODULE_ID, { model: "BP-02" }, userId)).rejects.toMatchObject({
      code: "IMMUTABLE_MODULE",
    });
  });

  it("derives a new draft number and preserves the original approved module", async () => {
    const derived = await deriveKeyModule(MODULE_ID, {
      id: DERIVED_ID,
      moduleNumber: `BAT-${SUFFIX}-02`,
      name: "测试电池包 V2",
    }, userId);

    expect(derived.module).toMatchObject({
      id: DERIVED_ID,
      status: "draft",
      derivedFromModuleId: MODULE_ID,
    });
    expect(derived.items).toHaveLength(1);
    expect((await getKeyModuleDetail(MODULE_ID))?.module.status).toBe("approved");
  });

  it("searches approved modules and ranks the same category first", async () => {
    const result = await listKeyModules({
      query: "测试电池",
      moduleType: "battery_energy",
      category: "充气泵",
      statuses: ["approved"],
      page: 1,
      pageSize: 20,
    });
    expect(result.data.map(row => row.id)).toContain(MODULE_ID);
    expect(result.pagination.totalItems).toBeGreaterThanOrEqual(1);
  });

  it("restricts a previously approved module without changing its definition", async () => {
    const restricted = await restrictKeyModule(MODULE_ID, "停止新项目选用", userId);
    expect(restricted.module).toMatchObject({ status: "restricted", restrictionReason: "停止新项目选用" });
    const detail = await getKeyModuleDetail(MODULE_ID);
    expect(detail?.items).toHaveLength(1);
  });
});
