import { describe, it, expect } from "vitest";
import {
  generateSchedule, rescheduleFrom, flattenPhases, addDays, addWorkingDays,
  forecastSchedule, projectedEndFromSchedule, isISODate,
} from "@shared/scheduling";
import { generateCalendarSchedule, planWorkingCalendarMigration } from "@shared/schedule-migration";
import { scheduleForCategory, SCHEDULE_GRAPH } from "@shared/schedule-graph";

const START = "2026-06-15"; // 周一

describe("date helpers", () => {
  it("rejects malformed or impossible ISO dates", () => {
    expect(isISODate("2026-06-15")).toBe(true);
    expect(isISODate("2026-13-15")).toBe(false);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(() => addDays("2026-02-30", 1)).toThrow(/Invalid ISO date/);
  });
  it("adds factory working days and skips Sundays", () => {
    expect(addWorkingDays("2026-06-19", 1)).toBe("2026-06-20");
    expect(addWorkingDays("2026-06-20", 0)).toBe("2026-06-20");
    expect(addWorkingDays("2026-06-21", 0)).toBe("2026-06-22");
    expect(addWorkingDays("2026-06-15", 14)).toBe("2026-07-01");
  });
});

describe("generateSchedule", () => {
  it("schedules a linear chain back-to-back by duration", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c3", durationDays: 5, dependsOn: ["c1"] },
      { id: "c6", durationDays: 1, dependsOn: ["c3"] },
    ];
    const s = generateSchedule(tasks, START);
    expect(s.c1).toEqual({ start: "2026-06-15", due: "2026-06-23" });
    expect(s.c3).toEqual({ start: "2026-06-23", due: "2026-06-29" });
    expect(s.c6).toEqual({ start: "2026-06-29", due: "2026-06-30" });
  });

  it("starts a parallel-dependent task at max(deps.due)", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c2", durationDays: 5 },
      { id: "c3", durationDays: 5, dependsOn: ["c1", "c2"] },
    ];
    const s = generateSchedule(tasks, START);
    expect(s.c1.due).toBe("2026-06-23");
    expect(s.c2.due).toBe("2026-06-20");
    expect(s.c3.start).toBe("2026-06-23"); // max(c1,c2)
  });

  it("chains phases via cross-phase gate dependency", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c6", durationDays: 1, dependsOn: ["c1"] },
      { id: "p1", durationDays: 10, dependsOn: ["c6"] }, // 下一阶段入口依赖上一阶段 gate
    ];
    const s = generateSchedule(tasks, START);
    expect(s.c6.due).toBe("2026-06-24");
    expect(s.p1.start).toBe("2026-06-24");
    expect(s.p1.due).toBe(addWorkingDays("2026-06-24", 10));
  });

  it("does not hang on a dependency cycle", () => {
    const s = generateSchedule([
      { id: "a", durationDays: 1, dependsOn: ["b"] },
      { id: "b", durationDays: 1, dependsOn: ["a"] },
    ], START);
    expect(Object.keys(s).sort()).toEqual(["a", "b"]);
  });
});

describe("forecastSchedule", () => {
  it("anchors completed tasks by completedAt and pushes unfinished successors from today", () => {
    const tasks = [
      { id: "a", durationDays: 5 },
      { id: "b", durationDays: 5, dependsOn: ["a"] },
      { id: "c", durationDays: 1, dependsOn: ["b"] },
    ];
    const out = forecastSchedule(tasks, [
      { id: "a", status: "done", completed: true, completedAtISO: "2026-06-25T10:00:00.000Z" },
      { id: "b", status: "in_progress", startDate: "2026-06-18", dueDate: "2026-06-24" },
      { id: "c", status: "todo", startDate: "2026-06-25", dueDate: "2026-06-26" },
    ], "2026-06-30", "2026-06-15");
    expect(out.a.due).toBe("2026-06-25");
    expect(out.b).toEqual({ start: "2026-06-30", due: "2026-07-06" });
    expect(out.c).toEqual({ start: "2026-07-06", due: "2026-07-07" });
    expect(projectedEndFromSchedule(out)).toBe("2026-07-07");
  });
});

describe("working calendar migration plan", () => {
  const tasks = [
    { id: "a", durationDays: 5 },
    { id: "b", durationDays: 1, dependsOn: ["a"] },
  ];

  it("updates rows that exactly match the old calendar-day schedule", () => {
    const old = generateCalendarSchedule(tasks, START);
    const plan = planWorkingCalendarMigration({
      tasks,
      startDate: START,
      current: [
        { taskId: "a", startDate: old.a.start, dueDate: old.a.due },
        { taskId: "b", startDate: old.b.start, dueDate: old.b.due },
      ],
    });
    expect(plan.updates.map((item) => item.taskId)).toEqual(["b"]);
    expect(plan.manualOrUnknown).toEqual([]);
    expect(plan.alreadyWorking).toEqual(["a"]);
    expect(plan.updates[0].to).toEqual({ start: "2026-06-20", due: "2026-06-22" });
  });

  it("does not overwrite rows that look manually edited", () => {
    const old = generateCalendarSchedule(tasks, START);
    const plan = planWorkingCalendarMigration({
      tasks,
      startDate: START,
      current: [
        { taskId: "a", startDate: "2026-06-16", dueDate: old.a.due },
        { taskId: "b", startDate: old.b.start, dueDate: old.b.due },
      ],
    });
    expect(plan.updates.map((item) => item.taskId)).toEqual(["b"]);
    expect(plan.manualOrUnknown.map((item) => item.taskId)).toEqual(["a"]);
  });

  it("separates rows with no schedule yet from manual edits", () => {
    const plan = planWorkingCalendarMigration({
      tasks,
      startDate: START,
      current: [
        { taskId: "a", startDate: null, dueDate: null },
        { taskId: "b", startDate: null, dueDate: null },
      ],
    });
    expect(plan.updates).toEqual([]);
    expect(plan.missingSchedule.map((item) => item.taskId)).toEqual(["a", "b"]);
    expect(plan.manualOrUnknown).toEqual([]);
  });

  it("recognizes rows that are already on the working calendar", () => {
    const current = generateSchedule(tasks, START);
    const plan = planWorkingCalendarMigration({
      tasks,
      startDate: START,
      current: [
        { taskId: "a", startDate: current.a.start, dueDate: current.a.due },
        { taskId: "b", startDate: current.b.start, dueDate: current.b.due },
      ],
    });
    expect(plan.updates).toEqual([]);
    expect(plan.alreadyWorking).toEqual(["a", "b"]);
  });
});

describe("rescheduleFrom", () => {
  it("shifts only transitive successors; leaves upstream untouched", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c3", durationDays: 5, dependsOn: ["c1"] },
      { id: "c6", durationDays: 1, dependsOn: ["c3"] },
    ];
    const base = generateSchedule(tasks, START);
    const out = rescheduleFrom(tasks, base, "c3", { start: "2026-07-01", due: "2026-07-06" });
    expect(out.c1).toEqual(base.c1);               // 上游不动
    expect(out.c3).toEqual({ start: "2026-07-01", due: "2026-07-06" }); // 锚定
    expect(out.c6).toEqual({ start: "2026-07-06", due: "2026-07-07" }); // 下游顺延
  });
});

describe("scheduleForCategory (IPD graph)", () => {
  it("schedules every NPD task, starts at startDate, end after start", () => {
    const s = scheduleForCategory("npd", START);
    // 概念入口 c1 从开始日
    expect(s.c1.start).toBe(START);
    // 所有图里的 NPD 任务都有排期
    for (const id of ["c1", "c6", "p7", "d8", "e7", "v8", "pv8", "mp6"]) {
      expect(s[id]).toBeTruthy();
      expect(s[id].due >= s[id].start).toBe(true);
    }
    // 阶段串联：p1 不早于 c6 完成
    expect(s.p1.start >= s.c6.due).toBe(true);
    // 量产 gate 在最后、晚于概念
    expect(s.mp6.due > s.c6.due).toBe(true);
  });

  it("every graph entry has a positive duration", () => {
    for (const [id, g] of Object.entries(SCHEDULE_GRAPH)) {
      expect(g[0]).toBeGreaterThan(0);
      // 依赖不能指向自己
      expect((g.slice(1) as string[]).includes(id)).toBe(false);
    }
  });
});

describe("flattenPhases", () => {
  it("applies phase bufferDays as lagDays on phase entry tasks", () => {
    const flat = flattenPhases([
      { tasks: [{ id: "a", durationDays: 2 }, { id: "b", durationDays: 2, dependsOn: ["a"] }] },
      { bufferDays: 3, tasks: [{ id: "c", durationDays: 2, dependsOn: ["b"] }] }, // c 入口（依赖跨阶段 b）
    ]);
    const c = flat.find((t) => t.id === "c")!;
    expect(c.lagDays).toBe(3);
    const b = flat.find((t) => t.id === "b")!;
    expect(b.lagDays).toBe(0); // 本阶段内前置，非入口
  });
});
