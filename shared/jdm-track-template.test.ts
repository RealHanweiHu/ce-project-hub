import { describe, expect, it } from "vitest";
import {
  DERIVATIVE_MODULE_TASK_IDS,
  SOP_TEMPLATE_VERSION_CURRENT,
  getJdmPhasesForModuleReuse,
  type SOPPhase,
  type SOPTask,
} from "./sop-templates";
import { getEffectivePhasesForProjectLike } from "./npd-v3";
import { computeGateReadiness } from "./gate-readiness";
import {
  PRODUCT_MODULE_IDS,
  type ModuleReuseState,
  type ProductModuleId,
  type ProjectExecutionBaseline,
} from "./project-track-tailoring";
import { TASK_DELIVERABLES } from "./task-deliverables";

const allNotReused: Record<ProductModuleId, ModuleReuseState> = {
  battery: "not_reused",
  core_function: "not_reused",
  electronics: "not_reused",
  software_connectivity: "not_reused",
  structure_mold: "not_reused",
  id_cmf: "not_reused",
};

function reuseModules(
  ...moduleIds: ProductModuleId[]
): Record<ProductModuleId, ModuleReuseState> {
  const result = { ...allNotReused };
  for (const moduleId of moduleIds) result[moduleId] = "reused";
  return result;
}

function frozenJdmBaseline(
  moduleReuse: Record<ProductModuleId, ModuleReuseState>,
): ProjectExecutionBaseline {
  return {
    modelVersion: "project-track-v1",
    status: "frozen",
    customerConceptRef: "客户 ID 概念图 2026-07-15",
    productDefinitionRef: "PSD-JDM-001",
    moduleReuse,
    reuseEvidence: Object.fromEntries(
      PRODUCT_MODULE_IDS
        .filter((moduleId) => moduleReuse[moduleId] === "reused")
        .map((moduleId) => [moduleId, {
          sourceRef: `source-${moduleId}`,
          modelOrVersion: "V1",
          evidenceRef: `EV-${moduleId}`,
          boundaryConfirmed: true,
        }]),
    ),
    frozenAt: "2026-07-15T12:00:00.000Z",
    frozenBy: 1001,
  };
}

const draftJdmBaseline: ProjectExecutionBaseline = {
  modelVersion: "project-track-v1",
  status: "draft",
  customerConceptRef: "客户 ID 概念图 2026-07-15",
};

function resolveJdmPhases(baseline: ProjectExecutionBaseline): SOPPhase[] {
  return getEffectivePhasesForProjectLike({
    category: "jdm",
    sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
    customFields: { projectExecutionBaseline: baseline },
  });
}

const phaseTaskIds = (phases: SOPPhase[]) =>
  phases.flatMap((phase) => phase.tasks.map((task) => task.id));

const taskText = (task: SOPTask) =>
  [task.id, task.name, task.desc, task.guide].filter(Boolean).join(" ");

describe("JDM 两段式动态模板", () => {
  it("draft 基线只返回 input 产品定义阶段", () => {
    const phases = resolveJdmPhases(draftJdmBaseline);

    expect(phases.map((phase) => phase.id)).toEqual(["input"]);
    expect(phases[0]?.isReleaseGate).not.toBe(true);
    expect(phases[0]?.isCloseGate).not.toBe(true);
  });

  it("冻结基线返回 input/design/evt/dvt/pvt/mp 六阶段", () => {
    const phases = resolveJdmPhases(frozenJdmBaseline(allNotReused));

    expect(phases.map((phase) => phase.id)).toEqual([
      "input",
      "design",
      "evt",
      "dvt",
      "pvt",
      "mp",
    ]);
    expect(phases.filter((phase) => phase.isReleaseGate).map((phase) => phase.id))
      .toEqual(["pvt"]);
    expect(phases.filter((phase) => phase.isCloseGate).map((phase) => phase.id))
      .toEqual(["mp"]);
  });

  it("P1 在设计前强制我方规格、CSR、风险、模块草稿和客户书面确认", () => {
    const input = resolveJdmPhases(draftJdmBaseline)[0]!;
    const texts = input.tasks.map(taskText);

    expect(
      texts.some((text) =>
        /我方.{0,12}(产品规格|规格书)|(产品规格|规格书).{0,12}(编制|形成)|(编制|形成).{0,12}(产品规格|规格书)/.test(text),
      ),
      "P1 缺我方编制产品规格书任务",
    ).toBe(true);
    expect(
      texts.some((text) => /CSR|客户特殊要求/.test(text)),
      "P1 缺客户特殊要求（CSR）任务",
    ).toBe(true);
    expect(input.gateStandard.requiredDeliverables).toContain(
      "客户特殊要求清单 CSR",
    );
    expect(
      texts.some((text) => /风险声明|安全.{0,8}法规.{0,8}(评估|风险)|认证路径/.test(text)),
      "P1 缺风险声明与安全/法规路径任务",
    ).toBe(true);
    expect(
      texts.some((text) =>
        /模块.{0,12}(复用|基线|草稿)|(复用|基线).{0,12}模块/.test(text),
      ),
      "P1 缺六模块复用草稿任务",
    ).toBe(true);

    const gate = input.tasks.find((task) => task.id === input.gateTaskId);
    expect(gate, "P1 缺产品定义 Gate task").toBeDefined();
    expect(taskText(gate!)).toMatch(
      /客户.{0,16}(书面确认|签字|签核)|(书面确认|签字|签核).{0,16}客户/,
    );
    expect([
      ...input.deliverables,
      ...input.gateStandard.requiredDeliverables,
    ].join(" ")).toMatch(/客户.{0,16}(确认|签字|签核)|(确认|签字|签核).{0,16}客户/);

    const withoutCsr = input.gateStandard.requiredDeliverables.filter(
      deliverable => deliverable !== "客户特殊要求清单 CSR",
    );
    const readiness = computeGateReadiness({
      phaseId: input.id,
      gateName: input.gate,
      prereq: { incompleteTaskIds: [] },
      deliverables: {
        required: input.gateStandard.requiredDeliverables,
        uploaded: withoutCsr,
      },
      criticalIssues: { titles: [] },
      latestReview: null,
    });
    expect(readiness.ready).toBe(false);
    expect(
      readiness.dimensions.find(dimension => dimension.dimension === "deliverables")
        ?.blockers,
    ).toContain("客户特殊要求清单 CSR");
  });

  it("JDM 定义任务替代 DRV 产品基线，不重复派发同义任务", () => {
    const ids = phaseTaskIds(resolveJdmPhases(frozenJdmBaseline(allNotReused)));

    expect(ids).toContain("jdm_product_spec");
    expect(ids).toContain("jdm_product_definition_gate");
    expect(ids).not.toContain("drv_common_product_baseline");
    expect(ids).not.toContain("drv_common_kickoff_gate");
  });

  it("设计、EVT、DVT、Golden Sample 和量产放行都有独立客户确认任务", () => {
    const ids = phaseTaskIds(resolveJdmPhases(frozenJdmBaseline(allNotReused)));

    expect(ids).toEqual(expect.arrayContaining([
      "jdm_customer_design_confirm",
      "jdm_customer_evt_confirm",
      "jdm_customer_dvt_confirm",
      "jdm_customer_golden_confirm",
      "jdm_customer_release_confirm",
    ]));
  });

  it("共享组合器拒绝非法或不完整的六模块状态", () => {
    expect(() =>
      getJdmPhasesForModuleReuse({
        ...allNotReused,
        structure_mold: "reused",
        id_cmf: "not_reused",
      }),
    ).toThrow(/ID\/CMF 不复用.*结构\/模具.*不复用/);

    const missingBattery = { ...allNotReused } as Partial<
      Record<ProductModuleId, ModuleReuseState>
    >;
    delete missingBattery.battery;
    expect(() =>
      getJdmPhasesForModuleReuse(
        missingBattery as Record<ProductModuleId, ModuleReuseState>,
      ),
    ).toThrow(/battery 缺少复用状态/);
  });

  it("current P6 使用 JDM 客户移交语义", () => {
    const mp = resolveJdmPhases(frozenJdmBaseline(allNotReused)).find(
      phase => phase.id === "mp",
    )!;

    expect(mp.name).toBe("量产稳定与客户移交");
    expect(`${mp.desc} ${mp.gate}`).toContain("客户");
    expect(mp.isCloseGate).toBe(true);
  });

  it.each(PRODUCT_MODULE_IDS)("冻结后复用 %s 只移除该模块任务包", (moduleId) => {
    // 结构复用要求 ID/CMF 也复用；先以 ID/CMF 已复用为合法对照，
    // 再单独观察新增“结构复用”带来的任务差量。
    const baseReuse = moduleId === "structure_mold"
      ? reuseModules("id_cmf")
      : allNotReused;
    const tailoredReuse = {
      ...baseReuse,
      [moduleId]: "reused" as const,
    };
    const fullIds = new Set(
      phaseTaskIds(resolveJdmPhases(frozenJdmBaseline(baseReuse))),
    );
    const tailoredIds = new Set(
      phaseTaskIds(resolveJdmPhases(frozenJdmBaseline(tailoredReuse))),
    );
    const removed = [...fullIds]
      .filter((taskId) => !tailoredIds.has(taskId))
      .sort();

    expect([...fullIds]).toEqual(
      expect.arrayContaining([...DERIVATIVE_MODULE_TASK_IDS[moduleId]]),
    );
    expect(removed).toEqual([...DERIVATIVE_MODULE_TASK_IDS[moduleId]].sort());
  });

  it("模块复用不移除软件、可靠性、安规、包装、物流、配件、治具和 EOL 公共任务", () => {
    const phases = resolveJdmPhases(
      frozenJdmBaseline(
        reuseModules(
          "battery",
          "core_function",
          "electronics",
          "software_connectivity",
        ),
      ),
    );
    const ids = phaseTaskIds(phases);

    expect(ids).toEqual(expect.arrayContaining([
      "drv_common_software_validation",
      "drv_common_reliability_test",
      "drv_common_safety_cert_test",
      "drv_common_packaging_validation",
      "drv_common_logistics_validation",
      "drv_common_accessory_confirm",
      "drv_common_fixture_confirmation",
      "drv_common_eol_program_confirm",
    ]));
  });

  it("动态任务、依赖、Gate 和交付物引用均不悬空", () => {
    for (const phases of [
      resolveJdmPhases(frozenJdmBaseline(allNotReused)),
      resolveJdmPhases(
        frozenJdmBaseline(reuseModules("battery", "electronics")),
      ),
    ]) {
      const tasks = phases.flatMap((phase) => phase.tasks);
      const ids = new Set(tasks.map((task) => task.id));
      expect(ids.size, "JDM taskId 必须全局唯一").toBe(tasks.length);

      const phaseIndexByTaskId = new Map<string, number>();
      phases.forEach((phase, phaseIndex) => {
        phase.tasks.forEach((task) => phaseIndexByTaskId.set(task.id, phaseIndex));
      });

      for (const [phaseIndex, phase] of phases.entries()) {
        const gate = phase.tasks.find((task) => task.id === phase.gateTaskId);
        expect(gate, `${phase.id} 缺 Gate task`).toBeDefined();
        expect(gate?.dependsOn, `${phase.id} Gate 未等待本阶段任务`).toEqual(
          expect.arrayContaining(
            phase.tasks
              .filter((task) => task.id !== phase.gateTaskId)
              .map((task) => task.id),
          ),
        );

        const taskDeliverables = new Set(
          phase.tasks.flatMap((task) => TASK_DELIVERABLES[task.id] ?? []),
        );
        for (const task of phase.tasks) {
          expect(task.id.length, `${task.id} 超过数据库 taskId 长度`)
            .toBeLessThanOrEqual(32);
          expect(TASK_DELIVERABLES[task.id]?.length, `${task.id} 缺任务交付物`)
            .toBeGreaterThan(0);
          for (const dependencyId of task.dependsOn ?? []) {
            expect(ids.has(dependencyId), `${task.id}→${dependencyId} 依赖悬空`)
              .toBe(true);
            expect(
              phaseIndexByTaskId.get(dependencyId),
              `${task.id}→${dependencyId} 依赖阶段未知`,
            ).toBeLessThanOrEqual(phaseIndex);
          }
        }

        for (const deliverable of phase.deliverables) {
          expect(
            taskDeliverables.has(deliverable),
            `${phase.id} 阶段交付物无任务产出：${deliverable}`,
          ).toBe(true);
        }
        const submitted = new Set(phase.deliverables);
        for (const required of phase.gateStandard.requiredDeliverables) {
          expect(
            submitted.has(required),
            `${phase.id} Gate 必交付物未进入提交集：${required}`,
          ).toBe(true);
        }
      }
    }
  });
});
