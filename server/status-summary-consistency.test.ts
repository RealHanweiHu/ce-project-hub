import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  getDb,
  createProjectWithSeed,
  getPortfolio,
  getProjectProgressSummary,
  refreshProjectTaskStatuses,
} from "./db";
import { projects, projectTasks } from "../drizzle/schema";

// §5 统一状态口径：同一项目在 组合看板 / 单项目摘要 / projects.progress 缓存
// 三处的进度必须相等（单一数据源，不靠人肉对齐）。
const PID = "statsum01tst";
// createdBy 即可进入 getProjectsByMember 视野，无需真实用户行（与既有 v3 测试同法）
const userId = 990731;

describe("§5 状态口径一致性", () => {
  beforeAll(async () => {
    const db0 = await getDb();
    await db0!.delete(projectTasks).where(eq(projectTasks.projectId, PID));
    await db0!.delete(projects).where(eq(projects.id, PID));
    await createProjectWithSeed(
      {
        id: PID, name: "状态口径一致性", projectNumber: PID, sopTemplateVersion: "2026-07-v3",
        currentPhase: "concept", createdBy: userId,
        customFields: { npdTemplate: { tier: "lite", packs: [] } },
      } as never,
      "npd",
      userId,
    );
    const db = await getDb();
    // 完成 3 个、裁剪 1 个，构造非平凡进度
    const rows = await db!.select().from(projectTasks).where(eq(projectTasks.projectId, PID));
    expect(rows.length).toBeGreaterThan(4);
    for (const row of rows.slice(0, 3)) {
      await db!.update(projectTasks)
        .set({ status: "done", completed: true, completedAt: new Date() })
        .where(eq(projectTasks.id, row.id));
    }
    await db!.update(projectTasks)
      .set({ status: "skipped" })
      .where(eq(projectTasks.id, rows[3].id));
    await refreshProjectTaskStatuses(PID);
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(projectTasks).where(eq(projectTasks.projectId, PID));
    await db!.delete(projects).where(eq(projects.id, PID));
  });

  it("摘要口径：skipped 双侧剔除", async () => {
    const db = await getDb();
    const rows = await db!.select().from(projectTasks).where(eq(projectTasks.projectId, PID));
    const effective = rows.filter((row) => row.status !== "skipped");
    const done = effective.filter((row) => row.status === "done").length;
    const expected = Math.round((done / effective.length) * 100);
    const summary = await getProjectProgressSummary(PID);
    expect(summary.progress).toBe(expected);
    expect(summary.progress).toBeGreaterThan(0);
  });

  it("组合看板行进度 = 单项目摘要进度", async () => {
    const [summary, portfolio] = await Promise.all([
      getProjectProgressSummary(PID),
      getPortfolio(userId),
    ]);
    const row = portfolio.find((item) => item.id === PID);
    expect(row).toBeDefined();
    expect(row!.progress).toBe(summary.progress);
    expect(row!.phaseProgress).toEqual(summary.phaseProgress);
  });

  it("projects.progress 派生缓存在 refresh 后与摘要一致", async () => {
    const db = await getDb();
    const summary = await getProjectProgressSummary(PID);
    const [projectRow] = await db!.select({ progress: projects.progress })
      .from(projects).where(eq(projects.id, PID));
    expect(projectRow.progress).toBe(summary.progress);
  });

  it("阶段进度分片求和与整体一致（lite 档含 verification 阶段）", async () => {
    const summary = await getProjectProgressSummary(PID);
    const total = summary.phaseProgress.reduce((n, item) => n + item.total, 0);
    const done = summary.phaseProgress.reduce((n, item) => n + item.done, 0);
    expect(Math.round((done / total) * 100)).toBe(summary.progress);
    expect(summary.phaseProgress.some((item) => item.phaseId === "verification")).toBe(true);
  });
});
