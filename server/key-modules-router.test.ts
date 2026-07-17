import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { keyModules, users } from "../drizzle/schema";
import { getDb } from "./db";
import { keyModulesRouter } from "./routers/keyModules";

const SUFFIX = Date.now().toString(36);
const MODULE_ID = `kmr-${SUFFIX}`;
const OPEN_IDS = [`kmr-engineer-${SUFFIX}`, `kmr-manager-${SUFFIX}`];
let engineerId = 0;
let managerId = 0;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(keyModules).where(eq(keyModules.id, MODULE_ID));
  await db.delete(users).where(inArray(users.openId, OPEN_IDS));
}

describe.sequential("key modules router", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await cleanup();
    const created = await db.insert(users).values([
      { openId: OPEN_IDS[0], username: OPEN_IDS[0], name: "Engineer" },
      { openId: OPEN_IDS[1], username: OPEN_IDS[1], name: "Manager", canCreateProject: true },
    ]).returning({ id: users.id, openId: users.openId });
    engineerId = created.find(row => row.openId === OPEN_IDS[0])!.id;
    managerId = created.find(row => row.openId === OPEN_IDS[1])!.id;
  });
  afterAll(cleanup);

  it("blocks external accounts from the internal module library", async () => {
    const caller = keyModulesRouter.createCaller({ user: { id: 999, role: "external" } } as any);
    await expect(caller.list({ page: 1, pageSize: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an engineer create and technically confirm a module", async () => {
    const caller = keyModulesRouter.createCaller({
      user: { id: engineerId, role: "member", name: "Engineer", canCreateProject: false },
    } as any);
    const created = await caller.create({
      id: MODULE_ID,
      moduleNumber: `ELE-${SUFFIX}`,
      moduleType: "electronics_hardware",
      name: "测试 PCBA",
      category: "充气泵",
      items: [{ partNumber: "PCB-01", name: "主板", quantity: 1 }],
    });
    expect(created.module.status).toBe("draft");
    expect((await caller.confirmTechnical({ id: MODULE_ID })).module.status).toBe("technical_confirmed");
  });

  it("requires a product/project manager to approve project use", async () => {
    const engineer = keyModulesRouter.createCaller({
      user: { id: engineerId, role: "member", name: "Engineer", canCreateProject: false },
    } as any);
    await expect(engineer.approve({ id: MODULE_ID })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const manager = keyModulesRouter.createCaller({
      user: { id: managerId, role: "member", name: "Manager", canCreateProject: true },
    } as any);
    expect((await manager.approve({ id: MODULE_ID })).module.status).toBe("approved");
  });
});
