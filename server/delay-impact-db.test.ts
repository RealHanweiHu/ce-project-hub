import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectWithSeed, computeProjectDelayImpact } from "./db";
import { projects, projectTasks } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PRJ = `di-db-${Date.now()}`;

beforeAll(async () => {
  await createProjectWithSeed(
    { id: PRJ, name: "延期DB", projectNumber: "DI1", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 1, startDate: "2026-06-01" } as any,
    "npd", 1,
  );
  const { applyProjectSchedule } = await import("./db");
  await applyProjectSchedule(PRJ);
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectTasks).where(eq(projectTasks.projectId, PRJ));
  await db!.delete(projects).where(eq(projects.id, PRJ));
});

describe("computeProjectDelayImpact", () => {
  it("不存在的项目 → null", async () => {
    expect(await computeProjectDelayImpact("nope", "c1", "2026-06-01", "2026-06-10")).toBeNull();
  });

  it("把某有下游的任务推后 → 返回 DelayImpact、有顺延下游", async () => {
    const db = await getDb();
    const rows = await db!.select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
      .from(projectTasks).where(eq(projectTasks.projectId, PRJ));
    const head = rows.find((r) => r.startDate && r.dueDate)!;
    const { addWorkingDays } = await import("@shared/scheduling");
    const impact = await computeProjectDelayImpact(PRJ, head.taskId, head.startDate!, addWorkingDays(head.dueDate!, 15));
    expect(impact).not.toBeNull();
    expect(impact!.changedTaskId).toBe(head.taskId);
    expect(impact!.shifted.every((s) => s.deltaDays > 0)).toBe(true);
  });

  it("被裁(skipped)的任务不计入 shifted", async () => {
    const db = await getDb();
    const rows = await db!.select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
      .from(projectTasks).where(eq(projectTasks.projectId, PRJ));
    const scheduled = rows.filter((r) => r.startDate && r.dueDate);
    const head = scheduled[0];
    const victim = scheduled[scheduled.length - 1].taskId;
    await db!.update(projectTasks).set({ status: "skipped" }).where(eq(projectTasks.projectId, PRJ));
    await db!.update(projectTasks).set({ status: "todo" }).where(eq(projectTasks.taskId, head.taskId));
    const { addWorkingDays } = await import("@shared/scheduling");
    const impact = await computeProjectDelayImpact(PRJ, head.taskId, head.startDate!, addWorkingDays(head.dueDate!, 15));
    expect(impact!.shifted.map((s) => s.taskId)).not.toContain(victim);
  });
});
