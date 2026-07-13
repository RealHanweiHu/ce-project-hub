import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { actionItems } from "../drizzle/schema";
import {
  getDb,
  listOpenActionItemsForUser,
  listSnoozedActionItemsForUser,
  snoozeActionItem,
  upsertActionItem,
} from "./db";
import { appRouter } from "./routers";
import { actionItemSnoozeUntil } from "./action-card-route";
import { actionDedupeKey, buildActionItemButtons } from "./action-item-notify";
import { verifyActionCardToken } from "./action-card-tokens";
import { ENV } from "./_core/env";

const PROJECT = `snooze-${Date.now()}`;
const USER = 9_970_001;
const future = new Date(Date.now() + 60 * 60 * 1000);
const past = new Date(Date.now() - 60 * 60 * 1000);

function ctx() {
  return {
    user: {
      id: USER,
      openId: `snooze-${USER}`,
      username: "snooze-user",
      name: "Snooze User",
      email: null,
      role: "member",
      passwordHash: null,
      canCreateProject: false,
      mobile: null,
      dingtalkUserId: null,
      dingtalkCorpUserId: null,
    },
    req: {},
    res: {},
  } as any;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.delete(actionItems).where(eq(actionItems.projectId, PROJECT));
  await db.insert(actionItems).values([
    {
      kind: "task_approval",
      projectId: PROJECT,
      entityType: "task",
      entityId: `${PROJECT}:design:d1`,
      dedupeKey: `${PROJECT}:future`,
      recipientUserId: USER,
      title: "未来恢复",
      actionUrl: "/?view=projects",
      status: "snoozed",
      priority: "normal",
      snoozedUntil: future,
      metadata: { phaseId: "design", taskId: "d1" },
    },
    {
      kind: "task_approval",
      projectId: PROJECT,
      entityType: "task",
      entityId: `${PROJECT}:design:d2`,
      dedupeKey: `${PROJECT}:past`,
      recipientUserId: USER,
      title: "到点恢复",
      actionUrl: "/?view=projects",
      status: "snoozed",
      priority: "normal",
      snoozedUntil: past,
      metadata: { phaseId: "design", taskId: "d2" },
    },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(actionItems).where(eq(actionItems.projectId, PROJECT));
});

describe("action item snooze visibility", () => {
  it("repeated task_ready upsert preserves an active two-day snooze", async () => {
    const dedupeKey = `${PROJECT}:task-ready-preserve-snooze`;
    const snoozedUntil = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const first = await upsertActionItem({
      kind: "task_ready",
      projectId: PROJECT,
      entityType: "task",
      entityId: `${PROJECT}:planning:np1`,
      dedupeKey,
      recipientUserId: USER,
      title: "可以开始了：产品需求与规格书",
      actionUrl: "/?view=projects",
      metadata: { phaseId: "planning", taskId: "np1" },
    });
    expect(first.actionItem).toBeTruthy();
    await expect(snoozeActionItem({
      id: first.actionItem!.id,
      recipientUserId: USER,
      snoozedUntil,
    })).resolves.toBe(true);

    const repeated = await upsertActionItem({
      kind: "task_ready",
      projectId: PROJECT,
      entityType: "task",
      entityId: `${PROJECT}:planning:np1`,
      dedupeKey,
      recipientUserId: USER,
      title: "可以开始了：产品需求与规格书",
      actionUrl: "/?view=projects",
      metadata: { phaseId: "planning", taskId: "np1", predecessorTaskId: "nc3" },
    });
    expect(repeated.shouldNotify).toBe(false);

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [stored] = await db.select().from(actionItems).where(eq(actionItems.dedupeKey, dedupeKey));
    expect(stored.status).toBe("snoozed");
    expect(stored.snoozedUntil?.getTime()).toBe(snoozedUntil.getTime());
    expect((await listOpenActionItemsForUser(USER)).some((item) => item.id === stored.id)).toBe(false);
    expect((await listSnoozedActionItemsForUser(USER)).some((item) => item.id === stored.id)).toBe(true);
  });

  it("in_2_days resolves to 08:00 two Shanghai calendar days later", () => {
    expect(actionItemSnoozeUntil("in_2_days", new Date("2026-07-12T23:30:00.000Z")).toISOString())
      .toBe("2026-07-15T00:00:00.000Z");
    // The host's DST boundary must not affect the Shanghai calendar result.
    expect(actionItemSnoozeUntil("in_2_days", new Date("2026-03-08T06:30:00.000Z")).toISOString())
      .toBe("2026-03-10T00:00:00.000Z");
  });

  it("task action items use the two-day snooze button and token", async () => {
    const originalSecret = ENV.cookieSecret;
    ENV.cookieSecret = "test-secret-for-action-card";
    try {
      const buttons = await buildActionItemButtons({
        kind: "task_ready",
        projectId: PROJECT,
        entityType: "task",
        entityId: "np1",
        recipientUserId: USER,
        title: "可以开始了：产品需求与规格书",
        dedupeKey: `${PROJECT}:task-ready`,
        metadata: { phaseId: "planning", taskId: "np1" },
      } as never, 123);
      const snooze = buttons.find((button) => button.title === "⏰延两天");
      expect(snooze).toBeDefined();
      const url = new URL(snooze!.actionUrl, "https://example.test");
      const token = url.searchParams.get("token");
      expect(token).toBeTruthy();
      await expect(verifyActionCardToken(token!)).resolves.toMatchObject({
        kind: "action_item_snooze",
        actionItemId: 123,
        until: "in_2_days",
      });
    } finally {
      ENV.cookieSecret = originalSecret;
    }
  });

  it("task_ready 轻证据卡片同时提供开始、完成和延两天", async () => {
    const originalSecret = ENV.cookieSecret;
    ENV.cookieSecret = "test-secret-for-action-card";
    try {
      const entityId = `${PROJECT}:planning:np2`;
      const dedupeKey = actionDedupeKey({
        kind: "task_ready",
        projectId: PROJECT,
        entityId,
        recipientUserId: USER,
      });
      expect(dedupeKey).toBe(`task_ready:${PROJECT}:${entityId}:${USER}:owner`);
      const buttons = await buildActionItemButtons({
        kind: "task_ready",
        projectId: PROJECT,
        entityType: "task",
        entityId,
        recipientUserId: USER,
        title: "可以开始了：初版 BOM",
        dedupeKey,
        metadata: { phaseId: "planning", taskId: "np2", evidenceLevel: "light" },
      }, 124);
      expect(buttons.map((button) => button.title)).toEqual(["▶开始", "✅完成", "⏰延两天"]);

      const startUrl = new URL(buttons[0].actionUrl, "https://example.test");
      await expect(verifyActionCardToken(startUrl.searchParams.get("token")!)).resolves.toMatchObject({
        kind: "task_start",
        actionItemId: 124,
        projectId: PROJECT,
        phaseId: "planning",
        taskId: "np2",
      });
      expect(buttons[1].actionUrl).toContain("/actions/task-complete");
      expect(buttons[1].actionUrl).toContain("taskId=np2");
      expect(buttons[1].actionUrl).toContain("actionItemId=124");
    } finally {
      ENV.cookieSecret = originalSecret;
    }
  });

  it("task_ready 重证据卡片把完成替换为去上传", async () => {
    const originalSecret = ENV.cookieSecret;
    ENV.cookieSecret = "test-secret-for-action-card";
    try {
      const entityId = `${PROJECT}:planning:np1`;
      const dedupeKey = actionDedupeKey({
        kind: "task_ready",
        projectId: PROJECT,
        entityId,
        recipientUserId: USER,
      });
      expect(dedupeKey).toBe(`task_ready:${PROJECT}:${entityId}:${USER}:owner`);
      const buttons = await buildActionItemButtons({
        kind: "task_ready",
        projectId: PROJECT,
        entityType: "task",
        entityId,
        recipientUserId: USER,
        title: "可以开始了：产品需求与规格书",
        dedupeKey,
        metadata: { phaseId: "planning", taskId: "np1", evidenceLevel: "heavy" },
      }, 125);
      expect(buttons.map((button) => button.title)).toEqual(["▶开始", "📎去上传", "⏰延两天"]);
      expect(buttons[1].actionUrl).toContain("view=projects");
      expect(buttons[1].actionUrl).toContain("taskId=np1");
      expect(buttons[1].actionUrl).toContain("actionItemId=125");
      expect(buttons[1].actionUrl).not.toContain("/actions/task-complete");
    } finally {
      ENV.cookieSecret = originalSecret;
    }
  });

  it("keeps future snoozed items visible separately and restores expired snoozes to open work", async () => {
    const snoozed = await listSnoozedActionItemsForUser(USER);
    expect(snoozed.map((item) => item.title)).toContain("未来恢复");
    expect(snoozed.map((item) => item.title)).not.toContain("到点恢复");

    const open = await listOpenActionItemsForUser(USER);
    expect(open.map((item) => item.title)).toContain("到点恢复");

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [restored] = await db
      .select()
      .from(actionItems)
      .where(eq(actionItems.dedupeKey, `${PROJECT}:past`));
    expect(restored.status).toBe("sent");
    expect(restored.snoozedUntil).toBeNull();
  });

  it("returns snoozed action items from workbench.mine", async () => {
    const caller = appRouter.createCaller(ctx());
    const mine = await caller.workbench.mine();
    expect(mine.snoozedActionItems.some((item) => item.title === "未来恢复")).toBe(true);
    expect(mine.actionItems.some((item) => item.title === "未来恢复")).toBe(false);
  });
});
