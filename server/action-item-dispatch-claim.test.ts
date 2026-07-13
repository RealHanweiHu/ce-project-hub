import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { actionItems } from "../drizzle/schema";
import {
  getDb,
  markActionItemDispatchFailed,
  markActionItemSent,
  upsertActionItem,
} from "./db";

const PROJECT = "action-claim-test";
const DEDUPE = `${PROJECT}:critical:1`;

function input() {
  return {
    kind: "critical_issue" as const,
    projectId: PROJECT,
    entityType: "issue",
    entityId: `${PROJECT}:1`,
    dedupeKey: DEDUPE,
    recipientUserId: 991001,
    title: "P0 待处理",
    actionUrl: "http://localhost/action",
  };
}

afterEach(async () => {
  const db = await getDb();
  await db?.delete(actionItems).where(eq(actionItems.dedupeKey, DEDUPE));
});

describe("action item dispatch claim", () => {
  it("allows retry after first dispatch failure, then suppresses after success", async () => {
    const first = await upsertActionItem(input());
    expect(first.shouldNotify).toBe(true);
    expect(first.actionItem).toBeTruthy();

    await markActionItemDispatchFailed(first.actionItem!.id, "site insert failed");
    const retry = await upsertActionItem(input());
    expect(retry.shouldNotify).toBe(true);
    expect(retry.actionItem?.metadata).toMatchObject({
      automationDispatch: { status: "sending" },
    });

    await markActionItemSent(retry.actionItem!.id);
    const afterSuccess = await upsertActionItem(input());
    expect(afterSuccess.shouldNotify).toBe(false);
  });

  it("grants only one sender under concurrent upserts", async () => {
    const claims = await Promise.all([
      upsertActionItem(input()),
      upsertActionItem(input()),
    ]);

    expect(claims.filter((claim) => claim.shouldNotify)).toHaveLength(1);
    expect(new Set(claims.map((claim) => claim.actionItem?.id)).size).toBe(1);
  });
});
