import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectFile, getActivityLogs } from "./db";
import { projects, projectFiles, projectDeliverableReviews, projectMembers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  submitDeliverableReview, reviewDeliverable, getReviewSatisfiedSet,
  resetReviewOnReupload, getMyPendingReviews, listDeliverableReviews,
} from "./deliverable-review-service";

const PROJ = `dr-test-${Date.now()}`;
const ARCHIVED_PROJ = `${PROJ}-archived`;
const AUTO_PROJ = `${PROJ}-auto`;
const PM = 920001, REVIEWER = 920002, SUBMITTER = 920003;
const notifs: { userIds: number[]; title: string }[] = [];
const deps = {
  now: new Date("2026-07-07T04:00:00Z"),
  notifyDingtalk: async (userIds: number[], title: string) => { notifs.push({ userIds, title }); },
};

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({ id: PROJ, name: "审核测试", projectNumber: "DR-1", category: "npd", risk: "low", currentPhase: "design", createdBy: PM, pmUserId: PM });
  await db!.insert(projects).values({ id: ARCHIVED_PROJ, name: "已归档审核测试", projectNumber: "DR-A", category: "npd", risk: "low", currentPhase: "design", createdBy: PM, pmUserId: PM, archived: true });
  await db!.insert(projects).values({ id: AUTO_PROJ, name: "自动审核测试", projectNumber: "DR-AUTO", category: "npd", risk: "low", currentPhase: "design", createdBy: PM, pmUserId: PM });
  await db!.insert(projectMembers).values({ projectId: AUTO_PROJ, userId: REVIEWER, role: "rd_hw", invitedBy: PM });
});
afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, ARCHIVED_PROJ));
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, AUTO_PROJ));
  await db!.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db!.delete(projectFiles).where(eq(projectFiles.projectId, AUTO_PROJ));
  await db!.delete(projectMembers).where(eq(projectMembers.projectId, AUTO_PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
  await db!.delete(projects).where(eq(projects.id, ARCHIVED_PROJ));
  await db!.delete(projects).where(eq(projects.id, AUTO_PROJ));
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
    const logs = await getActivityLogs(PROJ);
    expect(logs.some((log) => log.action === "deliverable_review.submit" && log.entityId?.includes("ID外观图"))).toBe(true);
  });
  it("approved → 进入 satisfied 集", async () => {
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", reviewedBy: REVIEWER, note: null }, deps);
    const set = await getReviewSatisfiedSet(PROJ, "design", ["ID外观图"]);
    expect(set.has("ID外观图")).toBe(true);
    const logs = await getActivityLogs(PROJ);
    expect(logs.some((log) => log.action === "deliverable_review.approve" && log.entityId?.includes("ID外观图"))).toBe(true);
  });
  it("有文件无审核记录 → 不在 satisfied", async () => {
    await addFile("MD结构图");
    const set = await getReviewSatisfiedSet(PROJ, "design", ["MD结构图"]);
    expect(set.has("MD结构图")).toBe(false);
  });
  it("pending/rejected → 不在 satisfied", async () => {
    await addFile("BOM");
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: "BOM", reviewerUserId: REVIEWER, submittedBy: SUBMITTER }, deps);
    let set = await getReviewSatisfiedSet(PROJ, "design", ["BOM"]);
    expect(set.has("BOM")).toBe(false);
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: "BOM", decision: "rejected", reviewedBy: REVIEWER, note: "缺料号" }, deps);
    set = await getReviewSatisfiedSet(PROJ, "design", ["BOM"]);
    expect(set.has("BOM")).toBe(false);
    const logs = await getActivityLogs(PROJ);
    expect(logs.some((log) => log.action === "deliverable_review.reject" && log.entityId?.includes("BOM"))).toBe(true);
  });
  it("重审：approved 后 resetReviewOnReupload → 回 pending + 重新通知", async () => {
    notifs.length = 0;
    await resetReviewOnReupload(PROJ, "design", "ID外观图", deps);
    const rows = await listDeliverableReviews(PROJ);
    expect(rows.find((r) => r.deliverableName === "ID外观图")?.status).toBe("pending");
    expect(notifs.some((n) => n.userIds.includes(REVIEWER))).toBe(true);
    const logs = await getActivityLogs(PROJ);
    expect(logs.some((log) => log.action === "deliverable_review.reset" && log.entityId?.includes("ID外观图"))).toBe(true);
  });
  it("myPending 只返回本人 pending", async () => {
    const mine = await getMyPendingReviews(REVIEWER);
    expect(mine.every((r) => r.reviewerUserId === REVIEWER && r.status === "pending")).toBe(true);
    expect(mine.length).toBeGreaterThan(0);
  });
  it("myPending 排除已归档项目", async () => {
    await submitDeliverableReview({
      projectId: ARCHIVED_PROJ,
      phaseId: "design",
      deliverableName: "归档项目交付物",
      reviewerUserId: REVIEWER,
      submittedBy: SUBMITTER,
    }, deps);
    const mine = await getMyPendingReviews(REVIEWER);
    expect(mine.some((r) => r.projectId === ARCHIVED_PROJ)).toBe(false);
  });
  it("createProjectFile 自动触发重审：approved 后传新版本 → pending", async () => {
    const NAME = "重审专用交付物";
    await addFile(NAME);
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: NAME, reviewerUserId: REVIEWER, submittedBy: SUBMITTER }, deps);
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: NAME, decision: "approved", reviewedBy: REVIEWER, note: null }, deps);
    let rows = await listDeliverableReviews(PROJ);
    expect(rows.find((r) => r.deliverableName === NAME)?.status).toBe("approved");
    await addFile(NAME); // 上传新版本 → createProjectFile 触发 resetReviewOnReupload
    rows = await listDeliverableReviews(PROJ);
    expect(rows.find((r) => r.deliverableName === NAME)?.status).toBe("pending");
  });
  it("createProjectFile 首次上传有效交付物 → 自动创建审核记录", async () => {
    await createProjectFile({
      projectId: AUTO_PROJ,
      phaseId: "design",
      taskId: "d8",
      deliverableName: "ID外观图",
      name: "ID外观图.pdf",
      mimeType: "application/pdf",
      size: 1,
      storageKey: "k/auto-id",
      storageUrl: "/storage/k/auto-id",
      uploadedBy: SUBMITTER,
    });
    const rows = await listDeliverableReviews(AUTO_PROJ);
    const row = rows.find((r) => r.deliverableName === "ID外观图");
    expect(row?.status).toBe("pending");
    expect(row?.reviewerUserId).toBe(REVIEWER);
    expect(row?.submittedBy).toBe(SUBMITTER);
  });
  it("旧 approved 早于最新文件时不算 satisfied", async () => {
    const NAME = "时效交付物";
    await addFile(NAME);
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: NAME, reviewerUserId: REVIEWER, submittedBy: SUBMITTER }, deps);
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: NAME, decision: "approved", reviewedBy: REVIEWER, note: null }, deps);
    let set = await getReviewSatisfiedSet(PROJ, "design", [NAME]);
    expect(set.has(NAME)).toBe(true);

    const db = await getDb();
    await db!.insert(projectFiles).values({
      projectId: PROJ,
      phaseId: "design",
      taskId: "d8",
      deliverableName: NAME,
      name: `${NAME}-new.pdf`,
      mimeType: "application/pdf",
      size: 1,
      storageKey: `k/${NAME}-new`,
      storageUrl: `/storage/k/${NAME}-new`,
      uploadedBy: SUBMITTER,
      createdAt: new Date(Date.now() + 60_000),
    });

    set = await getReviewSatisfiedSet(PROJ, "design", [NAME]);
    expect(set.has(NAME)).toBe(false);
  });
});
