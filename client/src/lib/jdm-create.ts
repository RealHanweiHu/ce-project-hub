import {
  SOP_TEMPLATE_VERSION_CURRENT,
  getJdmPhasesForExecutionBaseline,
} from "@shared/sop-templates";
import type { ProjectExecutionBaseline } from "@shared/project-track-tailoring";

type CreateValidation = {
  ok: boolean;
  issues: string[];
};

export type JdmCreateInput = {
  customerConceptRef: string;
  commercialBoundary: string;
  customerSignoffOwnerUserId: number | null;
};

export type ObtCreateInput = {
  customerInputVersion: string;
  customerPartNumber: string;
  commercialBoundary: string;
  customerSignoffOwnerUserId: number | null;
};

const hasValue = (value: string) => value.trim().length > 0;

export function validateJdmCreateInput(input: JdmCreateInput): CreateValidation {
  const issues = [
    !hasValue(input.customerConceptRef) && "客户概念/ID 原始输入",
    !hasValue(input.commercialBoundary) && "商务边界",
    !input.customerSignoffOwnerUserId && "客户签核责任人",
  ].filter((issue): issue is string => Boolean(issue));
  return { ok: issues.length === 0, issues };
}

export function validateObtCreateInput(input: ObtCreateInput): CreateValidation {
  const issues = [
    !hasValue(input.customerInputVersion) && "客户输入版本",
    !hasValue(input.customerPartNumber) && "客户料号",
    !hasValue(input.commercialBoundary) && "商务边界",
    !input.customerSignoffOwnerUserId && "客户签核责任人",
  ].filter((issue): issue is string => Boolean(issue));
  return { ok: issues.length === 0, issues };
}

export function buildJdmCreateExecutionBaseline(
  customerConceptRef: string,
): ProjectExecutionBaseline {
  return {
    modelVersion: "project-track-v1",
    status: "draft",
    customerConceptRef: customerConceptRef.trim(),
  };
}

export function getJdmCreatePhasePreview(customerConceptRef: string) {
  const phases = getJdmPhasesForExecutionBaseline(
    buildJdmCreateExecutionBaseline(customerConceptRef),
    SOP_TEMPLATE_VERSION_CURRENT,
  );
  return {
    phases,
    totalTaskCount: phases.reduce(
      (total, phase) => total + phase.tasks.length,
      0,
    ),
  };
}
