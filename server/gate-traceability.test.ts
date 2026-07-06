import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createProjectFile,
  createProjectTestCase,
  createProjectTestPlan,
  createProjectTestReport,
  getDb,
  reviewProjectTestReport,
} from "./db";
import { appRouter } from "./routers";
import {
  activityLogs,
  bomItems,
  customerVariants,
  productRevisions,
  products,
  projectGateReviews,
  projectFiles,
  projectMembers,
  projectTestCases,
  projectTestPlans,
  projectTestReports,
  projects,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const SUFFIX = Date.now();
const PRODUCT = `trace-prod-${SUFFIX}`;
const PROJECT = `trace-proj-${SUFFIX}`;
const OWNER = 984001;
const SUPPLIER = 984002;

let baseRevisionId = 0;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `gate-trace-${userId}`,
      username: null,
      passwordHash: null,
      name: `GateTrace${userId}`,
      email: null,
      loginMethod: null,
      role: "user",
      canCreateProject: false,
      mobile: null,
      dingtalkUserId: null,
      dingtalkCorpUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");

  await db.insert(products).values({
    id: PRODUCT,
    productNumber: "PEP-R1",
    name: "Pocket E-Pump R1",
    type: "finished",
    category: "rechargeable mini bicycle tire inflator",
    lifecycleState: "development",
    createdBy: OWNER,
    productManagerUserId: OWNER,
  });
  const [baseRevision] = await db.insert(productRevisions).values({
    productId: PRODUCT,
    revisionLabel: "Rev A",
    status: "released",
    releasedAt: new Date(),
    releasedBy: OWNER,
  }).returning({ id: productRevisions.id });
  baseRevisionId = baseRevision.id;

  await db.insert(projects).values({
    id: PROJECT,
    name: "Pocket E-Pump R1 Decathlon NPD",
    projectNumber: PROJECT,
    category: "npd",
    currentPhase: "evt",
    risk: "low",
    customer: "Decathlon",
    productId: PRODUCT,
    baseRevisionId,
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values({
    projectId: PROJECT,
    userId: SUPPLIER,
    role: "supplier",
    invitedBy: OWNER,
  });
  await db.insert(bomItems).values([
    {
      projectId: PROJECT,
      partNumber: "PCBA-EP-R1",
      name: "PCBA assembly",
      spec: "USB-C charge, display, pressure sensor",
      quantity: 1,
      refDesignator: "A1",
      supplierName: "Internal PCBA Supplier",
      unitCost: "4.20",
      sortOrder: 1,
    },
    {
      projectId: PROJECT,
      partNumber: "CELL-18650-2S",
      name: "Lithium battery pack",
      spec: "2S protected rechargeable pack",
      quantity: 1,
      refDesignator: "BT1",
      supplierName: "Internal Battery Supplier",
      unitCost: "3.80",
      sortOrder: 2,
    },
  ]);
  await db.insert(customerVariants).values({
    variantCode: "PEP-R1-Decathlon-D1",
    customerSku: "DEC-PEP-R1",
    parentProductId: PRODUCT,
    baseRevision: "Rev A",
    customerId: "decathlon",
    customerName: "Decathlon",
    status: "active",
    deltas: [
      { dimension: "other", variantValue: "Decathlon BOM Rev D1", note: "customer_bom_revision" },
      { dimension: "language_doc", variantValue: "EU multilingual manual" },
    ],
    customerApproved: true,
    goldenSampleRef: "GS-DEC-PEP-R1",
    sourceType: "eco",
    sourceRefId: "ECO-DEC-001",
    createdBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, PROJECT));
  await db.delete(projectTestReports).where(eq(projectTestReports.projectId, PROJECT));
  await db.delete(projectTestCases).where(eq(projectTestCases.projectId, PROJECT));
  await db.delete(projectTestPlans).where(eq(projectTestPlans.projectId, PROJECT));
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(bomItems).where(eq(bomItems.projectId, PROJECT));
  await db.delete(customerVariants).where(eq(customerVariants.parentProductId, PRODUCT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(productRevisions).where(eq(productRevisions.productId, PRODUCT));
  await db.delete(products).where(eq(products.id, PRODUCT));
});

describe("gate review traceability", () => {
  it("captures product revision, working BOM, and customer version context at Gate review", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));
    const reportFileId = await createProjectFile({
      projectId: PROJECT,
      phaseId: "evt",
      taskId: "e7",
      deliverableName: "EVT Test Report",
      name: "evt-trace-report.pdf",
      mimeType: "application/pdf",
      size: 1,
      storageKey: `${PROJECT}/evt-trace-report`,
      storageUrl: `/storage/${PROJECT}/evt-trace-report`,
      uploadedBy: OWNER,
    });
    const planId = await createProjectTestPlan({
      projectId: PROJECT,
      phaseId: "evt",
      title: "EVT Validation Plan",
      scope: "Battery temperature and pump endurance",
      sampleSize: "T1 x 12",
      status: "active",
      createdBy: OWNER,
    });
    const reportId = await createProjectTestReport({
      projectId: PROJECT,
      phaseId: "evt",
      planId,
      title: "EVT Validation Report",
      reportNo: "EVT-TRACE-001",
      result: "conditional",
      reviewStatus: "pending",
      summary: "Battery temperature needs rework.",
      fileId: reportFileId,
      submittedBy: OWNER,
    });
    await reviewProjectTestReport(reportId, OWNER, "approved");
    await createProjectTestCase({
      projectId: PROJECT,
      phaseId: "evt",
      planId,
      title: "Battery pack temperature rise",
      category: "safety",
      acceptanceCriteria: "Surface temperature within limit",
      method: "Continuous inflation endurance",
      sampleSerials: ["EVT-T1-007"],
      severity: "P1",
      status: "failed",
      resultNotes: "Temperature exceeded limit.",
      createdBy: OWNER,
      updatedBy: OWNER,
    });

    await caller.gateReviews.create({
      projectId: PROJECT,
      phaseId: "evt",
      phaseName: "EVT",
      gateName: "EVT Review",
      reviewDate: "2026-07-05",
      participants: "PM, QA, PE, RD",
      decision: "rejected",
      notes: "Battery temperature and pump endurance need rework.",
    });

    const rows = await caller.gateReviews.list({ projectId: PROJECT, phaseId: "evt" });
    expect(rows).toHaveLength(1);
    const review = rows[0];
    expect(review.productId).toBe(PRODUCT);
    expect(review.baseRevisionId).toBe(baseRevisionId);
    expect(review.resultRevisionId).toBeNull();

    const trace = review.traceSnapshot!;
    expect(trace.product?.name).toBe("Pocket E-Pump R1");
    expect(trace.baseRevision?.revisionLabel).toBe("Rev A");
    expect(trace.workingBom.lineCount).toBe(2);
    expect(trace.workingBom.rows.map((row) => row.partNumber)).toEqual(["PCBA-EP-R1", "CELL-18650-2S"]);
    expect("unitCost" in trace.workingBom.rows[0]).toBe(false);
    expect("supplierName" in trace.workingBom.rows[0]).toBe(false);
    expect(trace.customerVariants).toMatchObject([
      {
        variantCode: "PEP-R1-Decathlon-D1",
        customerName: "Decathlon",
        customerBomRevision: "Decathlon BOM Rev D1",
        customerApproved: true,
      },
    ]);
    expect(trace.testEvidence).toMatchObject({
      planCount: 1,
      reportCount: 1,
      approvedReportCount: 1,
      failedCaseCount: 1,
      unresolvedFailedCaseCount: 1,
    });
    expect(trace.testEvidence?.reports[0]).toMatchObject({ reportNo: "EVT-TRACE-001", fileId: reportFileId });
    expect(trace.testEvidence?.failedCases[0]).toMatchObject({
      title: "Battery pack temperature rise",
      sampleSerials: ["EVT-T1-007"],
    });
  });

  it("does not expose Gate trace history to supplier collaborators", async () => {
    const supplierCaller = appRouter.createCaller(makeCtx(SUPPLIER));
    await expect(supplierCaller.gateReviews.list({ projectId: PROJECT, phaseId: "evt" }))
      .resolves.toEqual([]);
  });
});
