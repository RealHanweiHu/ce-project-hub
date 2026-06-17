import { describe, it, expect } from "vitest";
import { generateSchedule, rescheduleFrom, flattenPhases, addDays, addWorkingDays } from "@shared/scheduling";
import { criticalPathTasks, scheduleForCategory, SCHEDULE_GRAPH } from "@shared/schedule-graph";

const START = "2026-06-15"; // 周一

describe("date helpers", () => {
  it("adds calendar days only when explicitly requested", () => {
    expect(addDays("2026-06-19", 1)).toBe("2026-06-20"); // 周五 + 1 日历日 = 周六
  });

  it("adds working days and skips weekends", () => {
    expect(addWorkingDays("2026-06-19", 1)).toBe("2026-06-22"); // 周五 + 1 工作日 = 下周一
  });

  it("supports an explicit holiday table", () => {
    expect(addWorkingDays("2026-06-19", 1, { holidays: ["2026-06-22"] })).toBe("2026-06-23");
  });

  it("rejects malformed or impossible dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(/valid calendar date/);
    expect(() => addDays("2026/06/15", 1)).toThrow(/YYYY-MM-DD/);
  });
});

describe("generateSchedule", () => {
  it("schedules a linear chain back-to-back by working-day duration", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c3", durationDays: 5, dependsOn: ["c1"] },
      { id: "c6", durationDays: 1, dependsOn: ["c3"] },
    ];
    const s = generateSchedule(tasks, START);
    expect(s.c1).toEqual({ start: "2026-06-15", due: "2026-06-24" });
    expect(s.c3).toEqual({ start: "2026-06-24", due: "2026-07-01" });
    expect(s.c6).toEqual({ start: "2026-07-01", due: "2026-07-02" });
  });

  it("starts a parallel-dependent task at max(deps.due)", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c2", durationDays: 5 },
      { id: "c3", durationDays: 5, dependsOn: ["c1", "c2"] },
    ];
    const s = generateSchedule(tasks, START);
    expect(s.c1.due).toBe("2026-06-24");
    expect(s.c2.due).toBe("2026-06-22");
    expect(s.c3.start).toBe("2026-06-24"); // max(c1,c2)
  });

  it("chains phases via cross-phase gate dependency", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c6", durationDays: 1, dependsOn: ["c1"] },
      { id: "p1", durationDays: 10, dependsOn: ["c6"] }, // 下一阶段入口依赖上一阶段 gate
    ];
    const s = generateSchedule(tasks, START);
    expect(s.c6.due).toBe("2026-06-25");
    expect(s.p1.start).toBe("2026-06-25");
    expect(s.p1.due).toBe(addWorkingDays("2026-06-25", 10));
  });

  it("can still schedule by calendar days when requested", () => {
    const s = generateSchedule([
      { id: "c1", durationDays: 7 },
      { id: "c3", durationDays: 5, dependsOn: ["c1"] },
    ], START, { useWorkingDays: false });
    expect(s.c1).toEqual({ start: "2026-06-15", due: "2026-06-22" });
    expect(s.c3).toEqual({ start: "2026-06-22", due: "2026-06-27" });
  });

  it("rolls a weekend project start to the next working day", () => {
    const s = generateSchedule([{ id: "a", durationDays: 1 }], "2026-06-20"); // 周六
    expect(s.a).toEqual({ start: "2026-06-22", due: "2026-06-23" });
  });

  it("throws on a dependency cycle instead of silently degrading", () => {
    expect(() => generateSchedule([
      { id: "a", durationDays: 1, dependsOn: ["b"] },
      { id: "b", durationDays: 1, dependsOn: ["a"] },
    ], START)).toThrow(/cycle/);
  });

  it("throws when a dependency points outside the task list", () => {
    expect(() => generateSchedule([
      { id: "a", durationDays: 1, dependsOn: ["missing"] },
    ], START)).toThrow(/missing task "missing"/);
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

  it("throws when an affected task has an unscheduled dependency", () => {
    const tasks = [
      { id: "a", durationDays: 1 },
      { id: "b", durationDays: 1 },
      { id: "c", durationDays: 1, dependsOn: ["a", "b"] },
    ];
    const current = generateSchedule(tasks, START);
    delete current.a;
    expect(() => rescheduleFrom(tasks, current, "b", { start: "2026-07-01", due: "2026-07-02" }))
      .toThrow(/dependency "a" has no schedule/);
  });
});

describe("scheduleForCategory (IPD graph)", () => {
  it("schedules every category task, starts at startDate, end after start", () => {
    for (const category of ["npd", "eco", "idr"]) {
      const s = scheduleForCategory(category, START);
      for (const [id, d] of Object.entries(s)) {
        expect(id).toBeTruthy();
        expect(d.due >= d.start).toBe(true);
      }
    }
  });

  it("schedules NPD phase gates in dependency order", () => {
    const s = scheduleForCategory("npd", START);
    expect(s.c1.start).toBe(START);
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

  it("throws on a graph dependency cycle when computing critical path", () => {
    expect(() => criticalPathTasks("npd", {
      ...SCHEDULE_GRAPH,
      c1: [5, "c6"],
    })).toThrow(/cycle/);
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
