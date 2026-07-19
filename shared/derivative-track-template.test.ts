import { describe, expect, it } from "vitest";
import {
  DERIVATIVE_MODULE_TASK_IDS,
  SOP_TEMPLATE_VERSION_CURRENT,
  buildDerivativePhases,
  getDerivativePhasesForExecutionBaseline,
} from "./sop-templates";
import { TASK_DELIVERABLES } from "./task-deliverables";
import {
  PRODUCT_MODULE_IDS,
  type ModuleReuseState,
  type ProductModuleId,
} from "./project-track-tailoring";

const allNotReused: Record<ProductModuleId, ModuleReuseState> = {
  battery: "not_reused",
  core_function: "not_reused",
  electronics: "not_reused",
  software_connectivity: "not_reused",
  structure_mold: "not_reused",
  id_cmf: "not_reused",
};

const reuseEvidence = (moduleIds: ProductModuleId[]) =>
  Object.fromEntries(moduleIds.map((moduleId) => [moduleId, {
    sourceRef: `source-${moduleId}`,
    modelOrVersion: "v1",
    evidenceRef: `evidence-${moduleId}`,
    boundaryConfirmed: true,
  }]));

const frozenBaseline = (moduleReuse: Record<ProductModuleId, ModuleReuseState>) => ({
  modelVersion: "project-track-v1" as const,
  status: "frozen" as const,
  productDefinitionRef: "PSD-001",
  moduleReuse,
  reuseEvidence: reuseEvidence(
    PRODUCT_MODULE_IDS.filter((moduleId) => moduleReuse[moduleId] === "reused"),
  ),
  frozenAt: "2026-07-15T10:00:00.000Z",
  frozenBy: 1,
});

const taskIds = (phases: ReturnType<typeof buildDerivativePhases>) =>
  phases.flatMap((phase) => phase.tasks.map((task) => task.id));

describe("DRV 六模块动态模板", () => {
  it("保留 iteration/design/evt/dvt/pvt/mp 六阶段和发布、关闭 Gate", () => {
    const phases = buildDerivativePhases(allNotReused);

    expect(phases.map((phase) => phase.id)).toEqual([
      "iteration",
      "design",
      "evt",
      "dvt",
      "pvt",
      "mp",
    ]);
    expect(phases.filter((phase) => phase.isReleaseGate).map((phase) => phase.id)).toEqual([
      "pvt",
    ]);
    expect(phases.filter((phase) => phase.isCloseGate).map((phase) => phase.id)).toEqual([
      "mp",
    ]);
    expect(phases.at(-1)?.gateTaskId).toBe("project_close_review");
  });

  it("全不复用时包含公共任务和六个完整模块任务包", () => {
    const ids = new Set(taskIds(buildDerivativePhases(allNotReused)));

    for (const moduleId of PRODUCT_MODULE_IDS) {
      expect(DERIVATIVE_MODULE_TASK_IDS[moduleId].length, `${moduleId} 缺任务包`).toBeGreaterThan(0);
      for (const taskId of DERIVATIVE_MODULE_TASK_IDS[moduleId]) {
        expect(ids.has(taskId), `${moduleId} 缺 ${taskId}`).toBe(true);
      }
    }

    expect([...ids]).toEqual(
      expect.arrayContaining([
        "drv_common_product_baseline",
        "drv_common_project_plan",
        "drv_common_dfm_validation_plan",
        "drv_common_evt_build",
        "drv_common_system_regression",
        "drv_common_software_validation",
        "drv_common_reliability_test",
        "drv_common_safety_cert_test",
        "drv_common_accessory_confirm",
        "drv_common_packaging_validation",
        "drv_common_logistics_validation",
        "drv_common_fixture_confirmation",
        "drv_common_eol_program_confirm",
        "drv_common_pvt_trial",
        "drv_common_release_files",
      ]),
    );
  });

  it.each(PRODUCT_MODULE_IDS)("复用 %s 时只移除该模块任务包", (moduleId) => {
    const fullIds = new Set(taskIds(buildDerivativePhases(allNotReused)));
    const tailoredIds = new Set(
      taskIds(
        buildDerivativePhases({
          ...allNotReused,
          [moduleId]: "reused",
        }),
      ),
    );
    const removed = [...fullIds].filter((taskId) => !tailoredIds.has(taskId)).sort();
    const removedDeliverables = new Set(
      removed.flatMap((taskId) => TASK_DELIVERABLES[taskId] ?? []),
    );
    const tailoredDeliverables = new Set(
      buildDerivativePhases({ ...allNotReused, [moduleId]: "reused" }).flatMap((phase) => [
        ...phase.deliverables,
        ...phase.gateStandard.requiredDeliverables,
      ]),
    );

    expect(removed).toEqual([...DERIVATIVE_MODULE_TASK_IDS[moduleId]].sort());
    for (const deliverable of removedDeliverables) {
      expect(tailoredDeliverables.has(deliverable), `${moduleId} 仍要求 ${deliverable}`).toBe(false);
    }
    expect([...tailoredIds]).toEqual(
      expect.arrayContaining([
        "drv_common_system_regression",
        "drv_common_software_validation",
        "drv_common_reliability_test",
        "drv_common_safety_cert_test",
        "drv_common_packaging_validation",
        "drv_common_logistics_validation",
      ]),
    );
  });

  it("所有复用组合仍保留安全认证和 EOL 发布硬证据", () => {
    const phases = buildDerivativePhases({
      ...allNotReused,
      battery: "reused",
      core_function: "reused",
      electronics: "reused",
      software_connectivity: "reused",
    });
    const dvtRequired = phases.find((phase) => phase.id === "dvt")!.gateStandard
      .requiredDeliverables;
    const pvtRequired = phases.find((phase) => phase.id === "pvt")!.gateStandard
      .requiredDeliverables;

    expect(dvtRequired).toEqual(
      expect.arrayContaining([
        "安规与认证验证报告",
        "UN38.3运输测试报告或复用确认",
        "MSDS",
        "电芯/电池包安全认证报告或复用确认",
      ]),
    );
    expect(pvtRequired).toEqual(
      expect.arrayContaining([
        "EOL 100%测试能力验收记录",
        "认证与运输证据覆盖复核记录",
      ]),
    );
    expect(pvtRequired).not.toEqual(
      expect.arrayContaining([
        "UN38.3运输测试报告或复用确认",
        "MSDS",
        "电芯/电池包安全认证报告或复用确认",
      ]),
    );
  });

  it("软件不复用时公共软件验证等待软件专项验证，复用时只等待 EVT Build", () => {
    const fullSoftwareValidation = buildDerivativePhases(allNotReused)
      .flatMap((phase) => phase.tasks)
      .find((task) => task.id === "drv_common_software_validation");
    const reusedSoftwareValidation = buildDerivativePhases({
      ...allNotReused,
      software_connectivity: "reused",
    })
      .flatMap((phase) => phase.tasks)
      .find((task) => task.id === "drv_common_software_validation");

    expect(fullSoftwareValidation?.dependsOn).toEqual(["drv_software_special_validation"]);
    expect(reusedSoftwareValidation?.dependsOn).toEqual(["drv_common_evt_build"]);
  });

  it("运行时只接受完整冻结基线，非法或草稿状态一律回退全任务", () => {
    const valid = getDerivativePhasesForExecutionBaseline(
      frozenBaseline({ ...allNotReused, battery: "reused" }),
      SOP_TEMPLATE_VERSION_CURRENT,
    );
    expect(taskIds(valid)).not.toContain("drv_battery_design");

    for (const invalid of [
      { ...frozenBaseline({ ...allNotReused, battery: "reused" }), status: "draft" },
      frozenBaseline(allNotReused),
      frozenBaseline({ ...allNotReused, structure_mold: "reused", id_cmf: "not_reused" }),
      { ...frozenBaseline({ ...allNotReused, battery: "reused" }), frozenAt: "" },
    ]) {
      const ids = taskIds(getDerivativePhasesForExecutionBaseline(invalid, SOP_TEMPLATE_VERSION_CURRENT));
      for (const moduleId of PRODUCT_MODULE_IDS) {
        expect(ids, `非法基线仍裁掉 ${moduleId}`).toEqual(
          expect.arrayContaining([...DERIVATIVE_MODULE_TASK_IDS[moduleId]]),
        );
      }
    }
  });

  it("current 模板使用统一 Close 语义，不重复声明阶段交付物", () => {
    const mp = getDerivativePhasesForExecutionBaseline(
      frozenBaseline(allNotReused),
      SOP_TEMPLATE_VERSION_CURRENT,
    ).find((phase) => phase.id === "mp")!;

    expect(mp.deliverables).toEqual([]);
    expect(mp.gateStandard.requiredDeliverables).toEqual([]);
    expect(mp.gateStandard.exitCriteria.join(" ")).toContain("14 个自然日");
    expect(mp.tasks.map((task) => task.id)).toEqual([
      "stability_ramp",
      "stability_metrics",
      "stability_issues",
      "project_close_review",
    ]);
  });

  it("每个动态任务都有交付物，依赖不悬空，Gate 等待本阶段全部任务", () => {
    for (const phases of [
      buildDerivativePhases(allNotReused),
      buildDerivativePhases({ ...allNotReused, battery: "reused", electronics: "reused" }),
    ]) {
      const ids = new Set(taskIds(phases));
      for (const phase of phases) {
        const gate = phase.tasks.find((task) => task.id === phase.gateTaskId);
        expect(gate, `${phase.id} 缺 Gate task`).toBeDefined();
        expect(gate?.dependsOn).toEqual(
          expect.arrayContaining(
            phase.tasks.filter((task) => task.id !== phase.gateTaskId).map((task) => task.id),
          ),
        );
        for (const task of phase.tasks) {
          expect(task.id.length, `${task.id} 超过数据库 taskId 长度`).toBeLessThanOrEqual(32);
          expect(TASK_DELIVERABLES[task.id]?.length, `${task.id} 缺任务交付物`).toBeGreaterThan(0);
          for (const dependencyId of task.dependsOn ?? []) {
            expect(ids.has(dependencyId), `${task.id}→${dependencyId} 悬空`).toBe(true);
          }
        }
        const submitted = new Set(phase.deliverables);
        for (const required of phase.gateStandard.requiredDeliverables) {
          expect(submitted.has(required), `${phase.id} Gate 缺提交项 ${required}`).toBe(true);
        }
      }
    }
  });
});
