import type {
  ModuleReuseState,
  ProductModuleId,
} from "./project-track-tailoring";

export const KEY_MODULE_TYPE_IDS = [
  "battery_energy",
  "core_function",
  "electronics_hardware",
] as const;

export const KEY_MODULE_STATUSES = [
  "draft",
  "technical_confirmed",
  "approved",
  "restricted",
  "obsolete",
] as const;

export type KeyModuleType = (typeof KEY_MODULE_TYPE_IDS)[number];
export type KeyModuleStatus = (typeof KEY_MODULE_STATUSES)[number];

export const KEY_MODULE_TYPES = [
  {
    id: "battery_energy",
    label: "电池/能源模块",
    drvModuleId: "battery",
  },
  {
    id: "core_function",
    label: "核心功能模块",
    drvModuleId: "core_function",
  },
  {
    id: "electronics_hardware",
    label: "电子硬件模块",
    drvModuleId: "electronics",
  },
] as const;

export type PhysicalDrvModuleId =
  (typeof KEY_MODULE_TYPES)[number]["drvModuleId"];

export const PHYSICAL_DRV_MODULE_IDS = KEY_MODULE_TYPES.map(
  ({ drvModuleId }) => drvModuleId,
) as PhysicalDrvModuleId[];

export const KEY_MODULE_TYPE_BY_DRV_MODULE = Object.fromEntries(
  KEY_MODULE_TYPES.map(({ drvModuleId, id }) => [drvModuleId, id]),
) as Record<PhysicalDrvModuleId, KeyModuleType>;

export interface KeyModuleReference {
  keyModuleId: string;
  moduleNumber: string;
}

export type DrvKeyModuleReferences = Partial<
  Record<PhysicalDrvModuleId, KeyModuleReference>
>;

export type DrvModuleSelectionValidationCode =
  | "drv_no_modules_reused"
  | "invalid_id_cmf_structure_combination"
  | "missing_key_module_reference"
  | "invalid_key_module_reference"
  | "unexpected_key_module_reference";

export interface DrvModuleSelectionValidationIssue {
  code: DrvModuleSelectionValidationCode;
  message: string;
  moduleId?: ProductModuleId;
  field?: keyof KeyModuleReference;
}

export interface DrvModuleSelectionValidationResult {
  ok: boolean;
  issues: DrvModuleSelectionValidationIssue[];
}

const isNonBlank = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function validateDrvModuleSelection(input: {
  moduleReuse: Record<ProductModuleId, ModuleReuseState>;
  keyModuleRefs?: DrvKeyModuleReferences;
}): DrvModuleSelectionValidationResult {
  const issues: DrvModuleSelectionValidationIssue[] = [];

  if (Object.values(input.moduleReuse).every(state => state === "not_reused")) {
    issues.push({
      code: "drv_no_modules_reused",
      message: "DRV 至少需要复用一个现有模块",
    });
  }

  if (
    input.moduleReuse.id_cmf === "not_reused" &&
    input.moduleReuse.structure_mold === "reused"
  ) {
    issues.push({
      code: "invalid_id_cmf_structure_combination",
      message: "ID/CMF 不复用时，产品结构/模具也必须设为不复用",
    });
  }

  for (const moduleId of PHYSICAL_DRV_MODULE_IDS) {
    const state = input.moduleReuse[moduleId];
    const reference = input.keyModuleRefs?.[moduleId];

    if (state === "not_reused" && reference) {
      issues.push({
        code: "unexpected_key_module_reference",
        message: `${moduleId} 未复用时不能携带关键模块引用`,
        moduleId,
      });
      continue;
    }

    if (state !== "reused") continue;

    if (!reference) {
      issues.push({
        code: "missing_key_module_reference",
        message: `${moduleId} 复用时必须选择受控关键模块`,
        moduleId,
      });
      continue;
    }

    for (const field of ["keyModuleId", "moduleNumber"] as const) {
      if (!isNonBlank(reference[field])) {
        issues.push({
          code: "invalid_key_module_reference",
          message: `${moduleId} 的${field}不能为空`,
          moduleId,
          field,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
