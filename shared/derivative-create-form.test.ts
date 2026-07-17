import { describe, expect, it } from "vitest";
import {
  DERIVATIVE_MODULE_TASK_IDS,
  SOP_TEMPLATE_VERSION_CURRENT,
  getDerivativePhasesForExecutionBaseline,
} from "@shared/sop-templates";
import {
  PRODUCT_MODULE_IDS,
  type ModuleReuseState,
  type ProductModuleId,
} from "./project-track-tailoring";
import {
  EMPTY_DERIVATIVE_MODULE_REUSE,
  buildDerivativeExecutionBaseline,
  createEmptyDerivativeReuseEvidence,
  getDerivativeTaskPreview,
  updateDerivativeModuleReuse,
  validateDerivativeCreateBaseline,
} from "../client/src/lib/derivative-create";

describe("DRV create form model", () => {
  it("默认六模块均不复用，并预览完整任务", () => {
    const preview = getDerivativeTaskPreview(EMPTY_DERIVATIVE_MODULE_REUSE);

    expect(preview.reusedModuleCount).toBe(0);
    expect(preview.moduleTaskCount).toBe(
      Object.values(DERIVATIVE_MODULE_TASK_IDS)
        .reduce((total, taskIds) => total + taskIds.length, 0),
    );
    expect(preview.totalTaskCount).toBe(
      preview.publicTaskCount + preview.moduleTaskCount,
    );
  });

  it("复用一个模块只减少该模块任务包，公共任务数不变", () => {
    const full = getDerivativeTaskPreview(EMPTY_DERIVATIVE_MODULE_REUSE);
    const batteryReused = getDerivativeTaskPreview({
      ...EMPTY_DERIVATIVE_MODULE_REUSE,
      battery: "reused",
    });

    expect(batteryReused.publicTaskCount).toBe(full.publicTaskCount);
    expect(full.totalTaskCount - batteryReused.totalTaskCount)
      .toBe(DERIVATIVE_MODULE_TASK_IDS.battery.length);
  });

  it.each(PRODUCT_MODULE_IDS)("复用 %s 时预览只减少对应模块任务", moduleId => {
    const full = getDerivativeTaskPreview(EMPTY_DERIVATIVE_MODULE_REUSE);
    const tailored = getDerivativeTaskPreview({
      ...EMPTY_DERIVATIVE_MODULE_REUSE,
      [moduleId]: "reused",
      ...(moduleId === "structure_mold" ? { id_cmf: "reused" as const } : {}),
    });
    const expectedRemoved = DERIVATIVE_MODULE_TASK_IDS[moduleId].length +
      (moduleId === "structure_mold" ? DERIVATIVE_MODULE_TASK_IDS.id_cmf.length : 0);

    expect(tailored.publicTaskCount).toBe(full.publicTaskCount);
    expect(full.totalTaskCount - tailored.totalTaskCount).toBe(expectedRemoved);
  });

  it("ID/CMF 不复用联动结构不复用，且阻止反向非法选择", () => {
    const bothReused = {
      ...EMPTY_DERIVATIVE_MODULE_REUSE,
      id_cmf: "reused" as const,
      structure_mold: "reused" as const,
    };
    const idChanged = updateDerivativeModuleReuse(
      bothReused,
      "id_cmf",
      "not_reused",
    );
    expect(idChanged).toMatchObject({
      id_cmf: "not_reused",
      structure_mold: "not_reused",
    });

    const blocked = updateDerivativeModuleReuse(
      idChanged,
      "structure_mold",
      "reused",
    );
    expect(blocked).toBe(idChanged);
  });

  it("复用一个模块无需自由文本证据，且预览与服务端模板任务数一致", () => {
    const moduleReuse = {
      ...EMPTY_DERIVATIVE_MODULE_REUSE,
      battery: "reused" as const,
    };
    const reuseEvidence = createEmptyDerivativeReuseEvidence();
    expect(validateDerivativeCreateBaseline({
      moduleReuse,
      reuseEvidence,
    })).toEqual({ ok: true, issues: [] });

    const baseline = buildDerivativeExecutionBaseline({
      moduleReuse,
      reuseEvidence,
      frozenAt: "2026-07-15T12:00:00.000Z",
      frozenBy: 1,
    });
    const preview = getDerivativeTaskPreview(moduleReuse);
    const runtime = getDerivativePhasesForExecutionBaseline(
      baseline,
      SOP_TEMPLATE_VERSION_CURRENT,
    );
    expect(runtime.reduce((total, phase) => total + phase.tasks.length, 0))
      .toBe(preview.totalTaskCount);
  });

  it("冻结 payload 只保存复用模块证据并清理字符串空格", () => {
    const reuseEvidence = createEmptyDerivativeReuseEvidence();
    reuseEvidence.battery = {
      sourceRef: "  一代电池包  ",
      modelOrVersion: " BAT-V3 ",
      evidenceRef: " EV-BAT-001 ",
      boundaryConfirmed: true,
    };
    reuseEvidence.electronics = {
      sourceRef: "不应保存",
      modelOrVersion: "PCBA-V1",
      evidenceRef: "EV-PCBA",
      boundaryConfirmed: true,
    };
    const baseline = buildDerivativeExecutionBaseline({
      moduleReuse: {
        ...EMPTY_DERIVATIVE_MODULE_REUSE,
        battery: "reused",
      },
      reuseEvidence,
      frozenAt: "2026-07-15T12:00:00.000Z",
      frozenBy: 7,
    });

    expect(baseline).toMatchObject({
      modelVersion: "project-track-v1",
      status: "frozen",
      frozenAt: "2026-07-15T12:00:00.000Z",
      frozenBy: 7,
      reuseEvidence: {
        battery: {
          sourceRef: "一代电池包",
          modelOrVersion: "BAT-V3",
          evidenceRef: "EV-BAT-001",
          boundaryConfirmed: true,
        },
      },
    });
    expect(baseline).not.toHaveProperty("productDefinitionRef");
    expect(Object.keys(baseline.reuseEvidence ?? {})).toEqual(["battery"]);
  });

  it("六模块零复用时阻止创建，六模块全复用允许创建", () => {
    const complete = createEmptyDerivativeReuseEvidence();
    expect(validateDerivativeCreateBaseline({
      moduleReuse: EMPTY_DERIVATIVE_MODULE_REUSE,
      reuseEvidence: complete,
    }).ok).toBe(false);

    expect(validateDerivativeCreateBaseline({
      moduleReuse: Object.fromEntries(
        PRODUCT_MODULE_IDS.map(moduleId => [moduleId, "reused"]),
      ) as Record<ProductModuleId, ModuleReuseState>,
      reuseEvidence: Object.fromEntries(
        PRODUCT_MODULE_IDS.map(moduleId => [moduleId, complete.battery]),
      ) as typeof complete,
    }).ok).toBe(true);
  });

  it("所有合法模块组合的预览任务键与 current 服务端解析完全一致", () => {
    for (let mask = 0; mask < 2 ** PRODUCT_MODULE_IDS.length; mask += 1) {
      const moduleReuse = Object.fromEntries(PRODUCT_MODULE_IDS.map((moduleId, index) => [
        moduleId,
        mask & (1 << index) ? "reused" : "not_reused",
      ])) as Record<ProductModuleId, ModuleReuseState>;
      if (PRODUCT_MODULE_IDS.every(moduleId => moduleReuse[moduleId] === "not_reused")) continue;
      if (moduleReuse.id_cmf === "not_reused" && moduleReuse.structure_mold === "reused") continue;
      const reuseEvidence = createEmptyDerivativeReuseEvidence();
      for (const moduleId of PRODUCT_MODULE_IDS) {
        if (moduleReuse[moduleId] !== "reused") continue;
        reuseEvidence[moduleId] = {
          sourceRef: `source-${moduleId}`,
          modelOrVersion: "V1",
          evidenceRef: `EV-${moduleId}`,
          boundaryConfirmed: true,
        };
      }
      const baseline = buildDerivativeExecutionBaseline({
        moduleReuse,
        reuseEvidence,
        frozenAt: "2026-07-15T12:00:00.000Z",
        frozenBy: 1,
      });
      const previewKeys = getDerivativeTaskPreview(moduleReuse).phases
        .flatMap(phase => phase.tasks.map(task => `${phase.id}:${task.id}`));
      const runtimeKeys = getDerivativePhasesForExecutionBaseline(
        baseline,
        SOP_TEMPLATE_VERSION_CURRENT,
      ).flatMap(phase => phase.tasks.map(task => `${phase.id}:${task.id}`));

      expect(previewKeys, `mask=${mask}`).toEqual(runtimeKeys);
    }
  });

});
