import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectWithSeed } from "./db";
import {
  applyProjectSchedule,
  computeProjectDelayImpact,
  rescheduleProjectFromTask,
} from "./services/schedule-service";
import { projects, projectTasks } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const PRJ = `di-db-${Date.now()}`;

beforeAll(async () => {
  await createProjectWithSeed(
    { id: PRJ, name: "延期DB", projectNumber: "DI1", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 1, startDate: "2026-06-01" } as any,
    "npd", 1,
  );
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
    await db!.update(projectTasks).set({ status: "todo" }).where(and(eq(projectTasks.projectId, PRJ), eq(projectTasks.taskId, head.taskId)));
    const { addWorkingDays } = await import("@shared/scheduling");
    const impact = await computeProjectDelayImpact(PRJ, head.taskId, head.startDate!, addWorkingDays(head.dueDate!, 15));
    expect(impact!.shifted.map((s) => s.taskId)).not.toContain(victim);
  });
});

describe("rescheduleProjectFromTask 返回 impact + 冲击 emit", () => {
  it("返回 {count, impact}，冲击时 emit task.rescheduled", async () => {
    const P = `di-emit-${Date.now()}`;
    await createProjectWithSeed(
      { id: P, name: "延期emit", projectNumber: "DI2", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 1, startDate: "2026-06-01" } as any,
      "npd", 1,
    );
    await applyProjectSchedule(P);
    const db = await getDb();
    const rows = await db!.select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
      .from(projectTasks).where(eq(projectTasks.projectId, P));
    const head = rows.find((r) => r.startDate && r.dueDate)!;
    const { addWorkingDays } = await import("@shared/scheduling");

    const events: string[] = [];
    const res = await rescheduleProjectFromTask(P, head.taskId, head.startDate!, addWorkingDays(head.dueDate!, 30), {
      emit: async (e: any) => { events.push(e.action); },
    });
    expect(typeof res.count).toBe("number");
    expect(res.impact).not.toBeNull();
    if (res.impact?.hasImpact) expect(events).toContain("task.rescheduled");

    await db!.delete(projectTasks).where(eq(projectTasks.projectId, P));
    await db!.delete(projects).where(eq(projects.id, P));
  });

  it("被裁 skipped 任务不被实际落库重排改日期", async () => {
    const P = `di-skip-${Date.now()}`;
    await createProjectWithSeed(
      { id: P, name: "延期skip", projectNumber: "DI3", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 1, startDate: "2026-06-01" } as any,
      "npd", 1,
    );
    await applyProjectSchedule(P);
    const db = await getDb();
    const rows = await db!.select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
      .from(projectTasks).where(eq(projectTasks.projectId, P));
    const scheduled = rows
      .filter((r) => r.startDate && r.dueDate)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    const head = scheduled[0];
    const victim = scheduled[scheduled.length - 1];
    await db!.update(projectTasks)
      .set({ status: "skipped" })
      .where(and(eq(projectTasks.projectId, P), eq(projectTasks.taskId, victim.taskId)));

    const { addWorkingDays } = await import("@shared/scheduling");
    const res = await rescheduleProjectFromTask(P, head.taskId, head.startDate!, addWorkingDays(head.dueDate!, 30), {
      emit: async () => {},
    });
    expect(res.impact?.shifted.map((s) => s.taskId)).not.toContain(victim.taskId);

    const [after] = await db!.select({ startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
      .from(projectTasks)
      .where(and(eq(projectTasks.projectId, P), eq(projectTasks.taskId, victim.taskId)))
      .limit(1);
    expect(after).toEqual({ startDate: victim.startDate, dueDate: victim.dueDate });

    await db!.delete(projectTasks).where(eq(projectTasks.projectId, P));
    await db!.delete(projects).where(eq(projects.id, P));
  });
});
