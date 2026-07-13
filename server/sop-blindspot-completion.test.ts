import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createProduct, getDb } from "./db";
import {
  decideProductWaiver,
  decideSopChangeRequest,
  expireApprovedProductWaivers,
  listSopChangeEvents,
  publishSopChangeRequest,
  resolveProductWaiver,
  saveProductWaiverDraft,
  saveSopChangeDraft,
  submitProductWaiver,
  submitSopChangeRequest,
} from "./services/sop-blindspot-service";
import { productWaivers, products, sopChangeEvents, sopChangeRequests } from "../drizzle/schema";

const suffix = Date.now().toString(36);
const PRODUCT_ID = `blindspot-product-${suffix}`;
const REQUESTER = 991001;
const APPROVER = 991002;
let waiverId = 0;
let sopRequestId = 0;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  if (sopRequestId) await db.delete(sopChangeEvents).where(eq(sopChangeEvents.requestId, sopRequestId));
  if (sopRequestId) await db.delete(sopChangeRequests).where(eq(sopChangeRequests.id, sopRequestId));
  await db.delete(productWaivers).where(eq(productWaivers.productId, PRODUCT_ID));
  await db.delete(products).where(eq(products.id, PRODUCT_ID));
}

describe("SOP blindspot completion controls", () => {
  beforeAll(async () => {
    await cleanup();
    await createProduct({ id: PRODUCT_ID, productNumber: `BS-${suffix}`, name: "盲点控制测试产品", type: "finished", category: "充气泵", targetMarkets: ["EU"], createdBy: REQUESTER });
  });
  afterAll(cleanup);

  it("enforces bounded product waiver, independent approval, expiry, and closure", async () => {
    const waiver = await saveProductWaiverDraft({
      productId: PRODUCT_ID,
      title: "临时代料",
      deviationDescription: "供应商短缺，临时采用已验证二供",
      impactAssessment: "不涉及安全参数，限单批验证",
      containmentPlan: "隔离批次并全检追溯",
      scopeType: "batch",
      lotOrBatch: "LOT-001",
      quantityLimit: 100,
      affectedPartNumbers: ["PN-001"],
      effectiveFrom: "2026-01-01",
      expiresOn: "2026-01-10",
      riskLevel: "medium",
      ownerUserId: REQUESTER,
      approverUserId: APPROVER,
      evidenceReference: "EV-WAIVER-001",
      actorUserId: REQUESTER,
    });
    waiverId = waiver.id;
    await submitProductWaiver(waiver.id, PRODUCT_ID, REQUESTER);
    await expect(decideProductWaiver({ id: waiver.id, productId: PRODUCT_ID, actorUserId: REQUESTER, approve: true, allowAdmin: true })).rejects.toThrow(/不能自批/);
    await decideProductWaiver({ id: waiver.id, productId: PRODUCT_ID, actorUserId: APPROVER, approve: true, allowAdmin: false, note: "批准限定批次" });
    expect(await expireApprovedProductWaivers("2026-01-10")).toBe(0);
    expect(await expireApprovedProductWaivers("2026-01-11")).toBe(1);
    const closed = await resolveProductWaiver({ id: waiver.id, productId: PRODUCT_ID, actorUserId: REQUESTER, resolution: "closed", note: "批次完成，全检合格" });
    expect(closed.status).toBe("closed");
  });

  it("runs SOP changes through requester, designated approver, publish, and audit events", async () => {
    const request = await saveSopChangeDraft({
      title: "收紧 Close Gate",
      currentVersion: "2099-12-v1",
      proposedVersion: `2099-12-v${Number(String(Date.now()).slice(-5))}`,
      affectedTracks: ["npd", "eco"],
      changeSummary: "新增结构化善后与证据要求",
      rationale: "避免终止与关闭无证据留痕",
      impactAnalysis: "新项目使用新版本，在途项目保持快照",
      migrationStrategy: "不追溯改写已开启项目，仅新开轮次使用",
      rollbackPlan: "若阻断率异常，停用新模板并恢复上一版本",
      effectiveDate: "2099-12-01",
      requesterUserId: REQUESTER,
      approverUserId: APPROVER,
    });
    sopRequestId = request.id;
    await expect(submitSopChangeRequest(request.id, APPROVER)).rejects.toThrow(/只有申请人/);
    await submitSopChangeRequest(request.id, REQUESTER);
    await expect(decideSopChangeRequest({ id: request.id, actorUserId: REQUESTER, approve: true, allowAdmin: true, note: "自批" })).rejects.toThrow(/不能自批/);
    await decideSopChangeRequest({ id: request.id, actorUserId: APPROVER, approve: true, allowAdmin: false, note: "影响与回滚路径已确认" });
    const published = await publishSopChangeRequest(request.id, APPROVER);
    expect(published.status).toBe("published");
    expect((await listSopChangeEvents(request.id)).map((event) => event.action)).toEqual(["draft_created", "submitted", "approved", "published"]);
  });
});
