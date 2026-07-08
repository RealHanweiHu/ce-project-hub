import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { actionItems } from "../drizzle/schema";
import {
  getDb,
  listOpenActionItemsForUser,
  listSnoozedActionItemsForUser,
} from "./db";
import { appRouter } from "./routers";

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
