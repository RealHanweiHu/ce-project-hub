import { describe, it, expect } from "vitest";
import { generateSchedule, rescheduleFrom, flattenPhases, addDays } from "@shared/scheduling";
import { scheduleForCategory, SCHEDULE_GRAPH } from "@shared/schedule-graph";

const START = "2026-06-15"; // 周一

describe("generateSchedule", () => {
  it("schedules a linear chain back-to-back by duration", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c3", durationDays: 5, dependsOn: ["c1"] },
      { id: "c6", durationDays: 1, dependsOn: ["c3"] },
    ];
    const s = generateSchedule(tasks, START);
    expect(s.c1).toEqual({ start: "2026-06-15", due: "2026-06-22" });
    expect(s.c3).toEqual({ start: "2026-06-22", due: "2026-06-27" });
    expect(s.c6).toEqual({ start: "2026-06-27", due: "2026-06-28" });
  });

  it("starts a parallel-dependent task at max(deps.due)", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c2", durationDays: 5 },
      { id: "c3", durationDays: 5, dependsOn: ["c1", "c2"] },
    ];
    const s = generateSchedule(tasks, START);
    expect(s.c1.due).toBe("2026-06-22");
    expect(s.c2.due).toBe("2026-06-20");
    expect(s.c3.start).toBe("2026-06-22"); // max(c1,c2)
  });

  it("chains phases via cross-phase gate dependency", () => {
    const tasks = [
      { id: "c1", durationDays: 7 },
      { id: "c6", durationDays: 1, dependsOn: ["c1"] },
      { id: "p1", durationDays: 10, dependsOn: ["c6"] }, // 下一阶段入口依赖上一阶段 gate
    ];
    const s = generateSchedule(tasks, START);
    expect(s.c6.due).toBe("2026-06-23");
    expect(s.p1.start).toBe("2026-06-23");
    expect(s.p1.due).toBe(addDays("2026-06-23", 10));
  });

  it("does not hang on a dependency cycle", () => {
    const s = generateSchedule([
      { id: "a", durationDays: 1, dependsOn: ["b"] },
      { id: "b", durationDays: 1, dependsOn: ["a"] },
    ], START);
    expect(Object.keys(s).sort()).toEqual(["a", "b"]);
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
