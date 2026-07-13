import {
  EMPTY_CHANGE_SCOPE_DECLARATION,
  type ProjectChangeScopeDeclaration,
} from "./sop-risk";

export const CERTIFICATE_TYPES = [
  "un38_3",
  "msds",
  "battery_safety",
  "product_safety",
  "component_safety",
  "market_access",
  "regulatory_compliance",
] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export const CERTIFICATE_TYPE_LABELS: Record<CertificateType, string> = {
  un38_3: "UN38.3 运输测试",
  msds: "MSDS",
  battery_safety: "电芯/电池包安全认证",
  product_safety: "产品安全认证",
  component_safety: "关键安全件认证",
  market_access: "目标市场准入",
  regulatory_compliance: "法规符合性",
};

export const CERTIFICATE_SCOPE_TYPES = ["project", "product_family", "revision"] as const;
export type CertificateScopeType = (typeof CERTIFICATE_SCOPE_TYPES)[number];
export const CERTIFICATE_STATUSES = ["draft", "valid", "expired", "revoked"] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export type CertificationRequirement = {
  type: CertificateType;
  market: string | null;
  reason: string;
};

export type CertificationCoverageRecord = {
  id: number;
  projectId?: string | null;
  revisionId?: number | null;
  type: CertificateType;
  scopeType: CertificateScopeType;
  status: CertificateStatus;
  targetMarkets?: string[] | null;
  validUntil?: string | null;
  certificateNumber?: string | null;
  evidenceReference?: string | null;
  reuseApproved?: boolean | null;
  reuseBasis?: string | null;
};

function normalizeMarkets(markets: Iterable<string> | null | undefined): string[] {
  return Array.from(new Set(Array.from(markets ?? [])
    .map((market) => market.trim().toUpperCase())
    .filter(Boolean)))
    .sort();
}

export function getRequiredCertificationCoverage(input: {
  declaration: ProjectChangeScopeDeclaration;
  baselineTargetMarkets?: Iterable<string> | null;
}): CertificationRequirement[] {
  const declaration = { ...EMPTY_CHANGE_SCOPE_DECLARATION, ...input.declaration };
  const requirements: CertificationRequirement[] = [];
  const add = (type: CertificateType, reason: string, market: string | null = null) => {
    if (!requirements.some((item) => item.type === type && item.market === market)) {
      requirements.push({ type, market, reason });
    }
  };

  if (declaration.batteryCellChange || declaration.batteryPackOrBmsChange) {
    add("un38_3", "电芯或电池包变化需要确认运输测试覆盖");
    add("msds", "电芯或电池包变化需要有效 MSDS");
    add("battery_safety", "电芯或电池包变化需要安全认证覆盖");
  }
  if (
    declaration.protectionParameterChange ||
    declaration.powerOrThermalBoundaryChange ||
    declaration.pressurizedStructureChange ||
    declaration.safetyRelatedSoftwareChange
  ) {
    add("product_safety", "安全保护、功率热边界、受压结构或安全软件变化需要产品安全覆盖");
  }
  if (declaration.criticalSafetySupplierChange) {
    add("component_safety", "关键安全件供应商或二供变化需要安全件认证覆盖");
  }
  if (declaration.otherSafetyOrRegulatoryChange) {
    add("regulatory_compliance", "其他安全或法规变化需要法规符合性证据");
  }

  const baseline = new Set(normalizeMarkets(input.baselineTargetMarkets));
  const declared = normalizeMarkets(declaration.targetMarkets);
  const added = declared.filter((market) => !baseline.has(market));
  const marketsToCheck = added.length > 0
    ? added
    : declaration.targetMarketExpansion ? declared : [];
  if (declaration.targetMarketExpansion && marketsToCheck.length === 0) {
    add("market_access", "声明新增目标市场但尚未明确市场范围");
  } else {
    for (const market of marketsToCheck) {
      add("market_access", `新增目标市场 ${market} 需要准入覆盖`, market);
    }
  }

  return requirements;
}

function scopeApplies(record: CertificationCoverageRecord, input: {
  projectId: string;
  baseRevisionId?: number | null;
  resultRevisionId?: number | null;
}): boolean {
  if (record.scopeType === "project") return record.projectId === input.projectId;
  if (record.scopeType === "product_family") return true;
  const revisionMatches = record.revisionId != null &&
    (record.revisionId === input.baseRevisionId || record.revisionId === input.resultRevisionId);
  return revisionMatches && record.reuseApproved === true && !!record.reuseBasis?.trim();
}

export function evaluateCertificationCoverage(input: {
  requirements: CertificationRequirement[];
  records: CertificationCoverageRecord[];
  projectId: string;
  baseRevisionId?: number | null;
  resultRevisionId?: number | null;
  todayISO: string;
}): {
  covered: boolean;
  missing: CertificationRequirement[];
  coveredByRequirement: Array<{ requirement: CertificationRequirement; certificateId: number | null }>;
} {
  const coveredByRequirement = input.requirements.map((requirement) => {
    const match = input.records.find((record) => {
      if (record.type !== requirement.type || record.status !== "valid") return false;
      if (record.validUntil && record.validUntil < input.todayISO) return false;
      if (!record.certificateNumber?.trim() && !record.evidenceReference?.trim()) return false;
      if (!scopeApplies(record, input)) return false;
      if (!requirement.market) return true;
      const markets = normalizeMarkets(record.targetMarkets);
      return markets.includes("GLOBAL") || markets.includes(requirement.market);
    });
    return { requirement, certificateId: match?.id ?? null };
  });
  const missing = coveredByRequirement
    .filter((item) => item.certificateId == null)
    .map((item) => item.requirement);
  return { covered: missing.length === 0, missing, coveredByRequirement };
}

export function certificationRequirementLabel(requirement: CertificationRequirement): string {
  return `${CERTIFICATE_TYPE_LABELS[requirement.type]}${requirement.market ? `（${requirement.market}）` : ""}`;
}
