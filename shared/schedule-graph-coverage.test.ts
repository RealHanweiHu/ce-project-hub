import { describe, it, expect } from "vitest";
import {
  SCHEDULE_GRAPH,
  buildSchedTasks,
  criticalPathTasksForProject,
  scheduleForCategory,
  scheduleForProject,
} from "./schedule-graph";
import {
  DERIVATIVE_PHASES,
  PROJECT_CATEGORIES,
  SOP_TEMPLATE_VERSION_CURRENT,
  SOP_TEMPLATE_VERSION_NPD_V3,
} from "./sop-templates";

/**
 * P0：每个有效任务必须通过模板内联字段或旧 SCHEDULE_GRAPH 定义排期。
 * 新动态模板优先使用内联工期/依赖，因为同一公共任务在不同项目轨道
 * 可以拥有不同入口依赖；旧模板继续从静态表回退。
 */
describe("SCHEDULE_GRAPH 全 category 覆盖", () => {
  for (const category of PROJECT_CATEGORIES) {
    it(`${category.id} 的每个任务都有工期与依赖定义`, () => {
      const missing: string[] = [];
      for (const phase of category.phases) {
        for (const task of phase.tasks) {
          if (task.durationDays === undefined && !SCHEDULE_GRAPH[task.id]) {
            missing.push(`${phase.id}/${task.id}`);
          }
        }
      }
      expect(missing, `缺排期定义: ${missing.join(", ")}`).toEqual([]);
    });

    it(`${category.id} 图中依赖都指向存在的任务（无悬空依赖）`, () => {
      const scheduled = buildSchedTasks(category.phases);
      const ids = new Set(scheduled.map((task) => task.id));
      const dangling: string[] = [];
      for (const task of scheduled) {
        for (const dep of task.dependsOn) {
          if (!ids.has(dep)) dangling.push(`${task.id}→${dep}`);
        }
      }
      expect(dangling, `悬空依赖: ${dangling.join(", ")}`).toEqual([]);
    });

    it(`${category.id} 排期链路真实展开（发布 gate 晚于首任务，非全同日）`, () => {
      const schedule = scheduleForCategory(category.id, "2026-03-02");
      const starts = new Set(Object.values(schedule).map((s) => s.start));
      // 缺图时所有任务都在同一天开始；正常图至少展开出多个开始日
      expect(starts.size).toBeGreaterThan(3);
      const releasePhase = category.phases.find((p) => p.isReleaseGate);
      if (releasePhase) {
        const gate = schedule[releasePhase.gateTaskId];
        const firstTask = schedule[category.phases[0].tasks[0].id];
        expect(gate).toBeDefined();
        expect(gate.start > firstTask.start).toBe(true);
      }
    });
  }

  it("DRV 保留投模、模具开发和 T1/T2 的关键依赖", () => {
    const ids = new Set(DERIVATIVE_PHASES.flatMap((p) => p.tasks.map((t) => t.id)));
    const depsOf = (taskId: string) => SCHEDULE_GRAPH[taskId].slice(1);

    expect([...ids]).toEqual(expect.arrayContaining([
      "drv_structure_design",
      "drv_structure_mold_review",
      "drv_structure_mold_development",
      "drv_structure_t1_t2_validation",
      "drv_common_dvt_gate",
    ]));
    expect(depsOf("drv_structure_mold_review")).toEqual(["drv_structure_design"]);
    expect(depsOf("drv_structure_mold_development")).toEqual(["drv_structure_mold_review"]);
    expect(depsOf("drv_structure_t1_t2_validation")).toEqual(
      expect.arrayContaining(["drv_common_evt_build", "drv_structure_mold_development"]),
    );
    expect(depsOf("drv_common_dvt_gate")).toContain("drv_common_dvt_issue_close");
  });
});

describe("project-aware schedule graph", () => {
  const liteBatteryProject = {
    category: "npd",
    sopTemplateVersion: SOP_TEMPLATE_VERSION_NPD_V3,
    customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
  };

  it("schedules lite-only and add-on tasks from the effective process", () => {
    const schedule = scheduleForProject(liteBatteryProject, "2026-03-02");
    expect(schedule.nle1).toBeDefined();
    expect(schedule.pb2).toBeDefined();
    expect(schedule.ne1).toBeUndefined();
  });

  it("computes a non-empty critical path contained by the effective task set", () => {
    const schedule = scheduleForProject(liteBatteryProject, "2026-03-02");
    const critical = criticalPathTasksForProject(liteBatteryProject);
    expect(critical.size).toBeGreaterThan(0);
    expect(Array.from(critical).every((taskId) => taskId in schedule)).toBe(true);
  });

  it("uses the frozen DRV module baseline without leaving dangling schedule dependencies", () => {
    const project = {
      category: "derivative",
      sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
      customFields: {
        projectExecutionBaseline: {
          modelVersion: "project-track-v1",
          status: "frozen",
          productDefinitionRef: "PSD-DRV-001",
          moduleReuse: {
            battery: "reused",
            core_function: "not_reused",
            electronics: "not_reused",
            software_connectivity: "not_reused",
            structure_mold: "not_reused",
            id_cmf: "not_reused",
          },
          reuseEvidence: {
            battery: {
              sourceRef: "existing-battery-platform",
              modelOrVersion: "BAT-v1",
              evidenceRef: "EV-BAT-001",
              boundaryConfirmed: true,
            },
          },
          frozenAt: "2026-07-15T10:00:00.000Z",
          frozenBy: 1,
        },
      },
    };
    const schedule = scheduleForProject(project, "2026-03-02");

    expect(schedule.drv_battery_design).toBeUndefined();
    expect(schedule.drv_common_dfm_validation_plan.start >= schedule.drv_common_kickoff_gate.due).toBe(true);
    for (const task of Object.values(schedule)) {
      expect(task.start).toBeTruthy();
      expect(task.due).toBeTruthy();
    }
    const critical = criticalPathTasksForProject(project);
    expect(Array.from(critical).every((taskId) => taskId in schedule)).toBe(true);
  });
});
