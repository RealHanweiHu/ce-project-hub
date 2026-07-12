import { describe, expect, it } from "vitest";
import { buildSchedTasks } from "./schedule-graph";
import { getNpdV3EffectivePhases } from "./npd-v3";

describe("NPD v3 schedule graph", () => {
  it("优先使用模板内联工期和依赖，不把 v3 新任务退化成 1 天无依赖", () => {
    const phases = getNpdV3EffectivePhases({
      tier: "lite",
      packs: ["battery", "cert", "software", "mold"],
    });
    const tasks = new Map(buildSchedTasks(phases).map((task) => [task.id, task]));

    expect(tasks.get("nlc1")?.durationDays).toBe(10);
    expect(tasks.get("pc2")?.durationDays).toBe(20);
    expect(tasks.get("pc2")?.dependsOn).toEqual(["nle1"]);
    expect(tasks.get("nv3")?.dependsOn).toEqual(
      expect.arrayContaining(["nle1", "nv2", "pc2", "ps2", "pmo1"]),
    );
  });

  it("显式 0 天和空依赖也覆盖旧静态图", () => {
    const [task] = buildSchedTasks([{
      id: "concept",
      tasks: [{ id: "c1", durationDays: 0, dependsOn: [] }],
    }]);
    expect(task.durationDays).toBe(0);
    expect(task.dependsOn).toEqual([]);
  });
});
