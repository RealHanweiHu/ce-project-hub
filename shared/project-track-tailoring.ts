export const PRODUCT_MODULES = [
  {
    id: "battery",
    label: "电池/能源系统",
    responsibilityDomain: "电池、电源、充电、保护与热设计",
  },
  {
    id: "core_function",
    label: "核心功能部件",
    responsibilityDomain: "电机、泵、风机、机芯与传动设计",
  },
  {
    id: "electronics",
    label: "电子硬件",
    responsibilityDomain: "PCBA、主控、驱动、电源与传感器设计",
  },
  {
    id: "software_connectivity",
    label: "软件/连接",
    responsibilityDomain: "固件、控制、APP、OTA 与通讯设计",
  },
  {
    id: "structure_mold",
    label: "产品结构/模具",
    responsibilityDomain: "结构、装配、密封、散热与模具设计",
  },
  {
    id: "id_cmf",
    label: "ID/CMF",
    responsibilityDomain: "造型、颜色、材质、纹理与外观标准设计",
  },
] as const;

export type ProductModuleId = (typeof PRODUCT_MODULES)[number]["id"];

export const PRODUCT_MODULE_IDS = PRODUCT_MODULES.map(
  ({ id }) => id
) as ProductModuleId[];

const PRODUCT_MODULE_LABELS = Object.fromEntries(
  PRODUCT_MODULES.map(({ id, label }) => [id, label]),
) as Record<ProductModuleId, string>;

export type ModuleReuseState = "reused" | "not_reused";

export interface ModuleReuseEvidence {
  sourceRef: string;
  modelOrVersion: string;
  evidenceRef: string;
  boundaryConfirmed: boolean;
}

export interface ProjectExecutionBaseline {
  modelVersion: "project-track-v1";
  status: "draft" | "frozen";
  productDefinitionRef?: string;
  moduleReuse?: Record<ProductModuleId, ModuleReuseState>;
  reuseEvidence?: Partial<Record<ProductModuleId, ModuleReuseEvidence>>;
  customerConceptRef?: string;
  customerInputVersion?: string;
  proposedStandardModules?: ProductModuleId[];
  /** Latest fully confirmed structured risk declaration frozen with this baseline. */
  riskScopeVersion?: number;
  frozenAt?: string;
  frozenBy?: number;
}

export type ProjectTrackWithModuleReuse = "drv" | "jdm";

export type BaselineValidationCode =
  | "drv_requires_frozen_baseline"
  | "missing_product_definition"
  | "missing_module_state"
  | "invalid_module_state"
  | "missing_reuse_evidence"
  | "invalid_id_cmf_structure_combination"
  | "drv_all_modules_reused"
  | "missing_freeze_metadata";

export interface BaselineValidationIssue {
  code: BaselineValidationCode;
  message: string;
  moduleId?: ProductModuleId;
  field?: keyof ModuleReuseEvidence | "frozenAt" | "frozenBy";
}

export interface BaselineValidationResult {
  ok: boolean;
  issues: BaselineValidationIssue[];
}

const isNonBlank = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const EVIDENCE_FIELD_LABELS: Record<keyof ModuleReuseEvidence, string> = {
  sourceRef: "来源产品或模块",
  modelOrVersion: "型号或版本",
  evidenceRef: "证据引用",
  boundaryConfirmed: "适用边界确认",
};

function validateReuseEvidence(
  moduleId: ProductModuleId,
  evidence: ModuleReuseEvidence | undefined
): BaselineValidationIssue[] {
  const missingFields: Array<keyof ModuleReuseEvidence> = [];
  if (!isNonBlank(evidence?.sourceRef)) missingFields.push("sourceRef");
  if (!isNonBlank(evidence?.modelOrVersion))
    missingFields.push("modelOrVersion");
  if (!isNonBlank(evidence?.evidenceRef)) missingFields.push("evidenceRef");
  if (evidence?.boundaryConfirmed !== true)
    missingFields.push("boundaryConfirmed");

  return missingFields.map(field => ({
    code: "missing_reuse_evidence",
    message: `${PRODUCT_MODULE_LABELS[moduleId]}复用时必须提供${EVIDENCE_FIELD_LABELS[field]}`,
    moduleId,
    field,
  }));
}

/**
 * Validates the shared execution-baseline invariant used by form previews,
 * create APIs and the JDM product-definition Gate.
 */
export function validateProjectExecutionBaseline(
  baseline: ProjectExecutionBaseline,
  options: { track: ProjectTrackWithModuleReuse }
): BaselineValidationResult {
  const issues: BaselineValidationIssue[] = [];
  const moduleReuse = baseline.moduleReuse;

  if (baseline.status === "draft") {
    if (options.track === "drv") {
      return {
        ok: false,
        issues: [
          {
            code: "drv_requires_frozen_baseline",
            message: "DRV 创建时必须提交已冻结的产品规格与六模块执行基线",
          },
        ],
      };
    }
    // JDM 的定义期草稿允许规格、模块判断和复用证据逐步收敛；
    // 完整性与领域不变量统一在产品定义 Gate 冻结时检查。
    return { ok: true, issues: [] };
  }

  if (baseline.status === "frozen") {
    if (!isNonBlank(baseline.productDefinitionRef)) {
      issues.push({
        code: "missing_product_definition",
        message: "冻结执行基线前必须确认产品定义或规格书引用",
      });
    }

    for (const moduleId of PRODUCT_MODULE_IDS) {
      const state = moduleReuse?.[moduleId];
      if (state === undefined) {
        issues.push({
          code: "missing_module_state",
          message: `${PRODUCT_MODULE_LABELS[moduleId]}缺少复用状态`,
          moduleId,
        });
      } else if (state !== "reused" && state !== "not_reused") {
        issues.push({
          code: "invalid_module_state",
          message: `${PRODUCT_MODULE_LABELS[moduleId]}的复用状态无效`,
          moduleId,
        });
      }
    }

    if (!isNonBlank(baseline.frozenAt)) {
      issues.push({
        code: "missing_freeze_metadata",
        message: "冻结执行基线必须记录冻结时间",
        field: "frozenAt",
      });
    }
    if (!Number.isInteger(baseline.frozenBy) || (baseline.frozenBy ?? 0) <= 0) {
      issues.push({
        code: "missing_freeze_metadata",
        message: "冻结执行基线必须记录冻结人",
        field: "frozenBy",
      });
    }
  }

  if (moduleReuse) {
    for (const moduleId of PRODUCT_MODULE_IDS) {
      if (moduleReuse[moduleId] === "reused") {
        issues.push(
          ...validateReuseEvidence(moduleId, baseline.reuseEvidence?.[moduleId])
        );
      }
    }

    if (
      moduleReuse.id_cmf === "not_reused" &&
      moduleReuse.structure_mold === "reused"
    ) {
      issues.push({
        code: "invalid_id_cmf_structure_combination",
        message: "ID/CMF 不复用时，产品结构/模具也必须设为不复用",
      });
    }

    if (
      options.track === "drv" &&
      PRODUCT_MODULE_IDS.every(moduleId => moduleReuse[moduleId] === "reused")
    ) {
      issues.push({
        code: "drv_all_modules_reused",
        message: "六个模块全部复用时不应创建 DRV 项目",
      });
    }
  }

  return { ok: issues.length === 0, issues };
}
