import { describe, it, expect } from "vitest";
import { computeDelayImpact } from "@shared/delay-impact";
import { generateSchedule, addWorkingDays, type SchedTask } from "@shared/scheduling";

const linear: SchedTask[] = [
  { id: "a", durationDays: 2, dependsOn: [] },
  { id: "b", durationDays: 2, dependsOn: ["a"] },
  { id: "c", durationDays: 2, dependsOn: ["b"] },
  { id: "g", durationDays: 1, dependsOn: ["c"] },
];
const branch: SchedTask[] = [
  { id: "a", durationDays: 2, dependsOn: [] },
  { id: "b", durationDays: 1, dependsOn: ["a"] },
  { id: "c", durationDays: 8, dependsOn: ["a"] },
  { id: "e", durationDays: 1, dependsOn: ["b", "c"] },
];
const START = "2026-06-01";

describe("computeDelayImpact", () => {
  it("改链尾 gate → 无下游 shifted，无 gate 冲击", () => {
    const current = generateSchedule(linear, START);
    const r = computeDelayImpact({
      schedTasks: linear, current, changedTaskId: "g",
      newDates: { start: current.g.start, due: addWorkingDays(current.g.due, 5) },
      gateTaskIds: new Set(["g"]), gateNames: { g: "MP评审" }, targetDate: null,
    });
    expect(r.shifted).toEqual([]);
    expect(r.gateImpacts).toEqual([]);
    expect(r.hasImpact).toBe(false);
  });

  it("改链头 → 下游 b/c/g 顺延，gate g 命中且带名，hasImpact=true", () => {
    const current = generateSchedule(linear, START);
    const r = computeDelayImpact({
      schedTasks: linear, current, changedTaskId: "a",
      newDates: { start: current.a.start, due: addWorkingDays(current.a.due, 10) },
      gateTaskIds: new Set(["g"]), gateNames: { g: "MP评审" }, targetDate: null,
    });
    expect(r.shifted.map((s) => s.taskId).sort()).toEqual(["b", "c", "g"]);
    expect(r.shifted.every((s) => s.deltaDays > 0)).toBe(true);
    expect(r.gateImpacts).toHaveLength(1);
    expect(r.gateImpacts[0]).toMatchObject({ taskId: "g", gateName: "MP评审" });
    expect(r.hasImpact).toBe(true);
    expect(r.maxDeltaDays).toBeGreaterThan(0);
  });

  it("目标日新破：原本恰好按期、改后晚于目标 → targetBreach.newlyBreaches=true", () => {
    const current = generateSchedule(linear, START);
    const oldEnd = current.g.due;
    const r = computeDelayImpact({
      schedTasks: linear, current, changedTaskId: "a",
      newDates: { start: current.a.start, due: addWorkingDays(current.a.due, 10) },
      gateTaskIds: new Set(), targetDate: oldEnd,
    });
    expect(r.targetBreach).not.toBeNull();
    expect(r.targetBreach!.newlyBreaches).toBe(true);
    expect(r.targetBreach!.slipDays).toBeGreaterThan(0);
    expect(r.hasImpact).toBe(true);
  });

  it("目标日已破但未恶化：改非关键短支、结束日不变 → targetBreach=null、hasImpact=false", () => {
    const current = generateSchedule(branch, START);
    const oldEnd = current.e.due;
    const r = computeDelayImpact({
      schedTasks: branch, current, changedTaskId: "b",
      newDates: { start: current.b.start, due: addWorkingDays(current.b.due, 1) },
      gateTaskIds: new Set(), targetDate: addWorkingDays(oldEnd, -3),
    });
    expect(r.shifted.map((s) => s.taskId)).not.toContain("e");
    expect(r.targetBreach).toBeNull();
    expect(r.hasImpact).toBe(false);
  });

  it("targetDate=null → targetBreach=null", () => {
    const current = generateSchedule(linear, START);
    const r = computeDelayImpact({
      schedTasks: linear, current, changedTaskId: "a",
      newDates: { start: current.a.start, due: addWorkingDays(current.a.due, 10) },
      gateTaskIds: new Set(), targetDate: null,
    });
    expect(r.targetBreach).toBeNull();
  });
});
