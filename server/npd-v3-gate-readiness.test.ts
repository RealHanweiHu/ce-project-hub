import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLogs, projectTasks, projects } from "../drizzle/schema";
import {
  createProjectWithSeed,
  getDb,
  getGateReadiness,
  refreshProjectTaskStatuses,
} from "./db";
import { applyProjectSchedule } from "./services/schedule-service";

const OWNER = 996201;
const PID = `npdv3-gate-${Date.now().toString(36)}`;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PID));
  await db.delete(projects).where(eq(projects.id, PID));
  await createProjectWithSeed({
    id: PID,
    name: "NPD v3 lite gate",
    projectNumber: PID,
    category: "npd",
    sopTemplateVersion: "2026-07-v3",
    customFields: {
      npdTemplate: { tier: "lite", packs: ["battery", "cert", "software", "mold"] },
    },
    currentPhase: "concept",
    startDate: "2026-01-05",
    createdBy: OWNER,
  }, "npd", OWNER);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PID));
  await db.delete(projects).where(eq(projects.id, PID));
});

describe("NPD v3 gate readiness and status derivation", () => {
  it("lite Concept Gate 只检查实际存在的 nlc1", async () => {
    const db = await getDb();
    await db!.update(projectTasks).set({
      status: "todo",
      completed: false,
      completedAt: null,
    }).where(eq(projectTasks.projectId, PID));
    await db!.update(projectTasks).set({
      status: "done",
      completed: true,
      completedAt: new Date(),
    }).where(and(eq(projectTasks.projectId, PID), eq(projectTasks.taskId, "nlc1")));

    const readiness = await getGateReadiness(PID, "concept");
    expect(readiness).not.toBeNull();
    expect(readiness?.dimensions.find((dimension) => dimension.dimension === "prereq")?.blockers)
      .toEqual([]);
  });

  it("lite verification 可解析，且包证据与正式测试报告都不能绕过", async () => {
    const readiness = await getGateReadiness(PID, "verification");
    expect(readiness).not.toBeNull();
    const prereq = readiness?.dimensions.find((dimension) => dimension.dimension === "prereq");
    expect(prereq?.blockers).toEqual(
      expect.arrayContaining(["nle1", "nv2", "pc2", "ps2", "pmo1"]),
    );
    expect(prereq?.blockers).not.toEqual(
      expect.arrayContaining(["ne1", "ne2", "ne3", "nv1"]),
    );
    const deliverables = readiness?.dimensions.find((dimension) => dimension.dimension === "deliverables");
    expect(deliverables?.blockers).toEqual(
      expect.arrayContaining(["认证报告", "软件完整测试报告", "模具T1样品"]),
    );
    const reports = readiness?.dimensions.find((dimension) => dimension.dimension === "test_reports");
    expect(reports?.ok).toBe(false);
    expect(reports?.blockers).toEqual(
      expect.arrayContaining(["VERIFICATION 缺少测试计划", "VERIFICATION 缺少测试报告"]),
    );
  });

  it("包任务在 lite 依赖未完成时保持 todo，完成后才可进入 in_progress", async () => {
    const db = await getDb();
    await db!.update(projectTasks).set({
      status: "todo",
      completed: false,
      completedAt: null,
      startDate: null,
      dueDate: null,
      assigneeUserId: null,
    }).where(eq(projectTasks.projectId, PID));
    await db!.update(projectTasks).set({ assigneeUserId: OWNER })
      .where(and(eq(projectTasks.projectId, PID), eq(projectTasks.taskId, "pc2")));

    await refreshProjectTaskStatuses(PID, "2026-07-12");
    let rows = await db!.select().from(projectTasks).where(eq(projectTasks.projectId, PID));
    expect(rows.find((row) => row.taskId === "pc2")?.status).toBe("todo");

    await db!.update(projectTasks).set({ status: "done", completed: true, completedAt: new Date() })
      .where(and(eq(projectTasks.projectId, PID), eq(projectTasks.taskId, "nle1")));
    await refreshProjectTaskStatuses(PID, "2026-07-12");
    rows = await db!.select().from(projectTasks).where(eq(projectTasks.projectId, PID));
    expect(rows.find((row) => row.taskId === "pc2")?.status).toBe("in_progress");
  });

  it("项目排期覆盖所有生效任务，并遵守 lite 包依赖", async () => {
    await applyProjectSchedule(PID);
    const db = await getDb();
    const rows = await db!.select().from(projectTasks).where(eq(projectTasks.projectId, PID));
    expect(rows).toHaveLength(22);
    for (const row of rows) {
      expect(row.startDate, `${row.taskId} missing startDate`).toBeTruthy();
      expect(row.dueDate, `${row.taskId} missing dueDate`).toBeTruthy();
    }
    const byId = new Map(rows.map((row) => [row.taskId, row]));
    expect(byId.get("nlc1")?.dueDate).not.toBe(byId.get("nlc1")?.startDate);
    expect(byId.get("pc2")!.startDate! >= byId.get("nle1")!.dueDate!).toBe(true);
    for (const dependencyId of ["pc2", "ps2", "pmo1"]) {
      expect(byId.get("nv3")!.startDate! >= byId.get(dependencyId)!.dueDate!).toBe(true);
    }
  });
});
