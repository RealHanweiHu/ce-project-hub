import { describe, it, expect, afterAll } from "vitest";
import { getDb, getPortfolioMetricsData, getProjectMetricsData, upsertProjectTask } from "./db";
// side-effect import: ensure module is loaded before getGateReadiness' lazy dynamic import fires under vitest
import "./deliverable-review-service";
import { computeProjectMetrics } from "../shared/metrics";
import { defaultFromISO, shanghaiTodayISO } from "./metrics-window";
import { projects, projectTasks } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `pf-metrics-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("getPortfolioMetricsData", () => {
  it("行标量与单独 computeProjectMetrics 一致，startDate 为空走兜底不报错", async () => {
    const db = await getDb();
    if (!db) return; // 无 DB 环境跳过

    await db.insert(projects).values({
      id: PROJ, name: "组合度量测试", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "concept", archived: false, createdBy: 1,
      startDate: null,
    }).onConflictDoNothing();
    await upsertProjectTask(PROJ, "concept", "c1", { dueDate: "2026-06-10", status: "done" });
    await upsertProjectTask(PROJ, "concept", "c2", { dueDate: "2026-06-12", status: "in_progress" });

    const rollup = await getPortfolioMetricsData(1);
    const row = rollup.rows.find((r) => r.projectId === PROJ);
    expect(row).toBeDefined();

    const todayISO = shanghaiTodayISO();
    const raw = await getProjectMetricsData(PROJ, "", todayISO);
    const fromISO = defaultFromISO(null, raw, todayISO);
    const standalone = computeProjectMetrics({ ...raw, window: { fromISO, toISO: todayISO } });
    expect(row!.overdueRatePct).toBe(standalone.efficiency.overdueRatePct);
    expect(row!.dueDatedCount).toBe(standalone.efficiency.dueDatedCount);
    expect(row!.overdueCount).toBe(standalone.efficiency.overdueCount);
    expect(row!.gateFirstPassRatePct).toBe(standalone.process.gateFirstPassRatePct);
  });
});
