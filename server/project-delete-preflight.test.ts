import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { productRevisions, products, projects } from "../drizzle/schema";

const externalCalls = vi.hoisted(() => ({ disband: 0 }));
vi.mock("./_core/dingtalkGroup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/dingtalkGroup")>();
  return {
    ...actual,
    disbandGroupChat: vi.fn(async () => {
      externalCalls.disband += 1;
      return { ok: true as const };
    }),
  };
});

import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const SUFFIX = Date.now().toString().slice(-8);
const PROJECT = `del-trace-${SUFFIX}`;
const PRODUCT = `del-prod-${SUFFIX}`;
const USER = 986501;
let revisionId = 0;
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
  await db.insert(products).values({
    id: PRODUCT,
    productNumber: PRODUCT,
    name: "删除预检产品",
    type: "finished",
    category: "test",
    lifecycleState: "development",
    createdBy: USER,
  });
  await db.insert(projects).values({
    id: PROJECT,
    name: "已有修订追溯的项目",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "active",
    dingtalkChatId: "must-not-disband",
  });
  const [revision] = await db.insert(productRevisions).values({
    productId: PRODUCT,
    revisionLabel: "Rev A",
    createdByProjectId: PROJECT,
  }).returning({ id: productRevisions.id });
  revisionId = revision.id;
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(productRevisions).where(eq(productRevisions.id, revisionId));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(products).where(eq(products.id, PRODUCT));
});

describe("projects.delete hard-delete preflight", () => {
  it("rejects traceable projects before mutating lifecycle or DingTalk resources", async () => {
    await expect(projectsRouter.createCaller(ctx).delete({ id: PROJECT }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const [project] = await db.select().from(projects).where(eq(projects.id, PROJECT));
    expect(project).toMatchObject({ lifecycle: "active", dingtalkChatId: "must-not-disband" });
    expect(externalCalls.disband).toBe(0);
  });
});
