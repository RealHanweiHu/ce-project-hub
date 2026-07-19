import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { actionItems, projects } from "../drizzle/schema";
import { closeActionItemsWithCards } from "./action-item-notify";
import { getDb } from "./db";

const PROJECT = `close-card-${Date.now()}`;
let itemId = 0;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(projects).values({
    id: PROJECT,
    name: "行动项与卡片同步关闭",
    projectNumber: PROJECT,
    category: "npd",
    currentPhase: "concept",
    risk: "low",
    createdBy: 7_701_001,
  });
  const [item] = await db.insert(actionItems).values({
    kind: "task_ready",
    projectId: PROJECT,
    entityType: "task",
    entityId: `${PROJECT}:concept:c1`,
    dedupeKey: `${PROJECT}:task-ready`,
    recipientUserId: 7_701_001,
    title: "可以开始了",
    actionUrl: "/",
  }).returning({ id: actionItems.id });
  itemId = item.id;
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(actionItems).where(eq(actionItems.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("行动项与钉钉互动卡同步闭环", () => {
  it("按业务实体关闭 DB 行，并把每个实际 actionItemId 交给卡片更新器", async () => {
    const markHandled = vi.fn(async () => true);
    const result = {
      title: "任务已完成",
      message: "卡片已闭环",
      actionPath: `/?view=projects&projectId=${PROJECT}`,
    };
    const ids = await closeActionItemsWithCards({
      kind: "task_ready",
      entityType: "task",
      entityId: `${PROJECT}:concept:c1`,
    }, result, { markHandled });

    expect(ids).toEqual([itemId]);
    expect(markHandled).toHaveBeenCalledWith(itemId, result);
    const db = await getDb();
    const [item] = await db!.select().from(actionItems).where(eq(actionItems.id, itemId));
    expect(item).toMatchObject({ status: "closed" });
    expect(item.handledAt).toBeInstanceOf(Date);
  });
});
