import { describe, it, expect, beforeAll } from "vitest";
import {
  seedModuleLibrary, listModuleLibrary, getModuleTasks,
  setProjectModule, listProjectModules, getDb,
} from "./db";

beforeAll(async () => {
  await seedModuleLibrary();
});

describe("Module library + reuse-set", () => {
  it("seeds 9 modules (6 shared + 3 core)", async () => {
    const lib = await listModuleLibrary();
    expect(lib.length).toBeGreaterThanOrEqual(9);
    expect(lib.filter((m) => m.scope === "core").map((m) => m.moduleKey).sort())
      .toEqual(["fan_motor", "manual_pump", "pump_core"]);
  });

  it("housing module has an ID review gate task with PI checklist", async () => {
    const tasks = await getModuleTasks("housing");
    const idReview = tasks.find((t) => t.gateName === "ID 评审");
    expect(idReview).toBeTruthy();
    expect(idReview!.ownerRoles).toContain("sales");
    expect((idReview!.checklist || []).some((c) => c.includes("PI"))).toBe(true);
  });

  it("seed is idempotent (re-seed keeps 9, not 18)", async () => {
    await seedModuleLibrary();
    const lib = await listModuleLibrary();
    const keys = lib.map((m) => m.moduleKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares a project reuse-set (change levels)", async () => {
    const db = await getDb();
    const { sql } = await import("drizzle-orm");
    await db!.execute(sql`DELETE FROM project_modules WHERE "projectId"='pm_test'`);
    await setProjectModule("pm_test", "pump_core", "carryover", null);
    await setProjectModule("pm_test", "housing", "redesign", null);
    await setProjectModule("pm_test", "housing", "minor", null); // upsert
    const mods = await listProjectModules("pm_test");
    expect(mods.length).toBe(2);
    expect(mods.find((m) => m.moduleKey === "housing")!.changeLevel).toBe("minor");
    expect(mods.find((m) => m.moduleKey === "pump_core")!.changeLevel).toBe("carryover");
    await db!.execute(sql`DELETE FROM project_modules WHERE "projectId"='pm_test'`);
  });
});
