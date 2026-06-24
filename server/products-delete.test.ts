import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products, productDefinitions, projects } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const ADMIN = 779501, OTHER = 779502;
const PROD = `del-prod-${Date.now()}`;
const PROD2 = `del-prod2-${Date.now()}`;
const PROJ = `del-prod-proj-${Date.now()}`;
const ctx = (id: number, role = "user") => ({ user: { id, role, name: "x", email: null, username: null, passwordHash: null, canCreateProject: true, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null } }) as any;

beforeAll(async () => {
  const db = await getDb(); if (!db) throw new Error("no db");
  // PROD: referenced by a project (delete must be blocked)
  await db.insert(products).values({ id: PROD, name: "被引用产品", createdBy: ADMIN });
  await db.insert(projects).values({ id: PROJ, name: "引用项目", projectNumber: PROJ, category: "npd", risk: "low", currentPhase: "concept", productId: PROD, createdBy: ADMIN });
  // PROD2: unreferenced, has a definition (cascade must clean it)
  await db.insert(products).values({ id: PROD2, name: "可删产品", createdBy: ADMIN });
  await db.insert(productDefinitions).values({ productId: PROD2, status: "draft", createdBy: ADMIN } as any);
});
afterAll(async () => {
  const db = await getDb(); if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJ));
  await db.delete(productDefinitions).where(eq(productDefinitions.productId, PROD));
  await db.delete(productDefinitions).where(eq(productDefinitions.productId, PROD2));
  await db.delete(products).where(eq(products.id, PROD));
  await db.delete(products).where(eq(products.id, PROD2));
});

describe("products.delete", () => {
  it("被项目引用 → 拒绝", async () => {
    const caller = appRouter.createCaller(ctx(ADMIN, "admin"));
    await expect(caller.products.delete({ id: PROD })).rejects.toThrow(/引用|referenced|被.*项目/);
  });
  it("未引用 → 硬删 + 连带清理定义", async () => {
    const caller = appRouter.createCaller(ctx(ADMIN, "admin"));
    const r = await caller.products.delete({ id: PROD2 });
    expect(r.success).toBe(true);
    const db = await getDb();
    const [p] = await db!.select().from(products).where(eq(products.id, PROD2));
    expect(p).toBeUndefined();
    const defs = await db!.select().from(productDefinitions).where(eq(productDefinitions.productId, PROD2));
    expect(defs.length).toBe(0);
  });
  it("非 admin 非创建者 → FORBIDDEN", async () => {
    // re-create a throwaway product owned by ADMIN
    const db = await getDb(); const TMP = `del-tmp-${Date.now()}`;
    await db!.insert(products).values({ id: TMP, name: "tmp", createdBy: ADMIN });
    const caller = appRouter.createCaller(ctx(OTHER, "user"));
    await expect(caller.products.delete({ id: TMP })).rejects.toThrow(/FORBIDDEN|权限|forbidden/i);
    await db!.delete(products).where(eq(products.id, TMP));
  });
});
