import type { ProjectCategory, SOPPhase } from "./sop-templates";

export const GATE_SIGNOFF_SLOTS = [
  "product",
  "engineering",
  "qa",
  "scm",
  "npi",
  "certification",
  "customer",
] as const;

export type GateSignoffSlot = (typeof GATE_SIGNOFF_SLOTS)[number];

export const GATE_SIGNOFF_REQUIREMENTS = ["required", "conditional", "not_applicable"] as const;
export type GateSignoffRequirement = (typeof GATE_SIGNOFF_REQUIREMENTS)[number];

export const GATE_SIGNOFF_STATUSES = ["pending", "approved", "conditional", "rejected", "not_applicable"] as const;
export type GateSignoffStatus = (typeof GATE_SIGNOFF_STATUSES)[number];

export const GATE_SIGNOFF_ROUND_STATUSES = ["open", "superseded", "completed"] as const;
export type GateSignoffRoundStatus = (typeof GATE_SIGNOFF_ROUND_STATUSES)[number];

export const GATE_SIGNOFF_SLOT_LABELS: Record<GateSignoffSlot, string> = {
  product: "产品",
  engineering: "研发",
  qa: "QA",
  scm: "SCM",
  npi: "NPI",
  certification: "认证",
  customer: "客户",
};

export const GATE_SIGNOFF_REQUIREMENT_LABELS: Record<GateSignoffRequirement, string> = {
  required: "必签",
  conditional: "条件签",
  not_applicable: "不适用",
};

export const GATE_SIGNOFF_STATUS_LABELS: Record<GateSignoffStatus, string> = {
  pending: "待签",
  approved: "已同意",
  conditional: "有条件同意",
  rejected: "拒绝",
  not_applicable: "不适用",
};

export const GATE_SIGNOFF_SLOT_ROLES: Record<GateSignoffSlot, readonly string[]> = {
  product: ["pm"],
  engineering: ["rd_hw", "rd_sw", "rd_mech"],
  qa: ["qa"],
  scm: ["scm"],
  npi: ["pe", "mfg"],
  certification: ["cert", "battery_safety"],
  customer: ["external_customer", "sales"],
};

export type GateSignoffRiskContext = {
  safetyRiskLevel?: "standard" | "high" | string | null;
  regulatoryRiskLevel?: "standard" | "high" | string | null;
};

const REQUIREMENT_RANK: Record<GateSignoffRequirement, number> = {
  not_applicable: 0,
  conditional: 1,
  required: 2,
};

function requirementSet(
  required: GateSignoffSlot[],
  conditional: GateSignoffSlot[] = [],
): Record<GateSignoffSlot, GateSignoffRequirement> {
  return Object.fromEntries(GATE_SIGNOFF_SLOTS.map((slot) => [
    slot,
    required.includes(slot) ? "required" : conditional.includes(slot) ? "conditional" : "not_applicable",
  ])) as Record<GateSignoffSlot, GateSignoffRequirement>;
}

/**
 * Versioned policy input for every category/phase. Requirements are explicit;
 * human-readable Gate text is presentation only and is never parsed.
 */
export const GATE_SIGNOFF_REQUIREMENT_MATRIX: Record<string, Record<string, Record<GateSignoffSlot, GateSignoffRequirement>>> = {
  npd: {
    concept: requirementSet(["product", "engineering", "scm", "certification"], ["qa"]),
    planning: requirementSet(["product", "engineering", "qa", "scm", "certification"]),
    design: requirementSet(["product", "engineering", "qa", "scm", "npi", "certification"]),
    evt: requirementSet(["product", "engineering", "qa", "npi"], ["certification"]),
    dvt: requirementSet(["engineering", "qa", "scm", "npi", "certification"], ["product"]),
    // Lite merges EVT + DVT into one verification Gate, so preserve the union
    // of both professional sign-off boundaries instead of falling back to preview-only slots.
    verification: requirementSet(["product", "engineering", "qa", "scm", "npi", "certification"]),
    pvt: requirementSet(["product", "engineering", "qa", "scm", "npi", "certification"]),
    mp: requirementSet(["product", "qa", "scm", "npi"], ["engineering", "certification"]),
  },
  eco: {
    planning: requirementSet(["product", "engineering", "qa", "scm", "certification"]),
    design: requirementSet(["engineering", "qa", "scm", "npi", "certification"], ["product"]),
    evt: requirementSet(["product", "engineering", "qa", "npi"], ["certification"]),
    pvt: requirementSet(["qa", "scm", "npi"], ["product", "engineering", "certification"]),
    mp: requirementSet(["product", "qa", "scm", "npi"], ["engineering", "certification"]),
  },
  derivative: {
    iteration: requirementSet(["product", "engineering", "qa", "scm", "certification"], ["npi"]),
    design: requirementSet(["engineering", "qa", "scm", "npi", "certification"], ["product"]),
    evt: requirementSet(["product", "engineering", "qa"], ["npi", "certification"]),
    dvt: requirementSet(["engineering", "qa", "scm", "npi", "certification"], ["product"]),
    pvt: requirementSet(["engineering", "qa", "scm", "npi", "certification"], ["product"]),
    mp: requirementSet(["product", "qa", "scm", "npi"], ["engineering", "certification"]),
  },
  idr: {
    design: requirementSet(["product", "engineering", "qa", "scm", "certification"], ["npi"]),
    engineering: requirementSet(["product", "engineering", "qa", "scm", "certification"], ["npi"]),
    dvt: requirementSet(["product", "engineering", "qa", "npi", "certification"], ["scm"]),
    mp: requirementSet(["product", "qa", "scm", "npi", "certification"], ["engineering"]),
    stabilization: requirementSet(["product", "engineering", "qa", "scm", "npi", "certification"]),
  },
  jdm: {
    input: requirementSet(["product", "engineering", "qa", "scm", "certification", "customer"], ["npi"]),
    design: requirementSet(["product", "engineering", "qa", "customer"], ["scm", "npi", "certification"]),
    evt: requirementSet(["product", "engineering", "qa", "npi", "customer"], ["certification"]),
    dvt: requirementSet(["product", "engineering", "qa", "scm", "npi", "certification", "customer"]),
    pvt: requirementSet(["product", "engineering", "qa", "scm", "npi", "certification", "customer"]),
    mp: requirementSet(["product", "qa", "scm", "npi", "customer"], ["engineering", "certification"]),
  },
  obt: {
    intake: requirementSet(["scm", "npi", "customer"], ["product", "engineering", "qa", "certification"]),
    sample: requirementSet(["engineering", "qa", "npi", "customer"], ["product", "scm", "certification"]),
    pvt: requirementSet(["qa", "scm", "npi", "certification", "customer"], ["product", "engineering"]),
    mp: requirementSet(["product", "qa", "scm", "npi", "certification", "customer"], ["engineering"]),
  },
};

export function promoteGateSignoffRequirement(
  current: GateSignoffRequirement,
  requested: GateSignoffRequirement,
): GateSignoffRequirement {
  return REQUIREMENT_RANK[requested] > REQUIREMENT_RANK[current] ? requested : current;
}

/**
 * Resolve executable requirements from the explicit policy matrix.
 * High safety/regulatory risk is a one-way ratchet: it can only add mandatory
 * engineering/QA/certification signatures, never reduce them.
 */
export function buildGateSignoffRequirements(
  category: ProjectCategory | string,
  phase: SOPPhase,
  risk: GateSignoffRiskContext = {},
  additions: Partial<Record<GateSignoffSlot, GateSignoffRequirement>> = {},
): Record<GateSignoffSlot, GateSignoffRequirement> {
  const configured = GATE_SIGNOFF_REQUIREMENT_MATRIX[category]?.[phase.id];
  const result = configured
    ? { ...configured }
    : requirementSet([], ["product", "engineering", "qa"]);

  for (const slot of GATE_SIGNOFF_SLOTS) {
    const addition = additions[slot];
    if (addition) result[slot] = promoteGateSignoffRequirement(result[slot], addition);
  }

  if (risk.safetyRiskLevel === "high" || risk.regulatoryRiskLevel === "high") {
    result.engineering = "required";
    result.qa = "required";
    result.certification = "required";
  }

  return result;
}

export function canProjectRoleSignSlot(
  roleOrRoles: string | Iterable<string> | null | undefined,
  slot: GateSignoffSlot,
): boolean {
  if (!roleOrRoles) return false;
  const roles = typeof roleOrRoles === "string" ? [roleOrRoles] : Array.from(roleOrRoles);
  return roles.some((role) => GATE_SIGNOFF_SLOT_ROLES[slot].includes(role));
}

export function gateSignoffsReady(
  requirements: Record<GateSignoffSlot, GateSignoffRequirement>,
  statuses: Partial<Record<GateSignoffSlot, GateSignoffStatus>>,
): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  for (const slot of GATE_SIGNOFF_SLOTS) {
    const requirement = requirements[slot];
    const status = statuses[slot] ?? (requirement === "not_applicable" ? "not_applicable" : "pending");
    if (status === "rejected") blockers.push(`${GATE_SIGNOFF_SLOT_LABELS[slot]}已拒绝会签`);
    if (requirement === "required" && status !== "approved") {
      blockers.push(`${GATE_SIGNOFF_SLOT_LABELS[slot]}必签未完成`);
    }
  }
  return { ready: blockers.length === 0, blockers: Array.from(new Set(blockers)) };
}
