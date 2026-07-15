import { describe, expect, it } from "vitest";
import {
  NPD_ADDON_PACKS,
  NPD_V3_CORE_PHASES,
  NPD_V3_LITE_PHASES,
  getEffectivePhasesForProjectLike,
  getTaskEvidenceLevel,
  getNpdV3RedlinePolicy,
  getNpdV3EffectivePhases,
  normalizeNpdTemplateConfig,
  recommendNpdTemplateConfig,
  type NpdTemplateConfig,
} from "./npd-v3";
import {
  DERIVATIVE_MODULE_TASK_IDS,
  PROJECT_CATEGORIES,
  SOP_TEMPLATE_VERSION_CURRENT,
  SOP_TEMPLATE_VERSION_LEGACY,
  SOP_TEMPLATE_VERSION_NPD_V3,
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

  it("项目级红线策略包含激活包、永久红线及其审计交付物", () => {
    const policy = getNpdV3RedlinePolicy({
      category: "npd",
      sopTemplateVersion: SOP_TEMPLATE_VERSION_NPD_V3,
      customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
    });

    expect(Array.from(policy.taskIds)).toEqual(
      expect.arrayContaining(["pb1", "pb2", "npv2", "npv5", "nm1"])
    );
    expect(policy.taskIds.has("pc1")).toBe(false);
    expect(Array.from(policy.auditDeliverables)).toEqual(expect.arrayContaining([
      "安全FMEA与危害分析",
      "UN38.3运输测试报告或复用确认",
      "EOL 100%测试能力验收记录",
      "SOP/WI作业指导书",
      "良率报告",
    ]));

    const certPolicy = getNpdV3RedlinePolicy({
      category: "npd",
      sopTemplateVersion: SOP_TEMPLATE_VERSION_NPD_V3,
      customFields: { npdTemplate: { tier: "standard", packs: ["cert"] } },
    });
    expect(Array.from(certPolicy.taskIds)).toEqual(expect.arrayContaining(["pc1", "pc2"]));
    expect(certPolicy.auditDeliverables.has("认证报告")).toBe(true);

    const legacyPolicy = getNpdV3RedlinePolicy({
      category: "npd",
      sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
    });
    expect(legacyPolicy.taskIds.size).toBe(0);
    expect(legacyPolicy.auditDeliverables.size).toBe(0);
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

describe("recommendNpdTemplateConfig 自动分档", () => {
  it("含锂电+出口 → 强监管(full)，电池/认证锁定", () => {
    const r = recommendNpdTemplateConfig({
      hasBattery: true, needsCert: true, hasFirmware: true, needsNewMold: false,
      safetyRiskLevel: "standard", regulatoryRiskLevel: "standard", isNewPlatform: false,
    });
    expect(r.tier).toBe("full");
    expect(r.packs).toEqual(expect.arrayContaining(["battery", "cert", "software"]));
    expect(r.lockedPacks).toEqual(["battery", "cert"]);
    expect(r.reasons.join("")).toContain("锂电");
  });

  it("高安全风险单独触发强监管", () => {
    const r = recommendNpdTemplateConfig({
      hasBattery: false, needsCert: false, hasFirmware: false, needsNewMold: false,
      safetyRiskLevel: "high", regulatoryRiskLevel: "standard", isNewPlatform: false,
    });
    expect(r.tier).toBe("full");
  });

  it("无电池无新模低风险简单新品 → 轻量", () => {
    const r = recommendNpdTemplateConfig({
      hasBattery: false, needsCert: false, hasFirmware: true, needsNewMold: false,
      safetyRiskLevel: "standard", regulatoryRiskLevel: "standard", isNewPlatform: false,
    });
    expect(r.tier).toBe("lite");
    expect(r.packs).toEqual(["software"]);
    expect(r.lockedPacks).toEqual([]);
  });

  it("其余落标准：有新模但风险 standard", () => {
    const r = recommendNpdTemplateConfig({
      hasBattery: false, needsCert: false, hasFirmware: false, needsNewMold: true,
      safetyRiskLevel: "standard", regulatoryRiskLevel: "standard", isNewPlatform: false,
    });
    expect(r.tier).toBe("standard");
    expect(r.packs).toEqual(["mold"]);
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

describe("v3 版本路由与项目级访问器", () => {
  it("按项目有效模板查询证据级别，未知任务与老模板回退 light", () => {
    const standard = {
      category: "npd",
      sopTemplateVersion: "2026-07-v3",
      customFields: { npdTemplate: { tier: "standard", packs: [] } },
    };
    expect(getTaskEvidenceLevel(standard, "planning", "np1")).toBe("heavy");
    expect(getTaskEvidenceLevel(standard, "planning", "np2")).toBe("light");
    expect(getTaskEvidenceLevel(
      {
        category: "npd",
        sopTemplateVersion: "2026-07-v3",
        customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
      },
      "design",
      "pb2",
    )).toBe("heavy");
    expect(getTaskEvidenceLevel(
      { category: "npd", sopTemplateVersion: "2026-07-v2" },
      "concept",
      "c1",
    )).toBe("light");
    expect(getTaskEvidenceLevel(standard, "nope", "nope")).toBe("light");
  });

  it("getPhasesForCategory 只把 NPD 2026-07-v3 路由到 25 项核心模板", () => {
    expect(countTasks(getPhasesForCategory("npd", "2026-07-v3"))).toBe(25);
    expect(getPhasesForCategory("eco", "2026-07-v3")).toEqual(getPhasesForCategory("eco"));
  });

  it("NPD v1/v2 存量模板保持原任务数", () => {
    expect(countTasks(getPhasesForCategory("npd", "2026-07-v1"))).toBe(55);
    expect(countTasks(getPhasesForCategory("npd", "2026-07-v2"))).toBe(53);
  });

  it("项目级访问器仅对 v3 NPD 应用档位和附加包", () => {
    const v3 = getEffectivePhasesForProjectLike({
      category: "npd",
      sopTemplateVersion: "2026-07-v3",
      customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
    });
    expect(countTasks(v3)).toBe(17);
    const v2 = getEffectivePhasesForProjectLike({
      category: "npd",
      sopTemplateVersion: "2026-07-v2",
      customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
    });
    expect(countTasks(v2)).toBe(53);
  });

  it("相同档位/包组合返回同一份冻结阶段数组", () => {
    const first = getNpdV3EffectivePhases({
      tier: "lite",
      packs: ["battery", "cert"],
    });
    const second = getNpdV3EffectivePhases({
      tier: "lite",
      packs: ["cert", "battery", "battery"],
    });
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0].tasks)).toBe(true);
  });

  it("项目级访问器只按冻结二元基线移除对应 DRV 模块包", () => {
    const phases = getEffectivePhasesForProjectLike({
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
              sourceRef: "BAT-PLATFORM",
              modelOrVersion: "v1",
              evidenceRef: "EV-BAT-001",
              boundaryConfirmed: true,
            },
          },
          frozenAt: "2026-07-15T10:00:00.000Z",
          frozenBy: 1,
        },
      },
    });
    const ids = phases.flatMap((phase) => phase.tasks.map((task) => task.id));
    expect(countTasks(phases)).toBe(
      countTasks(getPhasesForCategory("derivative", SOP_TEMPLATE_VERSION_CURRENT)) -
      DERIVATIVE_MODULE_TASK_IDS.battery.length,
    );
    expect(ids).not.toEqual(expect.arrayContaining([...DERIVATIVE_MODULE_TASK_IDS.battery]));
    expect(ids).toEqual(expect.arrayContaining([
      ...DERIVATIVE_MODULE_TASK_IDS.core_function,
      "drv_common_safety_certification_validation",
    ]));
  });
});
