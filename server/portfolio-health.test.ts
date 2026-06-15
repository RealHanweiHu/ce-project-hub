import { describe, it, expect, afterAll } from "vitest";
import {
  getDb, getPortfolioHealthForDigest, hasAutomationRunForEntity,
  upsertProjectTask, createAutomationRun,
} from "./db";
import { projects, projectTasks, automationRuns } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `pf-health-${Date.now()}`;
const TODAY = "2026-06-16";

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(automationRuns).where(eq(automationRuns.ruleKey, "health_digest_test"));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("getPortfolioHealthForDigest", () => {
  it("聚合活跃项目的进度信号（分母=有计划日期的任务）", async () => {
    const db = await getDb();
    if (!db) return; // 无 DB 环境跳过
    await db.insert(projects).values({
      id: PROJ, name: "健康聚合测试", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "concept", archived: false, createdBy: 1,
    }).onConflictDoNothing();
    await upsertProjectTask(PROJ, "concept", "c1", { dueDate: "2026-06-10", status: "done" });
    await upsertProjectTask(PROJ, "concept", "c2", { dueDate: "2026-06-12", status: "in_progress" });
    await upsertProjectTask(PROJ, "concept", "c3", { dueDate: "2026-06-30", status: "in_progress" });
    await upsertProjectTask(PROJ, "concept", "c4", { dueDate: null, status: "in_progress" });
    await upsertProjectTask(PROJ, "concept", "c5", { dueDate: "2026-06-20", status: "blocked" });

    const rows = await getPortfolioHealthForDigest(TODAY);
    const row = rows.find((r) => r.id === PROJ);
    expect(row).toBeDefined();
    expect(row!.plannedItems).toBe(4); // c1,c2,c3,c5 有 dueDate（c4 无）
    expect(row!.dueItems).toBe(2); // c1,c2 <= today
    expect(row!.donePlannedItems).toBe(1); // c1 done
    expect(row!.plannedEnd).toBe("2026-06-30");
    expect(row!.overdueTasks).toBe(1); // c2 过期未完成
    expect(row!.blockedTasks).toBe(1); // c5 阻塞
  });

  it("hasAutomationRunForEntity 任意状态都算", async () => {
    const db = await getDb();
    if (!db) return;
    await createAutomationRun({
      ruleKey: "health_digest_test", projectId: null, eventType: "scheduled",
      entityType: "portfolio", entityId: "d:2026-06-16", status: "skipped", recipients: [], detail: "t",
    });
    expect(await hasAutomationRunForEntity({ ruleKey: "health_digest_test", entityId: "d:2026-06-16" })).toBe(true);
    expect(await hasAutomationRunForEntity({ ruleKey: "health_digest_test", entityId: "d:2099-01-01" })).toBe(false);
  });
});
