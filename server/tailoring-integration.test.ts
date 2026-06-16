import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, getCalendar, getGateReadiness,
  createProjectTailoringRequest, reviewProjectTailoring,
} from "./db";
import { projects, projectPhases, projectTailoring, projectTasks } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `tli-test-${Date.now()}`;
const U = 640001;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJ, name: "裁剪集成", projectNumber: "TLI-1", category: "npd",
    risk: "low", currentPhase: "design", createdBy: U,
  });
  await db.insert(projectPhases).values({ projectId: PROJ, phaseId: "design", endDate: "2026-07-18" });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectTailoring).where(eq(projectTailoring.projectId, PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("裁剪集成：日历过滤 + Gate 就绪短路", () => {
  it("被裁阶段的截止里程碑从日历过滤；被裁阶段 Gate 就绪直接 ready", async () => {
    const before = await getCalendar(U, "2026-07-01", "2026-07-31");
    expect(before.some((e) => e.projectId === PROJ && e.type === "phase")).toBe(true);

    const id = await createProjectTailoringRequest({
      projectId: PROJ, reasonType: "customer_id", reasonNote: "客户提供ID",
      targets: [{ scope: "phase", phaseId: "design" }], proposedBy: U,
    });
    await reviewProjectTailoring({ id, decision: "approved", reviewedBy: U, reviewNote: null });

    const after = await getCalendar(U, "2026-07-01", "2026-07-31");
    expect(after.some((e) => e.projectId === PROJ && e.type === "phase")).toBe(false);

    const r = await getGateReadiness(PROJ, "design");
    expect(r?.ready).toBe(true);
  });
});
