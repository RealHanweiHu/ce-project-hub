import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { automationRules } from "../../drizzle/schema";
import { getDb, syncAutomationRuleDefaultChanges } from "../db";

const KEYS = [
  "test_default_sync_exact",
  "test_default_sync_admin",
  "test_default_sync_custom",
  "test_default_sync_disable",
];
const legacyConfig = { cadenceHours: 24, notifyRoles: ["assignee", "pm"] };
const nextConfig = { cadenceHours: 24, notifyRoles: ["assignee"] };

async function cleanup() {
  const db = await getDb();
  if (db) await db.delete(automationRules).where(inArray(automationRules.ruleKey, KEYS));
}

beforeAll(cleanup);
afterAll(cleanup);

describe("automation default reconciliation", () => {
  it("只更新仍等于旧默认的系统行，保留后台修改和 SQL 自定义配置", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    await db.insert(automationRules).values([
      { ruleKey: KEYS[0], enabled: true, config: legacyConfig, updatedBy: null },
      { ruleKey: KEYS[1], enabled: true, config: legacyConfig, updatedBy: 99 },
      { ruleKey: KEYS[2], enabled: true, config: { ...legacyConfig, cadenceHours: 12 }, updatedBy: null },
      { ruleKey: KEYS[3], enabled: true, config: legacyConfig, updatedBy: null },
    ]);

    const updated = await syncAutomationRuleDefaultChanges([
      ...KEYS.slice(0, 3).map((ruleKey) => ({
        ruleKey,
        legacyEnabled: true,
        nextEnabled: true,
        legacyConfig,
        nextConfig,
        onlyWhenSystemManaged: true as const,
      })),
      {
        ruleKey: KEYS[3],
        legacyEnabled: true,
        nextEnabled: false,
        legacyConfig,
        nextConfig,
        onlyWhenSystemManaged: true as const,
      },
    ]);
    expect(updated).toBe(2);

    const rows = await db.select().from(automationRules).where(inArray(automationRules.ruleKey, KEYS));
    const byKey = new Map(rows.map((row) => [row.ruleKey, row]));
    expect(byKey.get(KEYS[0])?.config).toEqual(nextConfig);
    expect(byKey.get(KEYS[1])?.config).toEqual(legacyConfig);
    expect(byKey.get(KEYS[1])?.updatedBy).toBe(99);
    expect(byKey.get(KEYS[2])?.config).toEqual({ ...legacyConfig, cadenceHours: 12 });
    expect(byKey.get(KEYS[3])?.enabled).toBe(false);
    expect(byKey.get(KEYS[3])?.config).toEqual(nextConfig);

    await db.delete(automationRules).where(eq(automationRules.ruleKey, KEYS[0]));
  });
});
