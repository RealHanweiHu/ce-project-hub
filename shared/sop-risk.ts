import type { SOPPhase, SOPTask } from "./sop-templates";

export const PROJECT_SOP_RISK_LEVELS = ["standard", "high"] as const;
export type ProjectSopRiskLevel = (typeof PROJECT_SOP_RISK_LEVELS)[number];

export const SOP_RISK_RULE_VERSION = "scope-declaration-v1" as const;

/**
 * Structured project/change scope. These fields are deliberately boolean and
 * auditable: the risk engine must never infer safety intent from free text.
 */
export type ProjectChangeScopeDeclaration = {
  batteryCellChange: boolean;
  batteryPackOrBmsChange: boolean;
  protectionParameterChange: boolean;
  powerOrThermalBoundaryChange: boolean;
  pressurizedStructureChange: boolean;
  targetMarketExpansion: boolean;
  criticalSafetySupplierChange: boolean;
  safetyRelatedSoftwareChange: boolean;
  eolTestChange: boolean;
  otherSafetyOrRegulatoryChange: boolean;
  targetMarkets: string[];
  notes?: string | null;
};

export const EMPTY_CHANGE_SCOPE_DECLARATION: ProjectChangeScopeDeclaration = {
  batteryCellChange: false,
  batteryPackOrBmsChange: false,
  protectionParameterChange: false,
  powerOrThermalBoundaryChange: false,
  pressurizedStructureChange: false,
  targetMarketExpansion: false,
  criticalSafetySupplierChange: false,
  safetyRelatedSoftwareChange: false,
  eolTestChange: false,
  otherSafetyOrRegulatoryChange: false,
  targetMarkets: [],
  notes: null,
};

const SAFETY_RULES: Array<[keyof ProjectChangeScopeDeclaration, string]> = [
  ["batteryCellChange", "新增或更换电芯"],
  ["batteryPackOrBmsChange", "电池包/BMS/保护板变化"],
  ["protectionParameterChange", "充放电或保护参数变化"],
  ["powerOrThermalBoundaryChange", "功率/电流/温升/连续工作边界变化"],
  ["pressurizedStructureChange", "受压结构或过压保护边界变化"],
  ["criticalSafetySupplierChange", "关键安全件供应商或二供变化"],
  ["safetyRelatedSoftwareChange", "安全相关固件/OTA/APP/烧录变化"],
  ["eolTestChange", "EOL 测试项目/限值/能力变化"],
  ["otherSafetyOrRegulatoryChange", "其他安全或法规变化"],
];

const REGULATORY_RULES: Array<[keyof ProjectChangeScopeDeclaration, string]> = [
  ["batteryCellChange", "电芯变化可能影响认证覆盖"],
  ["batteryPackOrBmsChange", "电池包/BMS/保护板变化可能影响认证覆盖"],
  ["protectionParameterChange", "保护参数变化可能影响认证边界"],
  ["targetMarketExpansion", "新增目标市场"],
  ["criticalSafetySupplierChange", "关键安全件供应商或二供变化"],
  ["safetyRelatedSoftwareChange", "安全相关软件变化可能影响法规结论"],
  ["otherSafetyOrRegulatoryChange", "其他安全或法规变化"],
];

export type SopRiskAssessment = {
  ruleVersion: typeof SOP_RISK_RULE_VERSION;
  safetyRiskLevel: ProjectSopRiskLevel;
  regulatoryRiskLevel: ProjectSopRiskLevel;
  safetyReasons: string[];
  regulatoryReasons: string[];
  addedTargetMarkets: string[];
};

function normalizeMarkets(markets: Iterable<string> | null | undefined): string[] {
  return Array.from(new Set(Array.from(markets ?? [])
    .map((market) => market.trim().toUpperCase())
    .filter(Boolean)))
    .sort();
}

/** Deterministic, structured-only v1 assessment. No notes/text scanning. */
export function deriveSopRiskAssessment(input: {
  declaration: ProjectChangeScopeDeclaration;
  baselineTargetMarkets?: Iterable<string> | null;
  manualSafetyRiskLevel?: ProjectSopRiskLevel | null;
  manualRegulatoryRiskLevel?: ProjectSopRiskLevel | null;
  certificateCoverageMissingReasons?: string[] | null;
}): SopRiskAssessment {
  const declaration = { ...EMPTY_CHANGE_SCOPE_DECLARATION, ...input.declaration };
  const safetyReasons = SAFETY_RULES
    .filter(([key]) => declaration[key] === true)
    .map(([, reason]) => reason);
  const regulatoryReasons = REGULATORY_RULES
    .filter(([key]) => declaration[key] === true)
    .map(([, reason]) => reason);
  const baseline = new Set(normalizeMarkets(input.baselineTargetMarkets));
  const declaredMarkets = normalizeMarkets(declaration.targetMarkets);
  const addedTargetMarkets = declaredMarkets.filter((market) => !baseline.has(market));
  if (addedTargetMarkets.length > 0) {
    regulatoryReasons.push(`目标市场新增：${addedTargetMarkets.join("、")}`);
  }
  if ((input.certificateCoverageMissingReasons?.length ?? 0) > 0) {
    regulatoryReasons.push(`证书覆盖缺口：${input.certificateCoverageMissingReasons!.join("、")}`);
  }
  if (input.manualSafetyRiskLevel === "high") safetyReasons.push("项目主动升级安全风险");
  if (input.manualRegulatoryRiskLevel === "high") regulatoryReasons.push("项目主动升级法规风险");
  return {
    ruleVersion: SOP_RISK_RULE_VERSION,
    safetyRiskLevel: safetyReasons.length > 0 ? "high" : "standard",
    regulatoryRiskLevel: regulatoryReasons.length > 0 ? "high" : "standard",
    safetyReasons: Array.from(new Set(safetyReasons)),
    regulatoryReasons: Array.from(new Set(regulatoryReasons)),
    addedTargetMarkets,
  };
}

export type SopRiskProfile = {
  safetyRiskLevel?: ProjectSopRiskLevel | string | null;
  regulatoryRiskLevel?: ProjectSopRiskLevel | string | null;
};

const PROTECTED_EVIDENCE_RE = /安全|危害|FMEA|可靠性|验证|测试|认证|法规|合规|UN38\.3|MSDS|EMC|EOL|保护|温升|运输/i;

export function isHighSopRisk(profile: SopRiskProfile): boolean {
  return profile.safetyRiskLevel === "high" || profile.regulatoryRiskLevel === "high";
}

export function isHighRiskProtectedTask(task: Pick<SOPTask, "name" | "desc" | "guide" | "visibleRoles">): boolean {
  const roles = new Set(task.visibleRoles ?? []);
  if (roles.has("cert") || roles.has("battery_safety")) return true;
  return PROTECTED_EVIDENCE_RE.test(`${task.name} ${task.desc} ${task.guide}`);
}

export function isHighRiskProtectedDeliverable(name: string): boolean {
  return PROTECTED_EVIDENCE_RE.test(name);
}

export function phaseContainsHighRiskControls(phase: SOPPhase): boolean {
  return phase.tasks.some(isHighRiskProtectedTask) ||
    [...(phase.deliverables ?? []), ...(phase.gateStandard?.requiredDeliverables ?? [])]
      .some(isHighRiskProtectedDeliverable);
}

/** Restore safety/regulatory controls removed by a reusable-module strategy. */
export function restoreHighRiskTasks(base: SOPPhase[], tailored: SOPPhase[]): SOPPhase[] {
  const baseByPhase = new Map(base.map((phase) => [phase.id, phase]));
  return tailored.map((phase) => {
    const basePhase = baseByPhase.get(phase.id);
    if (!basePhase) return phase;
    const ids = new Set(phase.tasks.map((task) => task.id));
    const restored = basePhase.tasks.filter((task) => isHighRiskProtectedTask(task) && !ids.has(task.id));
    return restored.length > 0 ? { ...phase, tasks: [...phase.tasks, ...restored] } : phase;
  });
}
