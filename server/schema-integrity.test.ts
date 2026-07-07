import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  bomItems,
  projectGateReviews,
  projectMembers,
  projectPhases,
  projectTasks,
  projects,
} from "../drizzle/schema";

/**
 * 数据库层完整性兜底：核心子表的外键必须由 PG 约束保证，而不是只靠
 * deleteProjectRows 的手工清单；关键状态列必须是 enum 而非自由字符串。
 * （审查时本地库已扫出 352 条孤儿任务 / 1057 条孤儿阶段行 / 285 条悬挂 BOM 行。）
 */

const GHOST = `no-such-project-${Date.now()}`;
const GHOST_REV = 987654321;

/** 断言写入被数据库以指定 SQLSTATE 拒绝（drizzle 会把 pg 错误包在 cause 里） */
async function expectPgError(promise: Promise<unknown>, code: string) {
  let error: unknown;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error, "insert should be rejected by the database").toBeDefined();
  const cause = (error as { cause?: { code?: string } }).cause;
  expect(cause?.code).toBe(code);
}

const FK_VIOLATION = "23503";
const INVALID_ENUM_VALUE = "22P02";

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  // RED 阶段插入会成功，别给库里再添孤儿
  await db.delete(projectTasks).where(eq(projectTasks.projectId, GHOST));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, GHOST));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, GHOST));
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, GHOST));
  await db.delete(bomItems).where(eq(bomItems.projectId, GHOST));
  await db.delete(bomItems).where(eq(bomItems.revisionId, GHOST_REV));
  await db.delete(projects).where(eq(projects.id, GHOST));
});

describe("schema integrity: foreign keys", () => {
  it("rejects a task pointing at a nonexistent project", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(
      db.insert(projectTasks).values({ projectId: GHOST, phaseId: "concept", taskId: "c1" }),
      FK_VIOLATION
    );
  });

  it("rejects a phase row pointing at a nonexistent project", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(
      db.insert(projectPhases).values({ projectId: GHOST, phaseId: "concept" }),
      FK_VIOLATION
    );
  });

  it("rejects a member row pointing at a nonexistent project", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(
      db.insert(projectMembers).values({ projectId: GHOST, userId: 984001, invitedBy: 984001 }),
      FK_VIOLATION
    );
  });

  it("rejects a gate review pointing at a nonexistent project", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(
      db.insert(projectGateReviews).values({
        projectId: GHOST, phaseId: "concept", reviewDate: "2026-07-06", decision: "approved",
      }),
      FK_VIOLATION
    );
  });

  it("rejects a working BOM line pointing at a nonexistent project", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(
      db.insert(bomItems).values({ projectId: GHOST, name: "ghost part" }),
      FK_VIOLATION
    );
  });

  it("rejects a frozen BOM line pointing at a nonexistent revision", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(
      db.insert(bomItems).values({ revisionId: GHOST_REV, name: "ghost frozen part" }),
      FK_VIOLATION
    );
  });
});

describe("schema integrity: status enums", () => {
  it("rejects a project with a category outside the SOP set", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await expectPgError(
      db.insert(projects).values({
        id: GHOST, name: "Ghost", projectNumber: GHOST,
        category: "bogus" as never, risk: "low", currentPhase: "concept", createdBy: 984001,
      }),
      INVALID_ENUM_VALUE
    );
  });
});
