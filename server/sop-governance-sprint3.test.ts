import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  createProduct,
  createProductRevision,
  createProjectWithSeed,
  getDb,
  getPortfolio,
  getProductById,
  getProductEolReadiness,
} from "./db";
import { expensesRouter } from "./routers/expenses";
import { productGovernanceRouter } from "./routers/productGovernance";
import {
  actionItems,
  activityLogs,
  productEolPlans,
  productGovernanceEvents,
  productRevisions,
  productSoftwareReleases,
  products,
  projectExpenses,
  projects,
  users,
} from "../drizzle/schema";
import { SOP_TEMPLATE_VERSION_CURRENT } from "../shared/sop-templates";

const suffix = Date.now().toString(36);
const OWNER = 985000 + Math.floor(Math.random() * 1000);
const QA = OWNER + 1001;
const PRODUCT = `s3_product_${suffix}`;
const PROJECT = `s3_project_${suffix}`;
let revisionId = 0;

const ctx = (id: number, role: "admin" | "member") => ({ user: { id, role, name: `S3-${id}`, canCreateProject: role === "admin" } }) as any;
const expenseCaller = expensesRouter.createCaller(ctx(OWNER, "admin"));
const ownerGovernance = productGovernanceRouter.createCaller(ctx(OWNER, "admin"));
const qaGovernance = productGovernanceRouter.createCaller(ctx(QA, "member"));

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(actionItems).where(eq(actionItems.projectId, PROJECT));
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(productGovernanceEvents).where(eq(productGovernanceEvents.productId, PRODUCT));
  await db.delete(productSoftwareReleases).where(eq(productSoftwareReleases.productId, PRODUCT));
  await db.delete(productEolPlans).where(eq(productEolPlans.productId, PRODUCT));
  await db.delete(productRevisions).where(eq(productRevisions.productId, PRODUCT));
  await db.delete(products).where(eq(products.id, PRODUCT));
  await db.delete(users).where(inArray(users.id, [OWNER, QA]));
}

describe("SOP governance Sprint 3", () => {
  beforeAll(async () => {
    await cleanup();
    const db = await getDb();
    await db!.insert(users).values([
      { id: OWNER, openId: `s3-owner-${suffix}`, name: "Sprint3 Owner", role: "admin", canCreateProject: true },
      { id: QA, openId: `s3-qa-${suffix}`, name: "Sprint3 QA", role: "member", canCreateProject: false },
    ]);
    await createProduct({ id: PRODUCT, name: "Sprint3 产品", productNumber: "S3-01", type: "finished", category: "充气泵", targetMarkets: ["US"], productManagerUserId: OWNER, maintenanceOwnerUserId: OWNER, afterSalesOwnerUserId: OWNER, createdBy: OWNER });
    revisionId = await createProductRevision({ productId: PRODUCT, revisionLabel: "Rev A", status: "released", releasedBy: OWNER, releasedAt: new Date() });
    await db!.update(products).set({ currentRevisionId: revisionId, lifecycleState: "maintenance" }).where(eq(products.id, PRODUCT));
    await createProjectWithSeed({ id: PROJECT, name: "Sprint3 费用项目", projectNumber: "S3-COST", category: "npd", sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT, productId: PRODUCT, resultRevisionId: revisionId, risk: "low", currentPhase: "mp", progress: 90, createdBy: OWNER }, "npd", OWNER);
  });

  afterAll(cleanup);

  it("tracks project expenses by currency and exposes multi-currency portfolio state", async () => {
    await expect(expenseCaller.create({
      projectId: PROJECT, category: "tooling", title: "模具尾款", supplier: "模具厂", currency: "CNY",
      budgetAmountMinor: 100_000_00, actualAmountMinor: 80_000_00, status: "committed", ownerUserId: OWNER,
      occurredDate: "2026-07-10", evidenceReference: null, notes: null,
    })).rejects.toThrow(/凭证/);

    await expenseCaller.create({
      projectId: PROJECT, category: "tooling", title: "模具尾款", supplier: "模具厂", currency: "CNY",
      budgetAmountMinor: 100_000_00, actualAmountMinor: 80_000_00, status: "committed", ownerUserId: OWNER,
      occurredDate: "2026-07-10", evidenceReference: "PO-CNY-001", notes: null,
    });
    await expenseCaller.create({
      projectId: PROJECT, category: "certification", title: "美国认证", supplier: "Lab", currency: "USD",
      budgetAmountMinor: 5_000_00, actualAmountMinor: 5_500_00, status: "paid", ownerUserId: OWNER,
      occurredDate: "2026-07-10", evidenceReference: "INV-USD-001", notes: null,
    });
    const summary = await expenseCaller.summary({ projectId: PROJECT });
    expect(summary).toHaveLength(2);
    expect(summary.find((row) => row.currency === "USD")?.varianceAmountMinor).toBe(500_00);
    const portfolio = await getPortfolio(OWNER);
    const row = portfolio.find((item) => item.id === PROJECT)!;
    expect(row.expenseCurrencyCount).toBe(2);
    expect(row.expenseVarianceMinor).toBeNull();
  });

  it("routes safety software to ECO and enforces independent validation, staged rollout, and rollback", async () => {
    const base = {
      productId: PRODUCT,
      version: "FW 2.3.1",
      scopeSummary: "修复非安全相关的界面显示与日志上传",
      releaseNotes: "修复显示问题",
      compatibilityNotes: "Rev A 全批次",
      regressionEvidenceReference: "QA-SWR-001",
      rolloutPlan: "10% → 50% → 100%，观察崩溃率与在线率",
      rollbackPlan: "异常率超过 1% 回滚至 FW 2.3.0",
      qaOwnerUserId: QA,
      bomOrManufacturingImpact: false,
    };
    await expect(ownerGovernance.saveSoftwareDraft({ ...base, safetyRelated: true })).rejects.toThrow(/必须转 ECO/);
    const draft = await ownerGovernance.saveSoftwareDraft({ ...base, safetyRelated: false });
    await ownerGovernance.submitSoftware({ productId: PRODUCT, id: draft.id });
    await expect(ownerGovernance.validateSoftware({ productId: PRODUCT, id: draft.id })).rejects.toThrow(/自验/);
    await qaGovernance.validateSoftware({ productId: PRODUCT, id: draft.id });
    await ownerGovernance.rolloutSoftware({ productId: PRODUCT, id: draft.id, rolloutPercent: 10 });
    await expect(ownerGovernance.rolloutSoftware({ productId: PRODUCT, id: draft.id, rolloutPercent: 10 })).rejects.toThrow(/单向提高/);
    await ownerGovernance.rolloutSoftware({ productId: PRODUCT, id: draft.id, rolloutPercent: 50 });
    const rolledBack = await ownerGovernance.rollbackSoftware({ productId: PRODUCT, id: draft.id, reason: "灰度设备异常率超过阈值" });
    expect(rolledBack.status).toBe("rolled_back");
  });

  it("requires approved evidence, no active work, and independent approval before EOL", async () => {
    const items = [
      ["customer_notice", "EOL-NOTICE-001"],
      ["last_time_buy", "LTB-001"],
      ["inventory_disposition", "INV-DISP-001"],
      ["supplier_shutdown", "SUP-EXIT-001"],
      ["service_spares_commitment", "SERVICE-2027"],
      ["certificate_records", "CERT-ARCHIVE-001"],
      ["replacement_strategy", "REPLACE-001"],
    ] as const;
    await ownerGovernance.saveEolDraft({
      productId: PRODUCT,
      reason: "产品代际替换",
      lastOrderDate: "2025-01-01",
      lastShipDate: "2025-02-01",
      serviceEndDate: "2027-02-01",
      sparePartsYears: 1,
      inventoryDisposition: "余料转售后备件，其余报废审批",
      customerCommunicationPlan: "逐客户书面通知并确认 LTB",
      supplierExitPlan: "关闭采购协议并确认工装归属",
      replacementProductId: null,
      ownerUserId: OWNER,
      approverUserId: QA,
      items: items.map(([itemKey]) => ({ itemKey, completed: false, evidenceReference: null })),
    });
    await ownerGovernance.submitEol({ productId: PRODUCT });
    await expect(ownerGovernance.approveEol({ productId: PRODUCT })).rejects.toThrow(/自批/);
    await qaGovernance.approveEol({ productId: PRODUCT });
    await ownerGovernance.saveEolItems({ productId: PRODUCT, items: items.map(([itemKey, evidenceReference]) => ({ itemKey, completed: true, evidenceReference })) });
    expect((await getProductEolReadiness(PRODUCT)).blockers).toContain("仍有 1 个未归档项目");
    const db = await getDb();
    await db!.update(projects).set({ archived: true }).where(eq(projects.id, PROJECT));
    expect((await getProductEolReadiness(PRODUCT)).ready).toBe(true);
    await ownerGovernance.completeEol({ productId: PRODUCT });
    expect((await getProductById(PRODUCT))?.lifecycleState).toBe("eol");
    await expect(ownerGovernance.saveSoftwareDraft({
      productId: PRODUCT, version: "FW 2.3.2", scopeSummary: "post eol", releaseNotes: "x", compatibilityNotes: "x",
      regressionEvidenceReference: "x", rolloutPlan: "x", rollbackPlan: "x", qaOwnerUserId: QA,
      safetyRelated: false, bomOrManufacturingImpact: false,
    })).rejects.toThrow(/已停产/);
  });
});
