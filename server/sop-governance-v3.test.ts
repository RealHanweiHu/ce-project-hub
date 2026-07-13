import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addProjectGateSignoffRequirement,
  createProjectChangeScopeDeclarationVersion,
  createProjectWithSeed,
  getCurrentGateSignoffRound,
  getDb,
  getProjectGateSignoffRequirements,
  getOpenProjectGateSignoffRound,
  openProjectGateSignoffRound,
  assertProjectGateSignoffsComplete,
} from "./db";
import {
  EMPTY_CHANGE_SCOPE_DECLARATION,
  deriveSopRiskAssessment,
} from "../shared/sop-risk";
import { SOP_TEMPLATE_VERSION_CURRENT, SOP_TEMPLATE_VERSION_NPD_V3 } from "../shared/sop-templates";

const PROJECT_ID = "sop_v3_round_test";
const LITE_PROJECT_ID = "sop_v3_lite_signoff_test";

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${LITE_PROJECT_ID}`);
}

describe("SOP governance v3 round snapshots", () => {
  beforeAll(async () => {
    await cleanup();
    await createProjectWithSeed({
      id: PROJECT_ID,
      name: "SOP v3 会签轮次测试",
      projectNumber: "SOP-V3-ROUND",
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      createdBy: 1,
      sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
      safetyRiskLevel: "standard",
      regulatoryRiskLevel: "standard",
    }, "npd", 1);
    await createProjectWithSeed({
      id: LITE_PROJECT_ID,
      name: "SOP v3 轻量验证会签测试",
      projectNumber: "SOP-V3-LITE-SIGNOFF",
      category: "npd",
      risk: "low",
      currentPhase: "verification",
      progress: 0,
      createdBy: 1,
      sopTemplateVersion: SOP_TEMPLATE_VERSION_NPD_V3,
      safetyRiskLevel: "standard",
      regulatoryRiskLevel: "standard",
      customFields: { npdTemplate: { tier: "lite", packs: [] } },
    }, "npd", 1);
  });

  afterAll(cleanup);

  it("requires explicit merged EVT/DVT sign-offs for a standard-risk lite verification Gate", async () => {
    const requirements = await getProjectGateSignoffRequirements(LITE_PROJECT_ID, "verification");
    expect(requirements).toMatchObject({
      product: "required",
      engineering: "required",
      qa: "required",
      scm: "required",
      npi: "required",
      certification: "required",
      customer: "not_applicable",
    });
    await expect(assertProjectGateSignoffsComplete(LITE_PROJECT_ID, "verification", 1))
      .rejects.toThrow(/Gate 会签未完成/);
  });

  it("supersedes an open round on risk escalation and reopens from a fresh snapshot", async () => {
    const first = await openProjectGateSignoffRound({ projectId: PROJECT_ID, phaseId: "concept", openedBy: 1 });
    expect(first.roundNumber).toBe(1);
    expect(first.status).toBe("open");
    expect(first.requirements.qa).toBe("conditional");

    const declaration = { ...EMPTY_CHANGE_SCOPE_DECLARATION, batteryCellChange: true };
    await createProjectChangeScopeDeclarationVersion({
      projectId: PROJECT_ID,
      declaration,
      assessment: deriveSopRiskAssessment({ declaration }),
      declaredBy: 1,
    });

    expect(await getOpenProjectGateSignoffRound(PROJECT_ID, "concept")).toBeNull();
    expect(await getCurrentGateSignoffRound(PROJECT_ID, "concept")).toBe(2);

    const second = await openProjectGateSignoffRound({ projectId: PROJECT_ID, phaseId: "concept", openedBy: 1 });
    expect(second.roundNumber).toBe(2);
    expect(second.riskSnapshot.safetyRiskLevel).toBe("high");
    expect(second.requirements.engineering).toBe("required");
    expect(second.requirements.qa).toBe("required");
    expect(second.requirements.certification).toBe("required");
  });

  it("treats project-level add-sign as an increase-only policy change and reopens the round", async () => {
    await addProjectGateSignoffRequirement({
      projectId: PROJECT_ID,
      phaseId: "concept",
      slot: "customer",
      requirement: "required",
      reason: "本 NPD 为客户定制项目",
      addedBy: 1,
    });

    expect(await getOpenProjectGateSignoffRound(PROJECT_ID, "concept")).toBeNull();
    expect(await getCurrentGateSignoffRound(PROJECT_ID, "concept")).toBe(3);

    const third = await openProjectGateSignoffRound({ projectId: PROJECT_ID, phaseId: "concept", openedBy: 1 });
    expect(third.roundNumber).toBe(3);
    expect(third.requirements.customer).toBe("required");
    await expect(addProjectGateSignoffRequirement({
      projectId: PROJECT_ID,
      phaseId: "concept",
      slot: "customer",
      requirement: "conditional",
      reason: "试图降级",
      addedBy: 1,
    })).rejects.toThrow(/不能降级或重复加签/);
  });
});
