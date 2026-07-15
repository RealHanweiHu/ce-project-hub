import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  acceptProjectCloseHandoff,
  createProduct,
  createProductRevision,
  createProjectWithSeed,
  getDb,
  getProjectById,
  getProjectCloseHandoffReadiness,
  getProductById,
  saveProjectCloseHandoffDraft,
  submitProjectCloseHandoff,
} from "./db";
import { handoffsRouter } from "./routers/handoffs";
import {
  actionItems,
  activityLogs,
  mpReleases,
  productRevisions,
  productServiceCases,
  products,
  projects,
} from "../drizzle/schema";
import { EMPTY_CHANGE_SCOPE_DECLARATION } from "../shared/sop-risk";
import { SOP_TEMPLATE_VERSION_CURRENT } from "../shared/sop-templates";

const suffix = Date.now().toString(36);
const PRODUCT_ID = `s2_product_${suffix}`;
const PROJECT_ID = `s2_project_${suffix}`;
const OWNER = 1;
let revisionId = 0;
let ecoProjectId: string | null = null;

const caller = handoffsRouter.createCaller({
  user: { id: OWNER, role: "admin", name: "Sprint2 Owner", canCreateProject: true },
} as any);

const completeItems = [
  { itemKey: "controlled_documents" as const, completed: true, evidenceReference: "DCC-RELEASE-PACK" },
  { itemKey: "maintenance_scope" as const, completed: true, evidenceReference: "OPS-RACI-001" },
  { itemKey: "after_sales_process" as const, completed: true, evidenceReference: "SOP-AFTER-SALES-001" },
  { itemKey: "eco_process" as const, completed: true, evidenceReference: "SOP-ECO-001" },
];

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(productServiceCases).where(eq(productServiceCases.productId, PRODUCT_ID));
  if (ecoProjectId) {
    await db.delete(actionItems).where(eq(actionItems.projectId, ecoProjectId));
    await db.delete(activityLogs).where(eq(activityLogs.projectId, ecoProjectId));
    await db.delete(projects).where(eq(projects.id, ecoProjectId));
    ecoProjectId = null;
  }
  await db.delete(actionItems).where(eq(actionItems.projectId, PROJECT_ID));
  const linkedProjects = await db.select({ id: projects.id }).from(projects).where(eq(projects.productId, PRODUCT_ID));
  for (const row of linkedProjects) {
    await db.delete(actionItems).where(eq(actionItems.projectId, row.id));
    await db.delete(activityLogs).where(eq(activityLogs.projectId, row.id));
    await db.delete(projects).where(eq(projects.id, row.id));
  }
  await db.delete(mpReleases).where(eq(mpReleases.productId, PRODUCT_ID));
  await db.delete(productRevisions).where(eq(productRevisions.productId, PRODUCT_ID));
  await db.delete(products).where(eq(products.id, PRODUCT_ID));
}

describe("SOP governance Sprint 2", () => {
  beforeAll(async () => {
    await cleanup();
    await createProduct({ id: PRODUCT_ID, name: "Sprint2 量产产品", productNumber: "S2-01", type: "finished", category: "充气泵", targetMarkets: ["US"], createdBy: OWNER });
    revisionId = await createProductRevision({
      productId: PRODUCT_ID,
      revisionLabel: "Rev A",
      status: "released",
      releasedBy: OWNER,
      releasedAt: new Date(),
    });
    const db = await getDb();
    await db!.update(products).set({ currentRevisionId: revisionId, lifecycleState: "mass_production" }).where(eq(products.id, PRODUCT_ID));
    await createProjectWithSeed({
      id: PROJECT_ID,
      name: "Sprint2 关闭移交项目",
      projectNumber: "S2-CLOSE",
      category: "npd",
      sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
      productId: PRODUCT_ID,
      resultRevisionId: revisionId,
      risk: "low",
      currentPhase: "mp",
      progress: 95,
      createdBy: OWNER,
    }, "npd", OWNER);
    await db!.insert(mpReleases).values({
      productId: PRODUCT_ID,
      revisionId: null,
      projectId: PROJECT_ID,
      releasedBy: OWNER,
      releasedAt: new Date(),
    });
  });

  afterAll(cleanup);

  it("requires complete evidence, creates an acceptance action, and invalidates acceptance on edits", async () => {
    await saveProjectCloseHandoffDraft({
      projectId: PROJECT_ID,
      maintenanceOwnerUserId: OWNER,
      afterSalesOwnerUserId: OWNER,
      scopeSummary: "产品维护承接版本、售后与 ECO。",
      items: completeItems.map((item) => item.itemKey === "eco_process" ? { ...item, evidenceReference: null } : item),
      savedBy: OWNER,
    });
    await expect(submitProjectCloseHandoff(PROJECT_ID, OWNER)).rejects.toThrow(/证据引用/);

    await saveProjectCloseHandoffDraft({
      projectId: PROJECT_ID,
      maintenanceOwnerUserId: OWNER,
      afterSalesOwnerUserId: OWNER,
      scopeSummary: "产品维护承接版本、售后与 ECO。",
      items: completeItems,
      savedBy: OWNER,
    });
    const submitted = await submitProjectCloseHandoff(PROJECT_ID, OWNER);
    const db = await getDb();
    const [action] = await db!.select().from(actionItems).where(and(
      eq(actionItems.entityType, "close_handoff"),
      eq(actionItems.entityId, String(submitted.handoff.id)),
    ));
    expect(action.kind).toBe("handoff_acceptance");
    expect(action.recipientUserId).toBe(OWNER);
    expect((await getProjectCloseHandoffReadiness(PROJECT_ID)).ready).toBe(false);
    await expect(acceptProjectCloseHandoff(PROJECT_ID, 999)).rejects.toThrow(/指定的产品维护责任人/);

    await acceptProjectCloseHandoff(PROJECT_ID, OWNER);
    expect((await getProjectCloseHandoffReadiness(PROJECT_ID)).ready).toBe(true);
    expect((await getProductById(PRODUCT_ID))?.maintenanceOwnerUserId).toBe(OWNER);
    expect((await getProductById(PRODUCT_ID))?.afterSalesOwnerUserId).toBe(OWNER);

    await saveProjectCloseHandoffDraft({
      projectId: PROJECT_ID,
      maintenanceOwnerUserId: OWNER,
      afterSalesOwnerUserId: OWNER,
      scopeSummary: "边界有更新，必须重新接收。",
      items: completeItems,
      savedBy: OWNER,
    });
    expect((await getProjectCloseHandoffReadiness(PROJECT_ID)).status).toBe("draft");
    expect((await getProjectCloseHandoffReadiness(PROJECT_ID)).ready).toBe(false);
    await submitProjectCloseHandoff(PROJECT_ID, OWNER);
    await acceptProjectCloseHandoff(PROJECT_ID, OWNER);
  });

  it("provides a real after-sales record and creates ECO from the released baseline", async () => {
    const serviceCase = await caller.createServiceCase({
      productId: PRODUCT_ID,
      title: "量产批次偶发停机",
      description: "客户现场出现间歇停机，需要分析保护参数。",
      severity: "P1",
    });
    expect(serviceCase.ownerUserId).toBe(OWNER);

    const eco = await caller.createEco({
      productId: PRODUCT_ID,
      serviceCaseId: serviceCase.id,
      name: "S2-01 停机问题 ECO",
      reason: "调整保护参数并补充回归验证。",
      changeScopeDeclaration: {
        ...EMPTY_CHANGE_SCOPE_DECLARATION,
        protectionParameterChange: true,
        targetMarkets: ["US"],
      },
    });
    ecoProjectId = eco.id;
    const project = await getProjectById(eco.id);
    expect(project?.category).toBe("eco");
    expect(project?.productId).toBeNull();
    expect(project?.baseRevisionId).toBeNull();
    expect(project?.customFields).toMatchObject({
      sourceProductId: PRODUCT_ID,
      sourceServiceCaseId: serviceCase.id,
    });
    expect(project?.safetyRiskLevel).toBe("high");
    const db = await getDb();
    const [updatedCase] = await db!.select().from(productServiceCases).where(eq(productServiceCases.id, serviceCase.id));
    expect(updatedCase.linkedEcoProjectId).toBe(eco.id);
    expect(updatedCase.status).toBe("in_progress");
  });
});
