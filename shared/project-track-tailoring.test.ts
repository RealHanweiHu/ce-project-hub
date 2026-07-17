import { describe, expect, it } from "vitest";
import {
  PRODUCT_MODULE_IDS,
  PRODUCT_MODULES,
  validateProjectExecutionBaseline,
  type ModuleReuseEvidence,
  type ProductModuleId,
  type ProjectExecutionBaseline,
} from "./project-track-tailoring";

const reusedEvidence: ModuleReuseEvidence = {
  sourceRef: "CE-1000 / battery",
  modelOrVersion: "BAT-V3",
  evidenceRef: "EV-BAT-2026-007",
  boundaryConfirmed: true,
};

const allNotReused = Object.fromEntries(
  PRODUCT_MODULE_IDS.map(moduleId => [moduleId, "not_reused"])
) as Record<ProductModuleId, "not_reused">;

function frozenDrv(
  overrides: Partial<ProjectExecutionBaseline> = {}
): ProjectExecutionBaseline {
  return {
    modelVersion: "project-track-v1",
    status: "frozen",
    productDefinitionRef: "SPEC-DRV-001",
    moduleReuse: { ...allNotReused, software_connectivity: "reused" },
    frozenAt: "2026-07-15T09:00:00.000Z",
    frozenBy: 1001,
    ...overrides,
  };
}

describe("项目执行基线领域模型", () => {
  it("提供六个稳定模块 ID、显示名和责任域", () => {
    expect(PRODUCT_MODULE_IDS).toEqual([
      "battery",
      "core_function",
      "electronics",
      "software_connectivity",
      "structure_mold",
      "id_cmf",
    ]);
    expect(PRODUCT_MODULES).toHaveLength(6);
    for (const module of PRODUCT_MODULES) {
      expect(module.label.trim()).not.toBe("");
      expect(module.responsibilityDomain.trim()).not.toBe("");
    }
  });

  it("DRV 复用模块不再要求自由文本证据", () => {
    const baseline = frozenDrv({
      moduleReuse: { ...allNotReused, battery: "reused" },
    });

    const result = validateProjectExecutionBaseline(baseline, { track: "drv" });

    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("拒绝 ID/CMF 不复用但结构/模具复用的非法组合", () => {
    const baseline = frozenDrv({
      moduleReuse: {
        ...allNotReused,
        id_cmf: "not_reused",
        structure_mold: "reused",
      },
      reuseEvidence: { structure_mold: reusedEvidence },
    });

    const result = validateProjectExecutionBaseline(baseline, { track: "drv" });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_id_cmf_structure_combination" })
    );
  });

  it("允许六模块全部复用的 DRV", () => {
    const moduleReuse = Object.fromEntries(
      PRODUCT_MODULE_IDS.map(moduleId => [moduleId, "reused"])
    ) as Record<ProductModuleId, "reused">;
    const reuseEvidence = Object.fromEntries(
      PRODUCT_MODULE_IDS.map(moduleId => [moduleId, reusedEvidence])
    ) as Record<ProductModuleId, ModuleReuseEvidence>;

    const result = validateProjectExecutionBaseline(
      frozenDrv({ moduleReuse, reuseEvidence }),
      { track: "drv" }
    );

    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("拒绝六模块全部不复用的 DRV", () => {
    const result = validateProjectExecutionBaseline(
      frozenDrv({ moduleReuse: allNotReused }),
      { track: "drv" },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "drv_no_modules_reused" }),
    );
  });

  it("JDM 产品定义 Gate 前允许没有规格和模块草稿", () => {
    const result = validateProjectExecutionBaseline(
      {
        modelVersion: "project-track-v1",
        status: "draft",
        customerConceptRef: "客户 ID 草图 2026-07-15",
      },
      { track: "jdm" }
    );

    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("JDM 产品定义 Gate 前允许暂存尚未补证据的模块草稿", () => {
    const result = validateProjectExecutionBaseline(
      {
        modelVersion: "project-track-v1",
        status: "draft",
        customerConceptRef: "客户概念图",
        moduleReuse: { ...allNotReused, battery: "reused" },
      },
      { track: "jdm" },
    );

    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("DRV 不允许保存 draft 执行基线", () => {
    const result = validateProjectExecutionBaseline(
      {
        modelVersion: "project-track-v1",
        status: "draft",
      },
      { track: "drv" },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "drv_requires_frozen_baseline" }),
    );
  });

  it("DRV 创建时只冻结模块基线，不要求产品规格书引用", () => {
    const baseline = frozenDrv();
    delete baseline.productDefinitionRef;

    expect(validateProjectExecutionBaseline(baseline, { track: "drv" }))
      .toEqual({ ok: true, issues: [] });
  });

  it("冻结基线要求规格、六模块状态、冻结时间和冻结人完整", () => {
    const result = validateProjectExecutionBaseline(
      {
        modelVersion: "project-track-v1",
        status: "frozen",
      },
      { track: "jdm" }
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        "missing_product_definition",
        "missing_module_state",
        "missing_freeze_metadata",
      ])
    );
  });
});
