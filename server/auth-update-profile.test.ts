import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const OPENID = `acct-test-${Date.now()}`;
let userId = 0;
const ctx = (openId: string | null) => ({
  user: openId ? { id: userId, openId, role: "member", name: "旧名", email: null, username: openId,
    passwordHash: null, canCreateProject: false, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null } : null,
}) as any;

beforeAll(async () => {
  const db = await getDb(); if (!db) throw new Error("no db");
  const [row] = await db.insert(users).values({
    openId: OPENID, username: OPENID, name: "旧名", mobile: null, role: "member", loginMethod: "password",
  }).returning();
  userId = row.id;
});
afterAll(async () => {
  const db = await getDb(); if (!db) return;
  await db.delete(users).where(eq(users.id, userId));
});

describe("auth.updateProfile", () => {
  it("改自己 name + mobile 落库", async () => {
    const db = await getDb();
    await db!.update(users)
      .set({ dingtalkUserId: "old-union", dingtalkCorpUserId: "old-corp" })
      .where(eq(users.id, userId));
    const caller = appRouter.createCaller(ctx(OPENID));
    const r = await caller.auth.updateProfile({ name: "新名字", mobile: "13800000000" });
    expect(r.success).toBe(true);
    const [row] = await db!.select().from(users).where(eq(users.id, userId));
    expect(row.name).toBe("新名字");
    expect(row.mobile).toBe("13800000000");
    expect(row.dingtalkUserId).toBeNull();
    expect(row.dingtalkCorpUserId).toBeNull();
  });
  it("仅改名字且手机号未变时保留钉钉缓存", async () => {
    const db = await getDb();
    await db!.update(users)
      .set({ name: "旧名", mobile: "13900000000", dingtalkUserId: "keep-union", dingtalkCorpUserId: "keep-corp" })
      .where(eq(users.id, userId));
    const caller = appRouter.createCaller(ctx(OPENID));
    await caller.auth.updateProfile({ name: "只改名字", mobile: "13900000000" });
    const [row] = await db!.select().from(users).where(eq(users.id, userId));
    expect(row.name).toBe("只改名字");
    expect(row.mobile).toBe("13900000000");
    expect(row.dingtalkUserId).toBe("keep-union");
    expect(row.dingtalkCorpUserId).toBe("keep-corp");
  });
  it("空 name 被拒", async () => {
    const caller = appRouter.createCaller(ctx(OPENID));
    await expect(caller.auth.updateProfile({ name: "  ", mobile: null })).rejects.toThrow();
  });
  it("未登录 → 拒绝", async () => {
    const caller = appRouter.createCaller(ctx(null));
    await expect(caller.auth.updateProfile({ name: "x", mobile: null })).rejects.toThrow();
  });

  it("读写自己的通知偏好", async () => {
    const caller = appRouter.createCaller(ctx(OPENID));
    await expect(caller.auth.notificationPrefs()).resolves.toEqual(expect.any(Object));

    const prefs = await caller.auth.updateNotificationPrefs({
      dingtalk: {
        enabled: false,
        quietHours: { startHour: 21, endHour: 9, timezone: "Asia/Shanghai" },
        maxImmediatePerDay: 6,
      },
    });
    expect(prefs.dingtalk?.enabled).toBe(false);
    expect(prefs.dingtalk?.quietHours?.startHour).toBe(21);
    expect(prefs.dingtalk?.maxImmediatePerDay).toBe(6);

    await expect(caller.auth.notificationPrefs()).resolves.toMatchObject({
      dingtalk: {
        enabled: false,
        quietHours: { startHour: 21, endHour: 9, timezone: "Asia/Shanghai" },
        maxImmediatePerDay: 6,
      },
    });
  });
});
