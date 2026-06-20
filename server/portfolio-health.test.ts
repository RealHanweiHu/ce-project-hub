import { describe, it, expect, afterAll } from "vitest";
import {
  getDb, getPortfolio, getPortfolioHealthForDigest, hasAutomationRunForEntity,
  upsertProjectTask, createAutomationRun,
} from "./db";
import { projects, projectTasks, automationRuns, calendarExceptions } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const PROJ = `pf-health-${Date.now()}`;
const TODAY = "2026-06-16";

// 用同源测试专用的项目/假日，避免污染上面的聚合断言
const CAL_PROJ = `pf-cal-${Date.now()}`;
const CAL_HOLIDAY = "2026-06-25"; // 落在某未完成任务工期内
const CAL_TODAY = "2026-06-16";
const SKIP_PROJ = `pf-skip-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, CAL_PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, SKIP_PROJ));
  await db.delete(automationRuns).where(eq(automationRuns.ruleKey, "health_digest_test"));
  await db.delete(projects).where(eq(projects.id, PROJ));
  await db.delete(projects).where(eq(projects.id, CAL_PROJ));
  await db.delete(projects).where(eq(projects.id, SKIP_PROJ));
  await db.delete(calendarExceptions).where(eq(calendarExceptions.date, CAL_HOLIDAY));
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
    expect(row!.projectedEnd).not.toBeNull();
    expect(row!.projectedEnd! >= row!.plannedEnd!).toBe(true);
    expect(row!.progressBehindPct).toBe(25);
    expect(row!.ragLevel).toBe("red");
    expect(row!.ragReasons).toContain("逾期×1");
    expect(row!.overdueTasks).toBe(1); // c2 过期未完成
    expect(row!.blockedTasks).toBe(1); // c5 阻塞
  });

  it("digest 与 getPortfolio 用同一 cal、projectedEnd 一致", async () => {
    const db = await getDb();
    if (!db) return; // 无 DB 环境跳过

    // getPortfolio 用真实时钟（Asia/Shanghai），digest 取显式 todayISO；
    // 要可比，digest 必须传同一个 today。
    const todayISO = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());

    await db.insert(projects).values({
      id: CAL_PROJ, name: "同源日历测试", projectNumber: CAL_PROJ, category: "npd",
      risk: "low", currentPhase: "concept", archived: false, createdBy: 1,
    }).onConflictDoNothing();
    // 一行 holiday，落在下面 c3 的工期内
    await db.insert(calendarExceptions).values({
      date: CAL_HOLIDAY, type: "holiday", name: "测试假日", createdBy: 1,
    }).onConflictDoNothing();

    await upsertProjectTask(CAL_PROJ, "concept", "c1", { dueDate: "2026-06-10", status: "done" });
    await upsertProjectTask(CAL_PROJ, "concept", "c2", { dueDate: "2026-06-20", status: "in_progress" });
    await upsertProjectTask(CAL_PROJ, "concept", "c3", { dueDate: "2026-06-30", status: "in_progress" });
    // c3 起始日单独写库（upsertProjectTask 的 patch 不含 startDate），让预测工期跨越假日
    await db.update(projectTasks)
      .set({ startDate: "2026-06-23" })
      .where(and(eq(projectTasks.projectId, CAL_PROJ), eq(projectTasks.taskId, "c3")));

    // 含假日：两路必须同源、projectedEnd 一致
    const portfolio = await getPortfolio(1);
    const digest = await getPortfolioHealthForDigest(todayISO);
    const p = portfolio.find((x) => x.id === CAL_PROJ)!;
    const d = digest.find((x) => x.id === CAL_PROJ)!;
    expect(p).toBeDefined();
    expect(d).toBeDefined();
    expect(p.projectedEnd).not.toBeNull();
    expect(p.projectedEnd).toBe(d.projectedEnd);

    // 删掉假日再算：cal 真的被透传进预测，则 projectedEnd 应当提前（holiday 把工期顺延）
    const withHoliday = p.projectedEnd!;
    await db.delete(calendarExceptions).where(eq(calendarExceptions.date, CAL_HOLIDAY));
    const portfolioNoHol = await getPortfolio(1);
    const pNoHol = portfolioNoHol.find((x) => x.id === CAL_PROJ)!;
    expect(pNoHol.projectedEnd).not.toBeNull();
    expect(withHoliday > pNoHol.projectedEnd!).toBe(true);
  });

  it("projectedEnd 排除 skipped / 裁剪任务，避免远期无效任务拖长预测", async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(projects).values({
      id: SKIP_PROJ, name: "裁剪预测测试", projectNumber: SKIP_PROJ, category: "npd",
      risk: "low", currentPhase: "concept", archived: false, createdBy: 1, startDate: "2026-06-01",
    }).onConflictDoNothing();
    await upsertProjectTask(SKIP_PROJ, "concept", "c1", { startDate: "2026-06-01", dueDate: "2026-06-06", status: "done" });
    await upsertProjectTask(SKIP_PROJ, "concept", "c2", { startDate: "2026-06-06", dueDate: "2026-06-12", status: "in_progress" });
    await upsertProjectTask(SKIP_PROJ, "concept", "c6", { startDate: "2099-01-01", dueDate: "2099-01-10", status: "skipped" });

    const rows = await getPortfolioHealthForDigest("2026-06-10");
    const row = rows.find((r) => r.id === SKIP_PROJ);
    expect(row).toBeDefined();
    expect(row!.plannedEnd).toBe("2099-01-10");
    expect(row!.projectedEnd).not.toBeNull();
    expect(row!.projectedEnd! < "2099-01-01").toBe(true);
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
