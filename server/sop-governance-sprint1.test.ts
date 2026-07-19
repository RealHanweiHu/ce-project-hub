import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createProduct,
  createProductCertificate,
  createProjectGateReview,
  createProjectWithSeed,
  extendProjectCondition,
  getDb,
  getProjectCertificationCoverage,
  getProjectConditionsReadiness,
  listProjectConditions,
  resolveProjectCondition,
  reviewProductCertificate,
} from "./db";
import { EMPTY_CHANGE_SCOPE_DECLARATION, deriveSopRiskAssessment } from "../shared/sop-risk";
import { SOP_TEMPLATE_VERSION_CURRENT } from "../shared/sop-templates";
import { actionItems } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const PRODUCT_ID = "sprint1_cert_product";
const PROJECT_ID = "sprint1_cert_project";

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM action_items WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PRODUCT_ID}`);
}

describe("SOP governance Sprint 1", () => {
  beforeAll(async () => {
    await cleanup();
    await createProduct({ id: PRODUCT_ID, name: "Sprint1 认证产品", type: "finished", category: "充气泵", createdBy: 1 });
    const declaration = { ...EMPTY_CHANGE_SCOPE_DECLARATION, batteryCellChange: true };
    await createProjectWithSeed({
      id: PROJECT_ID,
      name: "Sprint1 认证与条件项目",
      projectNumber: "SPRINT1-CERT",
      category: "npd",
      productId: PRODUCT_ID,
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      createdBy: 1,
      sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
      safetyRiskLevel: "high",
      regulatoryRiskLevel: "high",
    }, "npd", 1, { declaration, assessment: deriveSopRiskAssessment({ declaration }) });
  });

  afterAll(cleanup);

  it("blocks coverage until all structured battery certificates are valid", async () => {
    const missing = await getProjectCertificationCoverage(PROJECT_ID);
    expect(missing.covered).toBe(false);
    expect(missing.missing.map((item) => item.type)).toEqual(["un38_3", "msds", "battery_safety"]);

    for (const type of ["un38_3", "msds", "battery_safety"] as const) {
      const certificate = await createProductCertificate({
        productId: PRODUCT_ID,
        projectId: PROJECT_ID,
        revisionId: null,
        type,
        scopeType: "product_family",
        certificateNumber: `${type}-2026`,
        issuingBody: "Test Lab",
        targetMarkets: [],
        validFrom: "2026-01-01",
        validUntil: "2027-01-01",
        evidenceFileId: null,
        evidenceReference: `DCC-${type}`,
        reuseApproved: false,
        reuseBasis: null,
        createdBy: 1,
      });
      await reviewProductCertificate({ id: certificate.id, status: "valid", reviewedBy: 1 });
    }

    expect((await getProjectCertificationCoverage(PROJECT_ID)).covered).toBe(true);
  });

  it("creates a controlled condition from a conditional Gate; extension never counts as closure", async () => {
    const reviewId = await createProjectGateReview({
      projectId: PROJECT_ID,
      phaseId: "concept",
      phaseName: "概念",
      gateName: "立项评审",
      reviewDate: "2026-07-10",
      decision: "conditional",
      conditions: "补齐电芯复用边界报告",
      conditionOwnerUserId: 1,
      conditionDueDate: "2026-07-20",
      createdBy: 1,
    });
    const [condition] = (await listProjectConditions(PROJECT_ID)).filter((row) => row.sourceType === "gate" && row.sourceId === String(reviewId));
    expect(condition?.status).toBe("open");
    const db = await getDb();
    const [actionItem] = await db!.select().from(actionItems).where(and(eq(actionItems.entityType, "condition"), eq(actionItems.entityId, String(condition.id))));
    expect(actionItem?.kind).toBe("condition_followup");
    expect(actionItem?.recipientUserId).toBe(1);
    expect((await getProjectConditionsReadiness(PROJECT_ID)).ready).toBe(false);

    await extendProjectCondition({ id: condition.id, projectId: PROJECT_ID, dueDate: "2026-07-31", note: "实验室排期延后", updatedBy: 1 });
    expect((await listProjectConditions(PROJECT_ID)).find((row) => row.id === condition.id)?.status).toBe("open");
    expect((await getProjectConditionsReadiness(PROJECT_ID)).ready).toBe(false);

    await resolveProjectCondition({ id: condition.id, projectId: PROJECT_ID, resolution: "closed", note: "报告已归档 DCC-001", resolvedBy: 1 });
    expect((await getProjectConditionsReadiness(PROJECT_ID)).ready).toBe(true);
    const [closedActionItem] = await db!.select().from(actionItems).where(eq(actionItems.id, actionItem.id));
    expect(closedActionItem.status).toBe("closed");
  });
});
