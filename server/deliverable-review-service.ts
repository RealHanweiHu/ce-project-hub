import { getDb } from "./db";
import { projectDeliverableReviews, projectFiles, projects } from "../drizzle/schema";
import type { ProjectDeliverableReview } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { isDeliverableSatisfied } from "../shared/deliverable-review";
import { notifyUsersViaDingtalk } from "./_core/dingtalkMessage";

export type ReviewDeps = { notifyDingtalk?: (userIds: number[], title: string, markdown: string) => Promise<void> };
const notify = (deps?: ReviewDeps) => deps?.notifyDingtalk ?? notifyUsersViaDingtalk;

export async function listDeliverableReviews(projectId: string): Promise<ProjectDeliverableReview[]> {
  const db = await getDb(); if (!db) return [];
  return db.select().from(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, projectId));
}

export async function getMyPendingReviews(reviewerUserId: number): Promise<ProjectDeliverableReview[]> {
  const db = await getDb(); if (!db) return [];
  return db.select().from(projectDeliverableReviews)
    .where(and(eq(projectDeliverableReviews.reviewerUserId, reviewerUserId), eq(projectDeliverableReviews.status, "pending")));
}

async function findReview(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, projectId: string, phaseId: string, deliverableName: string) {
  const rows = await db.select().from(projectDeliverableReviews)
    .where(and(eq(projectDeliverableReviews.projectId, projectId), eq(projectDeliverableReviews.phaseId, phaseId), eq(projectDeliverableReviews.deliverableName, deliverableName)));
  return rows[0] ?? null;
}

export async function submitDeliverableReview(
  input: { projectId: string; phaseId: string; deliverableName: string; reviewerUserId: number; submittedBy: number },
  deps?: ReviewDeps
): Promise<void> {
  const db = await getDb(); if (!db) throw new Error("no db");
  const existing = await findReview(db, input.projectId, input.phaseId, input.deliverableName);
  if (existing) {
    await db.update(projectDeliverableReviews).set({
      status: "pending", reviewerUserId: input.reviewerUserId, submittedBy: input.submittedBy,
      submittedAt: new Date(), reviewedBy: null, reviewedAt: null, reviewNote: null,
    }).where(eq(projectDeliverableReviews.id, existing.id));
  } else {
    await db.insert(projectDeliverableReviews).values({
      projectId: input.projectId, phaseId: input.phaseId, deliverableName: input.deliverableName,
      status: "pending", reviewerUserId: input.reviewerUserId, submittedBy: input.submittedBy,
    });
  }
  try { await notify(deps)([input.reviewerUserId], "交付物待审核", `项目交付物「${input.deliverableName}」待你审核`); } catch { /* best-effort */ }
}

export async function reviewDeliverable(
  input: { projectId: string; phaseId: string; deliverableName: string; decision: "approved" | "rejected"; reviewedBy: number; note: string | null },
  deps?: ReviewDeps
): Promise<void> {
  const db = await getDb(); if (!db) throw new Error("no db");
  const existing = await findReview(db, input.projectId, input.phaseId, input.deliverableName);
  if (!existing || existing.status !== "pending") throw new Error("仅待审交付物可审核");
  await db.update(projectDeliverableReviews).set({
    status: input.decision, reviewedBy: input.reviewedBy, reviewedAt: new Date(), reviewNote: input.note,
  }).where(eq(projectDeliverableReviews.id, existing.id));
  if (input.decision === "rejected") {
    try { await notify(deps)([existing.submittedBy], "交付物被驳回", `「${input.deliverableName}」被驳回${input.note ? "：" + input.note : ""}`); } catch { /* best-effort */ }
  }
}

export async function resetReviewOnReupload(projectId: string, phaseId: string, deliverableName: string, deps?: ReviewDeps): Promise<void> {
  const db = await getDb(); if (!db) return;
  const existing = await findReview(db, projectId, phaseId, deliverableName);
  if (!existing || existing.status === "pending") return;
  await db.update(projectDeliverableReviews).set({ status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null, submittedAt: new Date() })
    .where(eq(projectDeliverableReviews.id, existing.id));
  try { await notify(deps)([existing.reviewerUserId], "交付物已更新待重审", `「${deliverableName}」已上传新版本，待你重新审核`); } catch { /* best-effort */ }
}

export async function getReviewSatisfiedSet(projectId: string, phaseId: string, requiredNames: string[]): Promise<Set<string>> {
  const db = await getDb(); if (!db || requiredNames.length === 0) return new Set();
  const files = await db.select({ deliverableName: projectFiles.deliverableName }).from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.phaseId, phaseId)));
  const haveFile = new Set(files.map((f) => f.deliverableName).filter((n): n is string => !!n));
  const reviews = await db.select().from(projectDeliverableReviews)
    .where(and(eq(projectDeliverableReviews.projectId, projectId), eq(projectDeliverableReviews.phaseId, phaseId)));
  const statusByName = new Map(reviews.map((r) => [r.deliverableName, r.status]));
  const out = new Set<string>();
  for (const name of requiredNames) {
    if (isDeliverableSatisfied(haveFile.has(name), statusByName.get(name) ?? null)) out.add(name);
  }
  return out;
}
