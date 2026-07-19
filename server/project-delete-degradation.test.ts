import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { projects, activityLogs } from "../drizzle/schema";

/**
 * 已知钉钉群是项目删除的必须清理项：远端解散失败时，
 * 项目保持 paused 且保留 chatId，以便后续重试。
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
  it("解散钉钉群失败 → 项目保持 paused 并保留群句柄", async () => {
    const caller = projectsRouter.createCaller(ctx(ADMIN));
    await expect(caller.delete({ id: PROJ })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const db = await getDb();
    const [row] = await db!.select().from(projects).where(eq(projects.id, PROJ));
    expect(row).toMatchObject({
      lifecycle: "paused",
      dingtalkChatId: "chat-123",
      dingtalkGroupOperationStatus: "disband_failed",
      dingtalkGroupLastError: "钉钉不可用",
    });
  });
});
