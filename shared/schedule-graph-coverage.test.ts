import { describe, it, expect } from "vitest";
import {
  SCHEDULE_GRAPH,
  criticalPathTasksForProject,
  scheduleForCategory,
  scheduleForProject,
} from "./schedule-graph";
import {
  DERIVATIVE_PHASES,
  DERIVATIVE_REUSE_MODULE_RULES,
  PROJECT_CATEGORIES,
  SOP_TEMPLATE_VERSION_NPD_V3,
} from "./sop-templates";

/**
 * P0：SCHEDULE_GRAPH 必须覆盖所有 category 的全部任务。
 * 缺失的任务会被 buildSchedTasks 按「工期 1 天、无依赖、阶段入口」兜底，
 * 导致整条赛道所有任务同一天开始——甘特图/关键路径/延期影响全部失真
 * （JDM/OBT 上线时就是这么漏的）。
 */
describe("SCHEDULE_GRAPH 全 category 覆盖", () => {
  for (const category of PROJECT_CATEGORIES) {
    it(`${category.id} 的每个任务都有工期与依赖定义`, () => {
      const missing: string[] = [];
      for (const phase of category.phases) {
        for (const task of phase.tasks) {
          if (!SCHEDULE_GRAPH[task.id]) missing.push(`${phase.id}/${task.id}`);
        }
      }
      expect(missing, `缺排期定义: ${missing.join(", ")}`).toEqual([]);
    });

    it(`${category.id} 图中依赖都指向存在的任务（无悬空依赖）`, () => {
      const ids = new Set(category.phases.flatMap((p) => p.tasks.map((t) => t.id)));
      const dangling: string[] = [];
      for (const phase of category.phases) {
        for (const task of phase.tasks) {
          const deps = (SCHEDULE_GRAPH[task.id]?.slice(1) ?? []) as string[];
          for (const dep of deps) {
            if (!ids.has(dep)) dangling.push(`${task.id}→${dep}`);
          }
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

    expect([...ids]).toEqual(expect.arrayContaining(["dd5", "dd7", "dd8", "dv2", "dv3", "dv7"]));
    expect(depsOf("dd7")).toEqual(expect.arrayContaining(["dd5", "dd6", "dd9"]));
    expect(depsOf("dd8")).toEqual(["dd7"]);
    expect(depsOf("dv2")).toEqual(["dd8"]);
    expect(depsOf("dv3")).toEqual(["dv2"]);
    expect(depsOf("dv7")).toContain("dv6");
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

  it("contracts derivative dependencies from the full graph after strategy tasks are removed", () => {
    const allDirectReuse = Object.fromEntries(
      DERIVATIVE_REUSE_MODULE_RULES.map((rule) => [rule.id, "direct_reuse"])
    );
    const project = {
      category: "derivative",
      customFields: { derivativeReuseStrategy: allDirectReuse },
    };
    const schedule = scheduleForProject(project, "2026-03-02");

    expect(schedule.dd1).toBeUndefined();
    expect(schedule.dd6.start >= schedule.di6.due).toBe(true);
    const critical = criticalPathTasksForProject(project);
    expect(Array.from(critical).every((taskId) => taskId in schedule)).toBe(true);
  });
});
