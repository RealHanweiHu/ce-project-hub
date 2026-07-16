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
