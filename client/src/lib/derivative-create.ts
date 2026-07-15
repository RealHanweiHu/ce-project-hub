import {
  DERIVATIVE_MODULE_TASK_IDS,
  SOP_TEMPLATE_VERSION_CURRENT,
  getDerivativePhasesForModuleReuse,
} from "@shared/sop-templates";
import {
  PRODUCT_MODULE_IDS,
  validateProjectExecutionBaseline,
  type BaselineValidationResult,
  type ModuleReuseEvidence,
  type ModuleReuseState,
  type ProductModuleId,
  type ProjectExecutionBaseline,
} from "@shared/project-track-tailoring";
import {
  EMPTY_CHANGE_SCOPE_DECLARATION,
  type ProjectChangeScopeDeclaration,
} from "@shared/sop-risk";

type DerivativeChangeScopeKey = Exclude<
  keyof ProjectChangeScopeDeclaration,
  "targetMarkets" | "notes" | "targetMarketExpansion" | "criticalSafetySupplierChange"
>;

export const DERIVATIVE_CHANGE_SCOPE_RULES: Array<{
  key: DerivativeChangeScopeKey;
  label: string;
  moduleIds: ProductModuleId[];
}> = [
  { key: "batteryCellChange", label: "新增或更换电芯", moduleIds: ["battery"] },
  { key: "batteryPackOrBmsChange", label: "电池包 / BMS / 保护板发生变化", moduleIds: ["battery"] },
  { key: "protectionParameterChange", label: "充放电策略或保护参数发生变化", moduleIds: ["battery", "electronics", "software_connectivity"] },
  { key: "powerOrThermalBoundaryChange", label: "功率、电流、温升或连续工作边界发生变化", moduleIds: ["battery", "core_function", "electronics", "structure_mold"] },
  { key: "pressurizedStructureChange", label: "受压结构或过压保护边界发生变化", moduleIds: ["core_function", "structure_mold"] },
  { key: "safetyRelatedSoftwareChange", label: "安全相关固件、APP、OTA 或烧录发生变化", moduleIds: ["software_connectivity"] },
  { key: "eolTestChange", label: "EOL 测试项目、限值或能力需要变化", moduleIds: [] },
  { key: "otherSafetyOrRegulatoryChange", label: "其他安全或法规边界发生变化", moduleIds: [] },
];

export function getDerivativeChangeScopeRules(
  moduleReuse: Record<ProductModuleId, ModuleReuseState>,
) {
  return DERIVATIVE_CHANGE_SCOPE_RULES.filter(rule =>
    rule.moduleIds.length === 0 ||
    rule.moduleIds.some(moduleId => moduleReuse[moduleId] === "not_reused"),
  );
}

export function buildDerivativeChangeScopeDeclaration(input: {
  moduleReuse: Record<ProductModuleId, ModuleReuseState>;
  declaration: ProjectChangeScopeDeclaration;
}): ProjectChangeScopeDeclaration {
  const result: ProjectChangeScopeDeclaration = {
    ...EMPTY_CHANGE_SCOPE_DECLARATION,
    notes: input.declaration.notes ?? null,
  };
  for (const { key } of getDerivativeChangeScopeRules(input.moduleReuse)) {
    result[key] = input.declaration[key];
  }
  return result;
}

export const EMPTY_DERIVATIVE_MODULE_REUSE: Record<
  ProductModuleId,
  ModuleReuseState
> = {
  battery: "not_reused",
  core_function: "not_reused",
  electronics: "not_reused",
  software_connectivity: "not_reused",
  structure_mold: "not_reused",
  id_cmf: "not_reused",
};

export function createEmptyDerivativeReuseEvidence(): Record<
  ProductModuleId,
  ModuleReuseEvidence
> {
  return Object.fromEntries(
    PRODUCT_MODULE_IDS.map(moduleId => [moduleId, {
      sourceRef: "",
      modelOrVersion: "",
      evidenceRef: "",
      boundaryConfirmed: false,
    }]),
  ) as Record<ProductModuleId, ModuleReuseEvidence>;
}

/**
 * UI-side invariant. ID/CMF 不复用会联动结构/模具不复用；反向非法选择
 * （ID/CMF 不复用时单独把结构设为复用）保持原值，由界面给出提示。
 */
export function updateDerivativeModuleReuse(
  current: Record<ProductModuleId, ModuleReuseState>,
  moduleId: ProductModuleId,
  state: ModuleReuseState,
): Record<ProductModuleId, ModuleReuseState> {
  if (
    moduleId === "structure_mold" &&
    state === "reused" &&
    current.id_cmf === "not_reused"
  ) {
    return current;
  }
  if (moduleId === "id_cmf" && state === "not_reused") {
    return { ...current, id_cmf: state, structure_mold: "not_reused" };
  }
  return { ...current, [moduleId]: state };
}

export function buildDerivativeExecutionBaseline(input: {
  productDefinitionRef: string;
  moduleReuse: Record<ProductModuleId, ModuleReuseState>;
  reuseEvidence: Record<ProductModuleId, ModuleReuseEvidence>;
  frozenAt: string;
  frozenBy: number;
}): ProjectExecutionBaseline {
  return {
    modelVersion: "project-track-v1",
    status: "frozen",
    productDefinitionRef: input.productDefinitionRef.trim(),
    moduleReuse: { ...input.moduleReuse },
    reuseEvidence: Object.fromEntries(
      PRODUCT_MODULE_IDS
        .filter(moduleId => input.moduleReuse[moduleId] === "reused")
        .map(moduleId => {
          const evidence = input.reuseEvidence[moduleId];
          return [moduleId, {
            sourceRef: evidence.sourceRef.trim(),
            modelOrVersion: evidence.modelOrVersion.trim(),
            evidenceRef: evidence.evidenceRef.trim(),
            boundaryConfirmed: evidence.boundaryConfirmed,
          }];
        }),
    ),
    frozenAt: input.frozenAt,
    frozenBy: input.frozenBy,
  };
}

export function validateDerivativeCreateBaseline(input: {
  productDefinitionRef: string;
  moduleReuse: Record<ProductModuleId, ModuleReuseState>;
  reuseEvidence: Record<ProductModuleId, ModuleReuseEvidence>;
}): BaselineValidationResult {
  return validateProjectExecutionBaseline(
    buildDerivativeExecutionBaseline({
      ...input,
      frozenAt: "preview",
      frozenBy: 1,
    }),
    { track: "drv" },
  );
}

export function getDerivativeTaskPreview(
  moduleReuse: Record<ProductModuleId, ModuleReuseState>,
) {
  const phases = getDerivativePhasesForModuleReuse(
    moduleReuse,
    SOP_TEMPLATE_VERSION_CURRENT,
  );
  const totalTaskCount = phases.reduce(
    (total, phase) => total + phase.tasks.length,
    0,
  );
  const moduleTaskCount = PRODUCT_MODULE_IDS
    .filter(moduleId => moduleReuse[moduleId] === "not_reused")
    .reduce(
      (total, moduleId) => total + DERIVATIVE_MODULE_TASK_IDS[moduleId].length,
      0,
    );
  return {
    phases,
    publicTaskCount: totalTaskCount - moduleTaskCount,
    moduleTaskCount,
    totalTaskCount,
    reusedModuleCount: PRODUCT_MODULE_IDS.filter(
      moduleId => moduleReuse[moduleId] === "reused",
    ).length,
  };
}
