/**
 * 排期依赖收缩：任务被裁剪（skipped）后不能简单从排期域剔除——
 * 后继任务必须透传继承被裁任务的前置，否则"前置全被裁"的任务会回退到项目开始日（排期坍塌）。
 */
import { describe, it, expect } from "vitest";
import { generateSchedule, contractSchedTasks, type SchedTask } from "./scheduling";
import { buildSchedTasks } from "./schedule-graph";
import {
  SOP_TEMPLATE_VERSION_CURRENT,
  getDerivativePhasesForExecutionBaseline,
} from "./sop-templates";

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

  it("DRV 多模块复用后公共关键链仍按 Gate 保序，排期不坍塌", () => {
    const phases = getDerivativePhasesForExecutionBaseline({
      modelVersion: "project-track-v1",
      status: "frozen",
      productDefinitionRef: "PSD-DRV-001",
      moduleReuse: {
        battery: "reused",
        core_function: "not_reused",
        electronics: "reused",
        software_connectivity: "not_reused",
        structure_mold: "reused",
        id_cmf: "reused",
      },
      reuseEvidence: Object.fromEntries([
        "battery",
        "electronics",
        "structure_mold",
        "id_cmf",
      ].map((moduleId) => [moduleId, {
        sourceRef: `source-${moduleId}`,
        modelOrVersion: "v1",
        evidenceRef: `evidence-${moduleId}`,
        boundaryConfirmed: true,
      }])),
      frozenAt: "2026-07-15T10:00:00.000Z",
      frozenBy: 1,
    }, SOP_TEMPLATE_VERSION_CURRENT);
    const sched = generateSchedule(buildSchedTasks(phases), "2026-01-05");

    expect(sched.drv_battery_design).toBeUndefined();
    expect(sched.drv_common_dfm_validation_plan.start >= sched.drv_common_kickoff_gate.due).toBe(true);
    expect(sched.drv_common_evt_build.start >= sched.drv_common_design_gate.due).toBe(true);
    expect(
      sched.drv_common_software_function_validation.start >=
      sched.drv_software_special_validation.due
    ).toBe(true);
    expect(sched.drv_common_dvt_build.start >= sched.drv_common_evt_gate.due).toBe(true);
    expect(sched.drv_common_pvt_trial.start >= sched.drv_common_dvt_gate.due).toBe(true);
  });
});
