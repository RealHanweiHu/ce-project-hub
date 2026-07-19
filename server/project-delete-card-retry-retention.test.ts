import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  actionItems,
  dingtalkInteractiveCards,
  projects,
} from "../drizzle/schema";
import { deleteProject, getDb, markDingtalkInteractiveCardStatus } from "./db";
import {
  collectProjectPushCleanupPlan,
  purgeProjectPushArtifacts,
} from "./project-delete-push-cleanup";

const PROJECT = `card-retry-${Date.now().toString().slice(-8)}`;
const TRACK = `card-retry-${PROJECT}`;
const USER = 986721;
let actionItemId = 0;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "删除卡片重试",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
  });
  const [item] = await db
    .insert(actionItems)
    .values({
      kind: "critical_issue",
      projectId: PROJECT,
      entityType: "issue",
      entityId: "42",
      dedupeKey: `${PROJECT}:card-retry`,
      recipientUserId: USER,
      title: "待处理",
      actionUrl: "/",
    })
    .returning({ id: actionItems.id });
  actionItemId = item.id;
  await db.insert(dingtalkInteractiveCards).values({
    outTrackId: TRACK,
    actionItemId,
    recipientUserId: USER,
    projectId: PROJECT,
    eventKey: "critical_issue",
    entityType: "issue",
    entityId: "42",
    title: "待处理",
    status: "failed",
    lastError: "temporary outage",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(dingtalkInteractiveCards)
    .where(eq(dingtalkInteractiveCards.outTrackId, TRACK));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("deleted-project interactive-card retry retention", () => {
  it("keeps failed tracking after project deletion and purges it only once handled", async () => {
    const plan = await collectProjectPushCleanupPlan(PROJECT);
    await deleteProject(PROJECT);
    await purgeProjectPushArtifacts(PROJECT, plan);

    const db = await getDb();
    if (!db) throw new Error("no db");
    let rows = await db
      .select()
      .from(dingtalkInteractiveCards)
      .where(eq(dingtalkInteractiveCards.outTrackId, TRACK));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");

    await markDingtalkInteractiveCardStatus({
      outTrackId: TRACK,
      status: "handled",
      handledAt: new Date(),
    });
    await purgeProjectPushArtifacts(PROJECT, plan);
    rows = await db
      .select()
      .from(dingtalkInteractiveCards)
      .where(eq(dingtalkInteractiveCards.outTrackId, TRACK));
    expect(rows).toHaveLength(0);
  });
});
