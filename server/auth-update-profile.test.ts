import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const OPENID = `acct-test-${Date.now()}`;
let userId = 0;
const ctx = (openId: string | null) => ({
  user: openId ? { id: userId, openId, role: "user", name: "旧名", email: null, username: openId,
    passwordHash: null, canCreateProject: false, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null } : null,
}) as any;

beforeAll(async () => {
  const db = await getDb(); if (!db) throw new Error("no db");
  const [row] = await db.insert(users).values({
    openId: OPENID, username: OPENID, name: "旧名", mobile: null, role: "user", loginMethod: "password",
  }).returning();
  userId = row.id;
});
afterAll(async () => {
  const db = await getDb(); if (!db) return;
  await db.delete(users).where(eq(users.id, userId));
});

describe("auth.updateProfile", () => {
  it("改自己 name + mobile 落库", async () => {
    const caller = appRouter.createCaller(ctx(OPENID));
    const r = await caller.auth.updateProfile({ name: "新名字", mobile: "13800000000" });
    expect(r.success).toBe(true);
    const db = await getDb();
    const [row] = await db!.select().from(users).where(eq(users.id, userId));
    expect(row.name).toBe("新名字");
    expect(row.mobile).toBe("13800000000");
  });
  it("空 name 被拒", async () => {
    const caller = appRouter.createCaller(ctx(OPENID));
    await expect(caller.auth.updateProfile({ name: "  ", mobile: null })).rejects.toThrow();
  });
  it("未登录 → 拒绝", async () => {
    const caller = appRouter.createCaller(ctx(null));
    await expect(caller.auth.updateProfile({ name: "x", mobile: null })).rejects.toThrow();
  });
});
