import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { comments, projectIssues, projectMembers, projects } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const PROJECT = `comments-acl-${Date.now()}`;
const OWNER = 981001;
const QA_MEMBER = 981002;
const VIEWER_MEMBER = 981003;
const OUTSIDER = 981004;

let issueId: number;

function makeCtx(userId: number, role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-user-${userId}`,
      username: null,
      passwordHash: null,
      name: `TestUser${userId}`,
      email: null,
      loginMethod: null,
      role,
      canCreateProject: false,
      mobile: null,
      dingtalkUserId: null,
      dingtalkCorpUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");

  await db.insert(projects).values({
    id: PROJECT,
    name: "评论鉴权测试",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "design",
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: QA_MEMBER, role: "qa", invitedBy: OWNER },
    { projectId: PROJECT, userId: VIEWER_MEMBER, role: "viewer", invitedBy: OWNER },
  ]);
  const [issue] = await db.insert(projectIssues).values({
    projectId: PROJECT,
    phaseId: "design",
    title: "评论鉴权测试问题",
    severity: "P2",
    status: "open",
    category: "other",
  }).returning();
  issueId = issue.id;
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(comments).where(eq(comments.projectId, PROJECT));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("comments access control", () => {
  it("非项目成员不能读取 issue 评论", async () => {
    const caller = appRouter.createCaller(makeCtx(OUTSIDER));
    await expect(
      caller.comments.list({ entityType: "issue", entityId: String(issueId) })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("非项目成员不能对 issue 发评论", async () => {
    const caller = appRouter.createCaller(makeCtx(OUTSIDER));
    await expect(
      caller.comments.add({ entityType: "issue", entityId: String(issueId), body: "闯入者评论" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("非项目成员不能对 task 实体发评论", async () => {
    const caller = appRouter.createCaller(makeCtx(OUTSIDER));
    await expect(
      caller.comments.add({ entityType: "task", entityId: `${PROJECT}:d1`, body: "闯入者任务评论" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("未知 entityType 一律拒绝", async () => {
    const caller = appRouter.createCaller(makeCtx(QA_MEMBER));
    await expect(
      caller.comments.add({ entityType: "mystery", entityId: "1", body: "?" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("项目成员(qa)可发可读，且落库 projectId 为解析值", async () => {
    const caller = appRouter.createCaller(makeCtx(QA_MEMBER));
    await caller.comments.add({ entityType: "issue", entityId: String(issueId), body: "成员评论" });
    const list = await caller.comments.list({ entityType: "issue", entityId: String(issueId) });
    expect(list.some((c) => c.body === "成员评论")).toBe(true);

    const db = await getDb();
    const rows = await db!.select().from(comments).where(eq(comments.projectId, PROJECT));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.projectId === PROJECT)).toBe(true);
  });

  it("viewer 只读：可读评论但不能发评论", async () => {
    const caller = appRouter.createCaller(makeCtx(VIEWER_MEMBER));
    const list = await caller.comments.list({ entityType: "issue", entityId: String(issueId) });
    expect(Array.isArray(list)).toBe(true);
    await expect(
      caller.comments.add({ entityType: "issue", entityId: String(issueId), body: "viewer 评论" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
