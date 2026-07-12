import { describe, expect, it } from "vitest";
import { NPD_V3_CORE_PHASES } from "./npd-v3";
import {
  PROJECT_CATEGORIES,
  SOP_TEMPLATE_VERSION_CURRENT,
  SOP_TEMPLATE_VERSION_LEGACY,
  getPhasesForCategory,
} from "./sop-templates";

const coreTasks = NPD_V3_CORE_PHASES.flatMap((phase) => phase.tasks);

describe("NPD v3 核心模板", () => {
  it("复杂度预算：核心恰好 25 个任务、7 个阶段、每阶段有 gateTaskId", () => {
    expect(coreTasks).toHaveLength(25);
    expect(NPD_V3_CORE_PHASES).toHaveLength(7);
    for (const phase of NPD_V3_CORE_PHASES) {
      expect(phase.tasks.some((task) => task.id === phase.gateTaskId)).toBe(true);
    }
  });

  it("任务 id 全局唯一，且不与任何既有 v1/v2 模板 id 冲突", () => {
    const versions = [SOP_TEMPLATE_VERSION_LEGACY, SOP_TEMPLATE_VERSION_CURRENT];
    const existing = new Set(
      PROJECT_CATEGORIES.flatMap((category) =>
        versions.flatMap((version) =>
          getPhasesForCategory(category.id, version).flatMap((phase) =>
            phase.tasks.map((task) => task.id)
          )
        )
      )
    );
    const seen = new Set<string>();
    for (const task of coreTasks) {
      expect(seen.has(task.id), `duplicate ${task.id}`).toBe(false);
      expect(existing.has(task.id), `collides with legacy ${task.id}`).toBe(false);
      seen.add(task.id);
    }
  });

  it("dependsOn 只引用核心模板内存在的 id", () => {
    const ids = new Set(coreTasks.map((task) => task.id));
    for (const task of coreTasks) {
      for (const dependencyId of task.dependsOn ?? []) {
        expect(ids.has(dependencyId), `${task.id} depends on missing ${dependencyId}`).toBe(true);
      }
    }
  });

  it("红线任务存在：npv2 / npv5 / nm1", () => {
    const ids = new Set(coreTasks.map((task) => task.id));
    for (const id of ["npv2", "npv5", "nm1"]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("非 gate 任务都有 evidence 标注", () => {
    const gateIds = new Set(NPD_V3_CORE_PHASES.map((phase) => phase.gateTaskId));
    for (const task of coreTasks) {
      if (!gateIds.has(task.id)) {
        expect(task.evidence, `${task.id} missing evidence`).toBeDefined();
      }
    }
  });
});
