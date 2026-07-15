import {
  SOP_TEMPLATE_VERSION_CURRENT,
  getJdmPhasesForModuleReuse,
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
  EMPTY_DERIVATIVE_MODULE_REUSE,
  createEmptyDerivativeReuseEvidence,
} from "@/lib/derivative-create";

export interface JdmDefinitionFormState {
  customerConceptRef: string;
  productDefinitionRef: string;
  moduleReuse: Record<ProductModuleId, ModuleReuseState>;
  reuseEvidence: Record<ProductModuleId, ModuleReuseEvidence>;
}

export type JdmDefinitionFreezeCandidate = {
  modelVersion: "project-track-v1";
  status: "frozen";
  productDefinitionRef: string;
  moduleReuse: Record<ProductModuleId, ModuleReuseState>;
  reuseEvidence: Partial<Record<ProductModuleId, ModuleReuseEvidence>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeEvidence(value: unknown): ModuleReuseEvidence | null {
  if (!isRecord(value)) return null;
  return {
    sourceRef: typeof value.sourceRef === "string" ? value.sourceRef : "",
    modelOrVersion:
      typeof value.modelOrVersion === "string" ? value.modelOrVersion : "",
    evidenceRef: typeof value.evidenceRef === "string" ? value.evidenceRef : "",
    boundaryConfirmed: value.boundaryConfirmed === true,
  };
}

export function createJdmDefinitionFormState(
  baselineInput: unknown,
): JdmDefinitionFormState {
  const baseline = isRecord(baselineInput)
    ? baselineInput as Partial<ProjectExecutionBaseline>
    : {};
  const moduleReuse = { ...EMPTY_DERIVATIVE_MODULE_REUSE };
  if (isRecord(baseline.moduleReuse)) {
    for (const moduleId of PRODUCT_MODULE_IDS) {
      const state = baseline.moduleReuse[moduleId];
      if (state === "reused" || state === "not_reused") {
        moduleReuse[moduleId] = state;
      }
    }
  }

  const reuseEvidence = createEmptyDerivativeReuseEvidence();
  if (isRecord(baseline.reuseEvidence)) {
    for (const moduleId of PRODUCT_MODULE_IDS) {
      const evidence = normalizeEvidence(baseline.reuseEvidence[moduleId]);
      if (evidence) reuseEvidence[moduleId] = evidence;
    }
  }

  return {
    customerConceptRef:
      typeof baseline.customerConceptRef === "string"
        ? baseline.customerConceptRef
        : "",
    productDefinitionRef:
      typeof baseline.productDefinitionRef === "string"
        ? baseline.productDefinitionRef
        : "",
    moduleReuse,
    reuseEvidence,
  };
}

function cleanedReuseEvidence(
  state: JdmDefinitionFormState,
): Partial<Record<ProductModuleId, ModuleReuseEvidence>> {
  return Object.fromEntries(
    PRODUCT_MODULE_IDS
      .filter(moduleId => state.moduleReuse[moduleId] === "reused")
      .map(moduleId => {
        const evidence = state.reuseEvidence[moduleId];
        return [moduleId, {
          sourceRef: evidence.sourceRef.trim(),
          modelOrVersion: evidence.modelOrVersion.trim(),
          evidenceRef: evidence.evidenceRef.trim(),
          boundaryConfirmed: evidence.boundaryConfirmed,
        }];
      }),
  );
}

export function buildJdmDefinitionDraftBaseline(
  state: JdmDefinitionFormState,
): ProjectExecutionBaseline {
  return {
    modelVersion: "project-track-v1",
    status: "draft",
    customerConceptRef: state.customerConceptRef.trim(),
    productDefinitionRef: state.productDefinitionRef.trim(),
    moduleReuse: { ...state.moduleReuse },
    reuseEvidence: cleanedReuseEvidence(state),
  };
}

/**
 * Gate request candidate. The server inherits customerConceptRef from the
 * creation snapshot and signs frozenAt/frozenBy inside the Gate transaction.
 */
export function buildJdmDefinitionFreezeCandidate(
  state: JdmDefinitionFormState,
): JdmDefinitionFreezeCandidate {
  return {
    modelVersion: "project-track-v1",
    status: "frozen",
    productDefinitionRef: state.productDefinitionRef.trim(),
    moduleReuse: { ...state.moduleReuse },
    reuseEvidence: cleanedReuseEvidence(state),
  };
}

export function getJdmDefinitionGateFreezePayload(input: {
  category?: string | null;
  phaseId: string;
  decision: "approved" | "conditional" | "rejected";
  state: JdmDefinitionFormState;
}): { executionBaseline: JdmDefinitionFreezeCandidate } | undefined {
  if (
    input.category !== "jdm" ||
    input.phaseId !== "input" ||
    input.decision === "rejected"
  ) {
    return undefined;
  }
  return {
    executionBaseline: buildJdmDefinitionFreezeCandidate(input.state),
  };
}

export function validateJdmDefinitionFreeze(
  state: JdmDefinitionFormState,
): BaselineValidationResult {
  return validateProjectExecutionBaseline({
    ...buildJdmDefinitionFreezeCandidate(state),
    // Only used by the shared validation preview. These audit fields are not
    // sent to or trusted by the server.
    frozenAt: "server-will-sign",
    frozenBy: 1,
  }, { track: "jdm" });
}

export function getJdmDefinitionTaskPreview(
  moduleReuse: Record<ProductModuleId, ModuleReuseState>,
) {
  const phases = getJdmPhasesForModuleReuse(
    moduleReuse,
    SOP_TEMPLATE_VERSION_CURRENT,
  );
  const totalTaskCount = phases.reduce(
    (total, phase) => total + phase.tasks.length,
    0,
  );
  const executionTaskCount = phases
    .filter(phase => phase.id !== "input")
    .reduce((total, phase) => total + phase.tasks.length, 0);
  return {
    phases,
    totalTaskCount,
    executionTaskCount,
    reusedModuleCount: PRODUCT_MODULE_IDS.filter(
      moduleId => moduleReuse[moduleId] === "reused",
    ).length,
  };
}
