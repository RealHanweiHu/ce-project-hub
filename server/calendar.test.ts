import { describe, it, expect, afterAll, beforeAll, afterEach } from "vitest";
import { adminRouter } from "./routers/admin";
import { getCalendar, getCalendarExceptions, getDb } from "./db";
import { projects, projectPhases, projectGateReviews, projectTasks, calendarExceptions } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const OWNER = 778001;
const PROJ = `cal-test-${Date.now()}`;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJ, name: "日历测试项目", projectNumber: "CAL-1", category: "npd",
    risk: "low", currentPhase: "concept", createdBy: OWNER, targetDate: "2026-07-20",
  });
  await db.insert(projectPhases).values({ projectId: PROJ, phaseId: "concept", endDate: "2026-07-05" });
  await db.insert(projectTasks).values({
    projectId: PROJ, phaseId: "concept", taskId: "c6", dueDate: "2026-07-08", status: "in_progress",
  });
  await db.insert(projectGateReviews).values({
    projectId: PROJ, phaseId: "concept", reviewDate: "2026-07-10", decision: "conditional",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("getCalendar", () => {
  it("聚合阶段截止/Gate评审/项目目标日三类里程碑事件", async () => {
    const events = await getCalendar(OWNER, "2026-07-01", "2026-07-31");
    const mine = events.filter((e) => e.projectId === PROJ);
    const types = mine.map((e) => e.type).sort();
    expect(types).toEqual(["gate", "gate", "phase", "target"]);
    const phase = mine.find((e) => e.type === "phase");
    expect(phase?.date).toBe("2026-07-05");
    const gateDates = mine.filter((e) => e.type === "gate").map((e) => e.date).sort();
    expect(gateDates).toEqual(["2026-07-08", "2026-07-10"]);
    const target = mine.find((e) => e.type === "target");
    expect(target?.date).toBe("2026-07-20");
  });

  it("时间窗外的事件被过滤", async () => {
    const events = await getCalendar(OWNER, "2026-08-01", "2026-08-31");
    expect(events.filter((e) => e.projectId === PROJ)).toHaveLength(0);
  });

  it("总览全员可见：非成员用户也能看到该项目的里程碑事件", async () => {
    const events = await getCalendar(999999, "2026-07-01", "2026-07-31");
    expect(events.filter((e) => e.projectId === PROJ).length).toBeGreaterThan(0);
  });
});

describe("getCalendarExceptions", () => {
  const HOLIDAY_DATE = "2026-02-17";
  const MAKEUP_DATE = "2026-02-15";

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await db.insert(calendarExceptions).values([
      { date: HOLIDAY_DATE, type: "holiday", name: "测试节假日", createdBy: OWNER },
      { date: MAKEUP_DATE, type: "makeup_workday", name: "测试补班日", createdBy: OWNER },
    ]);
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(calendarExceptions).where(eq(calendarExceptions.date, HOLIDAY_DATE));
    await db.delete(calendarExceptions).where(eq(calendarExceptions.date, MAKEUP_DATE));
  });

  it("getCalendarExceptions 按 type 分桶成两个 Set", async () => {
    const cal = await getCalendarExceptions();
    expect(cal.holidays.has(HOLIDAY_DATE)).toBe(true);
    expect(cal.makeupWorkdays.has(MAKEUP_DATE)).toBe(true);
    expect(cal.holidays.has(MAKEUP_DATE)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// admin.calendarExceptions CRUD (TDD)
// ─────────────────────────────────────────────────────────────────────────────

const makeCtx = (id: number, role = "user") => ({
  user: {
    id,
    role,
    name: "x",
    email: "x",
    canCreateProject: false,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
    passwordHash: null,
    username: null,
  },
});

describe("admin.calendarExceptions", () => {
  const TEST_DATE = "2026-10-01";

  afterEach(async () => {
    // 清理测试数据，避免污染
    const db = await getDb();
    if (!db) return;
    await db.delete(calendarExceptions).where(eq(calendarExceptions.date, TEST_DATE));
  });

  it("非 admin upsert 被拒", async () => {
    const caller = adminRouter.createCaller(makeCtx(9, "user") as any);
    await expect(
      caller.calendarExceptions.upsert({ date: TEST_DATE, type: "holiday", name: "国庆" })
    ).rejects.toThrow();
  });

  it("admin upsert 幂等、list 可见、remove 生效", async () => {
    const caller = adminRouter.createCaller(makeCtx(1, "admin") as any);
    await caller.calendarExceptions.upsert({ date: TEST_DATE, type: "holiday", name: "国庆" });
    await caller.calendarExceptions.upsert({ date: TEST_DATE, type: "holiday", name: "国庆节" });
    const list = await caller.calendarExceptions.list();
    expect(list.filter((e) => e.date === TEST_DATE)).toHaveLength(1);
    expect(list.find((e) => e.date === TEST_DATE)?.name).toBe("国庆节");
    await caller.calendarExceptions.remove({ date: TEST_DATE });
    const after = await caller.calendarExceptions.list();
    expect(after.find((e) => e.date === TEST_DATE)).toBeUndefined();
  });
});
