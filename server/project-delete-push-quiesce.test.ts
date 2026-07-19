import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { projects } from "../drizzle/schema";

const observed = vi.hoisted(() => ({
  lifecycle: null as string | null,
  groupLifecycle: null as string | null,
  groupChatId: null as string | null,
}));

vi.mock("./project-delete-calendar-cleanup", () => ({
  cancelFutureProjectDingtalkEvents: vi.fn(async () => {
    const [{ getDb }, schema, orm] = await Promise.all([
      import("./db"),
      import("../drizzle/schema"),
      import("drizzle-orm"),
    ]);
    const db = await getDb();
    if (!db) throw new Error("no db");
    const [row] = await db.select({ lifecycle: schema.projects.lifecycle })
      .from(schema.projects)
      .where(orm.eq(schema.projects.id, PROJECT));
    observed.lifecycle = row?.lifecycle ?? null;
    return 0;
  }),
}));

vi.mock("./_core/dingtalkGroup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/dingtalkGroup")>();
  return {
    ...actual,
    disbandGroupChat: vi.fn(async () => {
      const [{ getDb }, schema, orm] = await Promise.all([
        import("./db"),
        import("../drizzle/schema"),
        import("drizzle-orm"),
      ]);
      const db = await getDb();
      if (!db) throw new Error("no db");
      const [row] = await db.select({
        lifecycle: schema.projects.lifecycle,
        dingtalkChatId: schema.projects.dingtalkChatId,
      }).from(schema.projects).where(orm.eq(schema.projects.id, PROJECT));
      observed.groupLifecycle = row?.lifecycle ?? null;
      observed.groupChatId = row?.dingtalkChatId ?? null;
      return { ok: true as const };
    }),
  };
});

import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const PROJECT = `del-quiet-${Date.now().toString().slice(-8)}`;
const USER = 986201;
const ctx = {
  user: {
    id: USER,
    role: "admin",
    name: "delete admin",
    email: null,
    username: null,
    passwordHash: null,
    canCreateProject: true,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
  },
} as never;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "删除前停止推送",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "active",
    dingtalkChatId: "chat-delete-quiesce",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("projects.delete push quiesce", () => {
  it("marks the project non-active before waiting on external DingTalk cleanup", async () => {
    await projectsRouter.createCaller(ctx).delete({ id: PROJECT });
    expect(observed.lifecycle).toBe("paused");
    expect(observed.groupLifecycle).toBe("paused");
    expect(observed.groupChatId).toBe("chat-delete-quiesce");
  });
});
