import { describe, expect, it } from "vitest";
import {
  KEY_MODULE_TYPES,
  PHYSICAL_DRV_MODULE_IDS,
  validateDrvModuleSelection,
  type DrvKeyModuleReferences,
} from "./key-modules";
import {
  PRODUCT_MODULE_IDS,
  type ModuleReuseState,
  type ProductModuleId,
} from "./project-track-tailoring";

const allNotReused = Object.fromEntries(
  PRODUCT_MODULE_IDS.map(moduleId => [moduleId, "not_reused"]),
) as Record<ProductModuleId, ModuleReuseState>;

const approvedPhysicalReferences: DrvKeyModuleReferences = {
  battery: { keyModuleId: "km-battery-1", moduleNumber: "BAT-001" },
  core_function: { keyModuleId: "km-core-1", moduleNumber: "CORE-001" },
  electronics: { keyModuleId: "km-pcba-1", moduleNumber: "PCBA-001" },
};

describe("关键模块共享领域契约", () => {
  it("只把三个物理模块纳入第一阶段关键模块库", () => {
    expect(PHYSICAL_DRV_MODULE_IDS).toEqual([
      "battery",
      "core_function",
      "electronics",
    ]);
    expect(KEY_MODULE_TYPES.map(type => [type.id, type.drvModuleId])).toEqual([
      ["battery_energy", "battery"],
      ["core_function", "core_function"],
      ["electronics_hardware", "electronics"],
    ]);
  });

  it("拒绝六模块全部不复用的 DRV", () => {
    const result = validateDrvModuleSelection({
      moduleReuse: allNotReused,
      keyModuleRefs: {},
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "drv_no_modules_reused" }),
    );
  });

  it("允许只复用非物理模块且不要求关键模块引用", () => {
    expect(validateDrvModuleSelection({
      moduleReuse: {
        ...allNotReused,
        software_connectivity: "reused",
      },
      keyModuleRefs: {},
    })).toEqual({ ok: true, issues: [] });
  });

  it.each(PHYSICAL_DRV_MODULE_IDS)(
    "复用物理模块 %s 时必须引用受控关键模块",
    moduleId => {
      const result = validateDrvModuleSelection({
        moduleReuse: { ...allNotReused, [moduleId]: "reused" },
        keyModuleRefs: {},
      });

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "missing_key_module_reference",
        moduleId,
      }));
    },
  );

  it("物理模块不复用时拒绝携带残留引用", () => {
    const result = validateDrvModuleSelection({
      moduleReuse: {
        ...allNotReused,
        software_connectivity: "reused",
      },
      keyModuleRefs: { battery: approvedPhysicalReferences.battery },
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "unexpected_key_module_reference",
      moduleId: "battery",
    }));
  });

  it("允许六模块全部复用，只要求三个物理模块有受控引用", () => {
    const moduleReuse = Object.fromEntries(
      PRODUCT_MODULE_IDS.map(moduleId => [moduleId, "reused"]),
    ) as Record<ProductModuleId, ModuleReuseState>;

    expect(validateDrvModuleSelection({
      moduleReuse,
      keyModuleRefs: approvedPhysicalReferences,
    })).toEqual({ ok: true, issues: [] });
  });

  it("拒绝空的模块 ID 或模块编号", () => {
    const result = validateDrvModuleSelection({
      moduleReuse: { ...allNotReused, battery: "reused" },
      keyModuleRefs: {
        battery: { keyModuleId: " ", moduleNumber: "" },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_key_module_reference", field: "keyModuleId" }),
      expect.objectContaining({ code: "invalid_key_module_reference", field: "moduleNumber" }),
    ]));
  });

  it("继续拒绝 ID/CMF 不复用但结构/模具复用", () => {
    const result = validateDrvModuleSelection({
      moduleReuse: {
        ...allNotReused,
        structure_mold: "reused",
        id_cmf: "not_reused",
      },
      keyModuleRefs: {},
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_id_cmf_structure_combination" }),
    );
  });
});
