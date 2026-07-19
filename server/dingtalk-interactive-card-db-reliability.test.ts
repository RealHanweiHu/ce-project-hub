import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dingtalkInteractiveCards, projects } from "../drizzle/schema";
import {
  getDb,
  listDeletedProjectDingtalkInteractiveCards,
  markDingtalkInteractiveCardStatus,
  upsertDingtalkInteractiveCard,
} from "./db";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PROJECT = `card-db-${SUFFIX}`.slice(0, 32);
const TRACK_PREFIX = `card-db-${SUFFIX}`;
const USER = 9_867_220;

async function insertCard(
  suffix: string,
  status: string,
  updatedAt: Date
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const outTrackId = `${TRACK_PREFIX}-${suffix}`;
  await db.insert(dingtalkInteractiveCards).values({
    outTrackId,
    recipientUserId: USER,
    projectId: PROJECT,
    eventKey: "task_ready",
    entityType: "task",
    entityId: suffix,
    title: suffix,
    status,
    createdAt: updatedAt,
    updatedAt,
  });
  return outTrackId;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "互动卡片可靠性",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(dingtalkInteractiveCards)
    .where(eq(dingtalkInteractiveCards.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("DingTalk interactive-card retry database helpers", () => {
  it("does not let a stale failure overwrite an already handled card", async () => {
    const track = await insertCard(
      "cas",
      "sent",
      new Date("2026-01-01T00:00:00Z")
    );

    await expect(
      markDingtalkInteractiveCardStatus({
        outTrackId: track,
        status: "handled",
        handledAt: new Date(),
        expectedStatuses: ["sent"],
      })
    ).resolves.toBe(true);
    await expect(
      markDingtalkInteractiveCardStatus({
        outTrackId: track,
        status: "update_failed",
        lastError: "late failure",
        expectedStatuses: ["sent"],
      })
    ).resolves.toBe(false);

    const db = await getDb();
    const [row] = await db!
      .select()
      .from(dingtalkInteractiveCards)
      .where(eq(dingtalkInteractiveCards.outTrackId, track));
    expect(row.status).toBe("handled");
    expect(row.lastError).toBeNull();
  });

  it("does not reopen a handled card when a duplicate delivery prepares a creating intent", async () => {
    const track = await insertCard(
      "handled-intent",
      "handled",
      new Date("2026-01-01T12:00:00Z")
    );

    await expect(
      upsertDingtalkInteractiveCard({
        outTrackId: track,
        recipientUserId: USER,
        projectId: PROJECT,
        eventKey: "task_ready",
        entityType: "task",
        entityId: "handled-intent",
        title: "不应重新打开",
        status: "creating",
      })
    ).resolves.toBeUndefined();

    const db = await getDb();
    const [row] = await db!
      .select()
      .from(dingtalkInteractiveCards)
      .where(eq(dingtalkInteractiveCards.outTrackId, track));
    expect(row.status).toBe("handled");
  });

  it("returns only possibly delivered orphan cards, oldest attempted first", async () => {
    const oldest = await insertCard(
      "oldest-sent",
      "sent",
      new Date("2026-01-02T00:00:00Z")
    );
    const next = await insertCard(
      "next-update-failed",
      "update_failed",
      new Date("2026-01-03T00:00:00Z")
    );
    await insertCard(
      "known-delivery-failed",
      "delivery_failed",
      new Date("2026-01-01T00:00:00Z")
    );
    await insertCard(
      "already-handled",
      "handled",
      new Date("2025-12-31T00:00:00Z")
    );

    const db = await getDb();
    await db!.delete(projects).where(eq(projects.id, PROJECT));

    const rows = await listDeletedProjectDingtalkInteractiveCards(2);
    expect(rows.map(row => row.outTrackId)).toEqual([oldest, next]);
  });
});
