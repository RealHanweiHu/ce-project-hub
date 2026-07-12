import { describe, expect, it } from "vitest";
import {
  NPD_ADDON_PACKS,
  NPD_V3_CORE_PHASES,
  NPD_V3_LITE_PHASES,
  getNpdV3EffectivePhases,
  normalizeNpdTemplateConfig,
  type NpdTemplateConfig,
} from "./npd-v3";
import {
  PROJECT_CATEGORIES,
  SOP_TEMPLATE_VERSION_CURRENT,
  SOP_TEMPLATE_VERSION_LEGACY,
  getPhasesForCategory,
} from "./sop-templates";
import { getDeliverableTemplatePath } from "./deliverable-templates";
import { TASK_DELIVERABLES } from "./task-deliverables";

const coreTasks = NPD_V3_CORE_PHASES.flatMap((phase) => phase.tasks);
const countTasks = (phases: { tasks: unknown[] }[]) =>
  phases.reduce((total, phase) => total + phase.tasks.length, 0);

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

describe("NPD v3 附加包与档位", () => {
  it("四个包共 7 个任务；battery/cert 标红线", () => {
    expect(NPD_ADDON_PACKS.flatMap((pack) => pack.tasks)).toHaveLength(7);
    expect(NPD_ADDON_PACKS.find((pack) => pack.id === "battery")?.redline).toBe(true);
    expect(NPD_ADDON_PACKS.find((pack) => pack.id === "cert")?.redline).toBe(true);
    expect(NPD_ADDON_PACKS.find((pack) => pack.id === "software")?.redline).toBeFalsy();
  });

  it("轻量档 15 任务、6 阶段，且三条核心红线保留", () => {
    expect(countTasks(NPD_V3_LITE_PHASES)).toBe(15);
    expect(NPD_V3_LITE_PHASES.map((phase) => phase.id)).toEqual([
      "concept",
      "planning",
      "design",
      "verification",
      "pvt",
      "mp",
    ]);
    const ids = new Set(NPD_V3_LITE_PHASES.flatMap((phase) => phase.tasks.map((task) => task.id)));
    for (const id of ["npv2", "npv5", "nm1"]) expect(ids.has(id)).toBe(true);
    for (const id of ["nlc1", "nlp1", "nld3", "nle1", "nlpv1"]) expect(ids.has(id)).toBe(true);
    for (const id of ["nc1", "nc2", "np1", "np2", "nd3", "nd4", "ne1", "ne2", "nv1", "npv1", "npv3", "npv4"]) {
      expect(ids.has(id), `lite should not reuse merged core id ${id}`).toBe(false);
    }
    expect(ids.has("ne3")).toBe(false);
    expect(NPD_V3_LITE_PHASES.find((phase) => phase.id === "planning")?.gateStandard.requiredDeliverables)
      .toEqual(["产品需求文档 PRD", "BOM v0.1"]);
    expect(NPD_V3_LITE_PHASES.find((phase) => phase.id === "design")?.gateStandard.requiredDeliverables)
      .toEqual(["结构 3D 设计", "EE 原理图 & PCB Layout"]);
    expect(NPD_V3_LITE_PHASES.find((phase) => phase.id === "verification")?.gateStandard.requiredDeliverables)
      .toEqual(["功能/性能测试报告", "可靠性测试报告"]);
  });

  it("复杂度预算：standard=25、常规双红线包=29、四包全开=32", () => {
    expect(countTasks(getNpdV3EffectivePhases({ tier: "standard", packs: [] }))).toBe(25);
    expect(countTasks(getNpdV3EffectivePhases({ tier: "standard", packs: ["battery", "cert"] }))).toBe(29);
    expect(
      countTasks(
        getNpdV3EffectivePhases({
          tier: "full",
          packs: ["battery", "cert", "software", "mold"],
        })
      )
    ).toBe(32);
  });

  it("包任务插在目标阶段 Gate 前，并成为 Gate 前置", () => {
    const phases = getNpdV3EffectivePhases({ tier: "standard", packs: ["battery"] });
    const planning = phases.find((phase) => phase.id === "planning")!;
    const ids = planning.tasks.map((task) => task.id);
    expect(ids.indexOf("pb1")).toBeLessThan(ids.indexOf("np3"));
    expect(planning.tasks.find((task) => task.id === "np3")?.dependsOn).toContain("pb1");
    expect(planning.gateStandard.requiredDeliverables).toContain("电芯厂质量审核或复用资质确认");
  });

  it("lite + battery：pb1/pb2 落到对应阶段，共 17 个任务", () => {
    const phases = getNpdV3EffectivePhases({ tier: "lite", packs: ["battery"] });
    expect(countTasks(phases)).toBe(17);
    expect(phases.find((phase) => phase.id === "planning")?.tasks.map((task) => task.id)).toContain("pb1");
    expect(phases.find((phase) => phase.id === "design")?.tasks.map((task) => task.id)).toContain("pb2");
  });

  it("lite 把 DVT 包任务和 Gate 必交物映射到 verification", () => {
    const phases = getNpdV3EffectivePhases({
      tier: "lite",
      packs: ["cert", "software", "mold"],
    });
    const verification = phases.find((phase) => phase.id === "verification")!;
    expect(verification.tasks.map((task) => task.id)).toEqual(
      expect.arrayContaining(["pc2", "ps2", "pmo1"])
    );
    expect(verification.gateStandard.requiredDeliverables).toEqual(
      expect.arrayContaining(["认证报告", "软件完整测试报告", "模具T1样品"])
    );
    expect(verification.tasks.find((task) => task.id === "nv3")?.dependsOn).toEqual(
      expect.arrayContaining(["pc2", "ps2", "pmo1"])
    );
  });

  it("每种档位/附加包组合的 dependsOn 都引用生效任务", () => {
    const tiers = ["lite", "standard", "full"] as const;
    const packCombos = [
      [],
      ["battery"],
      ["cert"],
      ["software"],
      ["mold"],
      ["battery", "cert", "software", "mold"],
    ] as const;
    for (const tier of tiers) {
      for (const packs of packCombos) {
        const phases = getNpdV3EffectivePhases({ tier, packs: [...packs] });
        const ids = new Set(phases.flatMap((phase) => phase.tasks.map((task) => task.id)));
        for (const task of phases.flatMap((phase) => phase.tasks)) {
          for (const dependencyId of task.dependsOn ?? []) {
            expect(ids.has(dependencyId), `${tier}/${packs.join("+")}/${task.id} -> ${dependencyId}`).toBe(true);
          }
        }
      }
    }
  });

  it("normalize：非法值回退 standard/空包并去重", () => {
    expect(normalizeNpdTemplateConfig(undefined)).toEqual({ tier: "standard", packs: [] });
    expect(
      normalizeNpdTemplateConfig({
        tier: "x",
        packs: ["nope", "battery", "battery"],
      } as unknown as NpdTemplateConfig)
    ).toEqual({ tier: "standard", packs: ["battery"] });
  });
});

describe("NPD v3 交付物词表", () => {
  it("每个核心、轻量和附加包非 Gate 任务都有交付物", () => {
    const phases = [...NPD_V3_CORE_PHASES, ...NPD_V3_LITE_PHASES];
    const gateIds = new Set(phases.map((phase) => phase.gateTaskId));
    const tasks = [
      ...phases.flatMap((phase) => phase.tasks),
      ...NPD_ADDON_PACKS.flatMap((pack) => pack.tasks.map((entry) => entry.task)),
    ];
    for (const task of tasks) {
      if (gateIds.has(task.id)) continue;
      expect(TASK_DELIVERABLES[task.id]?.length, `missing deliverables for ${task.id}`)
        .toBeGreaterThan(0);
    }
  });

  it("合并任务只要求合并后的单一证据，不复活被瘦身的旧交付物", () => {
    expect(TASK_DELIVERABLES.nc1).toEqual(["立项申请书"]);
    expect(TASK_DELIVERABLES.np1).toEqual(["产品需求文档 PRD"]);
    expect(TASK_DELIVERABLES.np2).toEqual(["BOM v0.1"]);
    expect(TASK_DELIVERABLES.ne2).toEqual(["功能/性能测试报告"]);
    expect(TASK_DELIVERABLES.nlc1).toEqual(["立项申请书"]);
    expect(TASK_DELIVERABLES.nlp1).toEqual(["产品需求文档 PRD", "BOM v0.1"]);
    expect(TASK_DELIVERABLES.nld3).toEqual(["EE 原理图 & PCB Layout"]);
    expect(TASK_DELIVERABLES.nle1).toEqual(["Build Record", "功能/性能测试报告"]);
    expect(TASK_DELIVERABLES.nlpv1).toEqual([
      "SOP/WI作业指导书",
      "包装与物流验证报告",
      "良率报告",
    ]);
    const planning = NPD_V3_CORE_PHASES.find((phase) => phase.id === "planning")!;
    expect(planning.deliverables).toEqual(["产品需求文档 PRD", "BOM v0.1"]);
    expect(planning.gateStandard.requiredDeliverables).toEqual(["产品需求文档 PRD", "BOM v0.1"]);
    const evt = NPD_V3_CORE_PHASES.find((phase) => phase.id === "evt")!;
    expect(evt.deliverables).toEqual(["EVT 样机", "功能/性能测试报告"]);
    expect(evt.gateStandard.requiredDeliverables).toEqual(["功能/性能测试报告"]);
  });

  it("v3 阶段、Gate 和任务引用的每个交付物都有现成模板", () => {
    for (const config of [
      { tier: "standard", packs: ["battery", "cert", "software", "mold"] },
      { tier: "lite", packs: ["battery", "cert", "software", "mold"] },
    ] as const) {
      for (const phase of getNpdV3EffectivePhases(config)) {
        const names = new Set([
          ...phase.deliverables,
          ...phase.gateStandard.requiredDeliverables,
          ...phase.tasks.flatMap((task) => TASK_DELIVERABLES[task.id] ?? []),
        ]);
        for (const name of names) {
          expect(getDeliverableTemplatePath(name), `${config.tier}/${phase.id}: ${name}`).not.toBeNull();
        }
      }
    }
  });
});
