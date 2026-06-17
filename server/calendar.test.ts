import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { getCalendar, getDb, getPortfolio } from "./db";
import { projects, projectMembers, projectPhases, projectGateReviews } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const OWNER = 778001;
const MEMBER = 778002;
const OUTSIDER = 999999;
const PROJ = `cal-test-${Date.now()}`;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJ, name: "日历测试项目", projectNumber: "CAL-1", category: "npd",
    risk: "low", currentPhase: "concept", createdBy: OWNER, targetDate: "2026-07-20",
  });
  await db.insert(projectPhases).values({ projectId: PROJ, phaseId: "concept", endDate: "2026-07-05" });
  await db.insert(projectGateReviews).values({
    projectId: PROJ, phaseId: "concept", reviewDate: "2026-07-10", decision: "conditional",
  });
  await db.insert(projectMembers).values({
    projectId: PROJ, userId: MEMBER, role: "viewer", invitedBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, PROJ));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("getCalendar", () => {
  it("聚合阶段截止/Gate评审/项目目标日三类里程碑事件", async () => {
    const events = await getCalendar(OWNER, "2026-07-01", "2026-07-31");
    const mine = events.filter((e) => e.projectId === PROJ);
    const types = mine.map((e) => e.type).sort();
    expect(types).toEqual(["gate", "phase", "target"]);
    const phase = mine.find((e) => e.type === "phase");
    expect(phase?.date).toBe("2026-07-05");
    const gate = mine.find((e) => e.type === "gate");
    expect(gate?.date).toBe("2026-07-10");
    const target = mine.find((e) => e.type === "target");
    expect(target?.date).toBe("2026-07-20");
  });

  it("时间窗外的事件被过滤", async () => {
    const events = await getCalendar(OWNER, "2026-08-01", "2026-08-31");
    expect(events.filter((e) => e.projectId === PROJ)).toHaveLength(0);
  });

  it("日历仅展示可进入项目：创建者/成员可见，非成员不可见", async () => {
    const ownerEvents = await getCalendar(OWNER, "2026-07-01", "2026-07-31");
    const memberEvents = await getCalendar(MEMBER, "2026-07-01", "2026-07-31");
    const outsiderEvents = await getCalendar(OUTSIDER, "2026-07-01", "2026-07-31");

    expect(ownerEvents.filter((e) => e.projectId === PROJ).length).toBeGreaterThan(0);
    expect(memberEvents.filter((e) => e.projectId === PROJ).length).toBeGreaterThan(0);
    expect(outsiderEvents.filter((e) => e.projectId === PROJ)).toHaveLength(0);
  });

  it("组合看板仅展示可进入项目，避免列表可见但详情 Forbidden", async () => {
    const ownerRows = await getPortfolio(OWNER);
    const memberRows = await getPortfolio(MEMBER);
    const outsiderRows = await getPortfolio(OUTSIDER);

    expect(ownerRows.some((r) => r.id === PROJ)).toBe(true);
    expect(memberRows.some((r) => r.id === PROJ)).toBe(true);
    expect(outsiderRows.some((r) => r.id === PROJ)).toBe(false);
  });
});
