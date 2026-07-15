import { describe, expect, it } from "vitest";
import { PROJECT_CATEGORIES, getPhasesForCategory } from "./sop-templates";
import { getNpdV3EffectivePhases } from "./npd-v3";
import {
  GATE_SIGNOFF_REQUIREMENT_MATRIX,
  GATE_SIGNOFF_SLOTS,
  buildGateSignoffRequirements,
  canProjectRoleSignSlot,
  gateSignoffsReady,
  promoteGateSignoffRequirement,
} from "./gate-signoffs";

describe("Gate structured sign-offs", () => {
  it("requires risk owners named by the Gate RACI", () => {
    const phase = getPhasesForCategory("npd")[0];
    const requirements = buildGateSignoffRequirements("npd", phase);
    expect(requirements.product).toBe("required");
    expect(requirements.engineering).toBe("required");
    expect(requirements.scm).toBe("required");
    expect(requirements.certification).toBe("required");
  });

  it("upgrades engineering/QA/certification for high safety or regulatory risk", () => {
    const phase = getPhasesForCategory("eco")[0];
    const requirements = buildGateSignoffRequirements("eco", phase, {
      safetyRiskLevel: "high",
      regulatoryRiskLevel: "high",
    });
    expect(requirements.engineering).toBe("required");
    expect(requirements.qa).toBe("required");
    expect(requirements.certification).toBe("required");
  });

  it("defines required sign-offs for the lite verification Gate", () => {
    const phase = getNpdV3EffectivePhases({ tier: "lite", packs: [] })
      .find((item) => item.id === "verification")!;
    const requirements = buildGateSignoffRequirements("npd", phase, {
      safetyRiskLevel: "standard",
      regulatoryRiskLevel: "standard",
    });
    for (const slot of ["product", "engineering", "qa", "scm", "npi", "certification"] as const) {
      expect(requirements[slot], slot).toBe("required");
    }
    expect(requirements.customer).toBe("not_applicable");
  });

  it("requires customer signatures on JDM/OBT and blocks management until required slots approve", () => {
    const phase = getPhasesForCategory("jdm")[0];
    const requirements = buildGateSignoffRequirements("jdm", phase);
    expect(requirements.customer).toBe("required");
    expect(requirements.product).toBe("required");
    expect(requirements.qa).toBe("required");
    const pending = gateSignoffsReady(requirements, {});
    expect(pending.ready).toBe(false);
    const approved = Object.fromEntries(
      Object.entries(requirements).map(([slot, requirement]) => [slot, requirement === "required" ? "approved" : "not_applicable"])
    );
    expect(gateSignoffsReady(requirements, approved as any).ready).toBe(true);
  });

  it("defines all seven slots explicitly for every supported track and phase", () => {
    for (const category of PROJECT_CATEGORIES) {
      for (const phase of category.phases) {
        const configured = GATE_SIGNOFF_REQUIREMENT_MATRIX[category.id]?.[phase.id];
        expect(configured, `${category.id}/${phase.id}`).toBeTruthy();
        expect(Object.keys(configured ?? {}).sort()).toEqual([...GATE_SIGNOFF_SLOTS].sort());
      }
    }
  });

  it("does not infer customer signatures from Gate prose on non-customer tracks", () => {
    for (const category of PROJECT_CATEGORIES.filter((item) => !["jdm", "obt"].includes(item.id))) {
      for (const phase of category.phases) {
        expect(buildGateSignoffRequirements(category.id, phase).customer).toBe("not_applicable");
      }
    }
  });

  it("allows project additions to increase a requirement but never reduce it", () => {
    expect(promoteGateSignoffRequirement("not_applicable", "conditional")).toBe("conditional");
    expect(promoteGateSignoffRequirement("conditional", "required")).toBe("required");
    expect(promoteGateSignoffRequirement("required", "conditional")).toBe("required");
    expect(promoteGateSignoffRequirement("required", "not_applicable")).toBe("required");
  });

  it("matches a Gate slot against the full effective role set", () => {
    expect(canProjectRoleSignSlot(new Set(["qa", "scm"]), "scm")).toBe(true);
    expect(canProjectRoleSignSlot(new Set(["qa", "scm"]), "engineering")).toBe(false);
  });
});
