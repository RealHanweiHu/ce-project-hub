/**
 * 排期依赖收缩：任务被裁剪（skipped）后不能简单从排期域剔除——
 * 后继任务必须透传继承被裁任务的前置，否则"前置全被裁"的任务会回退到项目开始日（排期坍塌）。
 */
import { describe, it, expect } from "vitest";
import { generateSchedule, contractSchedTasks, type SchedTask } from "./scheduling";
import { buildSchedTasks } from "./schedule-graph";
import { getPhasesForCategory, getDerivativeEffectiveTaskIds, DERIVATIVE_REUSE_MODULE_RULES } from "./sop-templates";

describe("contractSchedTasks", () => {
  it("被裁任务的前置透传给后继：A→B→C 裁 B 后 C 依赖 A", () => {
    const tasks: SchedTask[] = [
      { id: "A", durationDays: 2, dependsOn: [] },
      { id: "B", durationDays: 3, dependsOn: ["A"] },
      { id: "C", durationDays: 1, dependsOn: ["B"] },
    ];
    const out = contractSchedTasks(tasks, new Set(["A", "C"]));
    expect(out.map((t) => t.id).sort()).toEqual(["A", "C"]);
    expect(out.find((t) => t.id === "C")!.dependsOn).toEqual(["A"]);

    const sched = generateSchedule(out, "2026-01-05");
    // C 必须排在 A 完成之后，而不是回退到开始日
    expect(sched.C.start >= sched.A.due).toBe(true);
    expect(sched.C.start > "2026-01-05").toBe(true);
  });

  it("多级收缩与去重：A→B→C→D 裁 B、C 后 D 依赖 A 且不重复", () => {
    const tasks: SchedTask[] = [
      { id: "A", durationDays: 1, dependsOn: [] },
      { id: "B", durationDays: 1, dependsOn: ["A"] },
      { id: "C", durationDays: 1, dependsOn: ["B", "A"] },
      { id: "D", durationDays: 1, dependsOn: ["C"] },
    ];
    const out = contractSchedTasks(tasks, new Set(["A", "D"]));
    expect(out.find((t) => t.id === "D")!.dependsOn).toEqual(["A"]);
  });

  it("环安全：被裁任务成环时不死循环", () => {
    const tasks: SchedTask[] = [
      { id: "A", durationDays: 1, dependsOn: ["C"] },
      { id: "B", durationDays: 1, dependsOn: ["A"] },
      { id: "C", durationDays: 1, dependsOn: ["B"] },
      { id: "D", durationDays: 1, dependsOn: ["C"] },
    ];
    const out = contractSchedTasks(tasks, new Set(["D"]));
    expect(out.find((t) => t.id === "D")!.dependsOn).toEqual([]);
  });

  it("DRV 全模块直接复用：dd6 不早于 di6（立项评审）完成，排期不坍塌", () => {
    const allDirectReuse = Object.fromEntries(
      DERIVATIVE_REUSE_MODULE_RULES.map((r) => [r.id, "direct_reuse"])
    );
    const keep = getDerivativeEffectiveTaskIds(allDirectReuse);
    const full = buildSchedTasks(getPhasesForCategory("derivative"));
    const out = contractSchedTasks(full, keep);
    const sched = generateSchedule(out, "2026-01-05");

    // 坍塌症状：dd6 前置 dd1-dd5/dd9 全被裁后回退到项目开始日
    expect(sched.dd6.start >= sched.di6.due).toBe(true);
    // 链条整体保序（用恒留任务断言）：设计冻结 dd10 → EVT 整机回归 de3 → DVT 评审 dv7 → PVT dp1
    expect(sched.de3.start >= sched.dd10.due).toBe(true);
    expect(sched.dp1.start >= sched.dv7.due).toBe(true);
  });
});
