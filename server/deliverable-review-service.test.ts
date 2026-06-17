import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectFile } from "./db";
import { projects, projectFiles, projectDeliverableReviews } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  submitDeliverableReview, reviewDeliverable, getReviewSatisfiedSet,
  resetReviewOnReupload, getMyPendingReviews, listDeliverableReviews,
} from "./deliverable-review-service";

const PROJ = `dr-test-${Date.now()}`;
const PM = 920001, REVIEWER = 920002, SUBMITTER = 920003;
const notifs: { userIds: number[]; title: string }[] = [];
const deps = { notifyDingtalk: async (userIds: number[], title: string) => { notifs.push({ userIds, title }); } };

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({ id: PROJ, name: "审核测试", projectNumber: "DR-1", category: "npd", risk: "low", currentPhase: "design", createdBy: PM, pmUserId: PM });
});
afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
  await db!.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

async function addFile(name: string) {
  await createProjectFile({ projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: name, name: `${name}.pdf`, mimeType: "application/pdf", size: 1, storageKey: `k/${name}`, storageUrl: `/storage/k/${name}`, uploadedBy: SUBMITTER });
}

describe("deliverable review service", () => {
  it("submit → pending + 通知审核人", async () => {
    await addFile("ID外观图");
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: REVIEWER, submittedBy: SUBMITTER }, deps);
    const rows = await listDeliverableReviews(PROJ);
    expect(rows.find((r) => r.deliverableName === "ID外观图")?.status).toBe("pending");
    expect(notifs.some((n) => n.userIds.includes(REVIEWER))).toBe(true);
  });
  it("approved → 进入 satisfied 集", async () => {
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", reviewedBy: REVIEWER, note: null }, deps);
    const set = await getReviewSatisfiedSet(PROJ, "design", ["ID外观图"]);
    expect(set.has("ID外观图")).toBe(true);
  });
  it("存量豁免：有文件无审核记录 → satisfied", async () => {
    await addFile("MD结构图");
    const set = await getReviewSatisfiedSet(PROJ, "design", ["MD结构图"]);
    expect(set.has("MD结构图")).toBe(true);
  });
  it("pending/rejected → 不在 satisfied", async () => {
    await addFile("BOM");
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: "BOM", reviewerUserId: REVIEWER, submittedBy: SUBMITTER }, deps);
    let set = await getReviewSatisfiedSet(PROJ, "design", ["BOM"]);
    expect(set.has("BOM")).toBe(false);
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: "BOM", decision: "rejected", reviewedBy: REVIEWER, note: "缺料号" }, deps);
    set = await getReviewSatisfiedSet(PROJ, "design", ["BOM"]);
    expect(set.has("BOM")).toBe(false);
  });
  it("重审：approved 后 resetReviewOnReupload → 回 pending + 重新通知", async () => {
    notifs.length = 0;
    await resetReviewOnReupload(PROJ, "design", "ID外观图", deps);
    const rows = await listDeliverableReviews(PROJ);
    expect(rows.find((r) => r.deliverableName === "ID外观图")?.status).toBe("pending");
    expect(notifs.some((n) => n.userIds.includes(REVIEWER))).toBe(true);
  });
  it("myPending 只返回本人 pending", async () => {
    const mine = await getMyPendingReviews(REVIEWER);
    expect(mine.every((r) => r.reviewerUserId === REVIEWER && r.status === "pending")).toBe(true);
    expect(mine.length).toBeGreaterThan(0);
  });
  it("createProjectFile 自动触发重审：approved 后传新版本 → pending", async () => {
    // "ID外观图" 在前面的用例里被 submit 过；先确保它是 approved
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", reviewedBy: REVIEWER, note: null }, deps).catch(() => {});
    await addFile("ID外观图"); // 上传新版本 → createProjectFile 内部应触发 resetReviewOnReupload
    const rows = await listDeliverableReviews(PROJ);
    expect(rows.find((r) => r.deliverableName === "ID外观图")?.status).toBe("pending");
  });
});
