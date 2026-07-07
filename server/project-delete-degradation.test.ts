import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { projects, activityLogs } from "../drizzle/schema";

/**
 * 钉钉降级：删除项目时解散钉钉群失败，不应把删除挡住——
 * 群解散是 best-effort，失败记录在返回值里让前端提示手动清理。
 */

vi.mock("./_core/dingtalkGroup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/dingtalkGroup")>();
  return {
    ...actual,
    disbandGroupChat: vi.fn(async () => ({ ok: false as const, error: "钉钉不可用" })),
  };
});

import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const PROJ = `del-degrade-${Date.now()}`;
const ADMIN = 986001;

const ctx = (id: number, role = "admin") => ({
  user: { id, role, name: "x", email: null, username: null, passwordHash: null,
    canCreateProject: true, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null },
}) as never;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJ, name: "删檔降级", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "concept", createdBy: ADMIN,
    dingtalkChatId: "chat-123",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("projects.delete dingtalk degradation", () => {
  it("解散钉钉群失败 → 项目仍被删除，返回 dingtalkGroupDeleted=false", async () => {
    const caller = projectsRouter.createCaller(ctx(ADMIN));
    const res = await caller.delete({ id: PROJ });
    expect(res.success).toBe(true);
    expect(res.dingtalkGroupDeleted).toBe(false);

    const db = await getDb();
    const [row] = await db!.select().from(projects).where(eq(projects.id, PROJ));
    expect(row).toBeUndefined(); // 项目确实删掉了
  });
});
