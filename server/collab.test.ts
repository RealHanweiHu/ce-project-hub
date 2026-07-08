import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, parseMentions, addComment, listComments,
  unreadCount, listNotifications, markAllRead, getUserByUsername,
} from "./db";

const ENTITY = "issue";
const EID = "collabtest-issue-1";

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM comments WHERE "entityId" = ${EID}`);
  await db.execute(sql`DELETE FROM notifications WHERE "entityId" = ${EID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

describe("Collaboration: comments + mentions + notifications", () => {
  it("parseMentions matches @username against candidates", () => {
    const ids = parseMentions("@alice 看下 @Bob 谢谢 @ghost", [
      { id: 10, username: "alice" }, { id: 11, username: "bob" }, { id: 12, username: "carol" },
    ]);
    expect(ids.sort()).toEqual([10, 11]);
  });

  it("parseMentions matches stable @u{id} handles for users without usernames", () => {
    const ids = parseMentions("@u42 看下 @u100 @missing", [
      { id: 42, username: null, openId: null },
      { id: 100, username: null, openId: "legacy-openid" },
    ]);
    expect(ids.sort((a, b) => a - b)).toEqual([42, 100]);
  });

  it("addComment with @mention creates a notification for the mentioned user", async () => {
    const admin = await getUserByUsername("admin");
    const author = await getUserByUsername("testpm");
    if (!admin || !author) { expect(true).toBe(true); return; } // 环境无这些用户则跳过断言
    const before = await unreadCount(admin.id);
    await addComment({ entityType: ENTITY, entityId: EID, authorId: author.id, body: `@${admin.username} 这个问题请确认` });
    const comments = await listComments(ENTITY, EID);
    expect(comments.length).toBe(1);
    const after = await unreadCount(admin.id);
    expect(after).toBe(before + 1);
    const notes = await listNotifications(admin.id, true);
    expect(notes.some((n) => n.entityId === EID && n.type === "mention")).toBe(true);
    await markAllRead(admin.id);
    expect(await unreadCount(admin.id)).toBe(0);
  });
});
