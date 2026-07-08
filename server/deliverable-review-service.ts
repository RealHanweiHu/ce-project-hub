import {
  createActivityLog,
  getDb,
  getProjectById,
  getProjectEffectiveProcess,
  getProjectMembers,
} from "./db";
import { projectDeliverableReviews, projectFiles, projects } from "../drizzle/schema";
import type { ProjectDeliverableReview } from "../drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { isDeliverableSatisfied } from "../shared/deliverable-review";
import { canRoleReviewDeliverables, preferredDeliverableReviewerRoles } from "../shared/deliverable-permissions";
import {
  actionDedupeKey,
  closeActionItems,
  deliverableActionEntityId,
  notifyActionItem,
} from "./action-item-notify";
import { buildDeliverableReviewActionPath, buildProjectActionPath } from "../shared/action-links";
import { notifyGateReadyIfReady } from "./gate-ready-notify";
import type { NotifyPersonalDeps } from "./notification-gateway";

export type ReviewDeps = NotifyPersonalDeps;

function preferredReviewerRoles(deliverableName: string) {
  return preferredDeliverableReviewerRoles(deliverableName);
}

function effectiveReviewerRole(input: {
  reviewerUserId: number;
  explicitRole: string | null;
  projectCreatedBy?: number | null;
  projectPmUserId?: number | null;
}): string | null {
  if (input.reviewerUserId === input.projectCreatedBy) return "owner";
  if (input.reviewerUserId === input.projectPmUserId) {
    if (input.explicitRole === "owner" || input.explicitRole === "manager") return input.explicitRole;
    return "project_manager";
  }
  return input.explicitRole;
}

export async function pickDefaultDeliverableReviewer(input: {
  projectId: string;
  deliverableName: string;
  pmUserId?: number | null;
  excludeUserId?: number | null;
}): Promise<number | null> {
  const members = await getProjectMembers(input.projectId);
  const project = await getProjectById(input.projectId);
  const excluded = input.excludeUserId ?? null;
  const preferred = preferredReviewerRoles(input.deliverableName);

  const eligible = members
    .map((member) => ({
      userId: member.userId,
      role: effectiveReviewerRole({
        reviewerUserId: member.userId,
        explicitRole: member.role,
        projectCreatedBy: project?.createdBy ?? null,
        projectPmUserId: input.pmUserId ?? project?.pmUserId ?? null,
      }),
    }))
    .filter((member) => member.userId !== excluded && canRoleReviewDeliverables(member.role));

  if (preferred.length > 0) {
    for (const role of preferred) {
      const reviewer = eligible.find((member) => member.role === role);
      if (reviewer) return reviewer.userId;
    }
    return null;
  }
  const pmUserId = input.pmUserId ?? project?.pmUserId ?? null;
  if (pmUserId && pmUserId !== excluded && eligible.some((member) => member.userId === pmUserId)) return pmUserId;
  return eligible[0]?.userId ?? null;
}

export async function listDeliverableReviews(projectId: string): Promise<ProjectDeliverableReview[]> {
  const db = await getDb(); if (!db) return [];
  return db.select().from(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, projectId));
}

export async function getMyPendingReviews(reviewerUserId: number): Promise<ProjectDeliverableReview[]> {
  const db = await getDb(); if (!db) return [];
  const rows = await db
    .select({ review: projectDeliverableReviews })
    .from(projectDeliverableReviews)
    .innerJoin(projects, eq(projectDeliverableReviews.projectId, projects.id))
    .where(and(
      eq(projectDeliverableReviews.reviewerUserId, reviewerUserId),
      eq(projectDeliverableReviews.status, "pending"),
      eq(projects.archived, false),
    ));
  return rows.map((row) => row.review);
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
  const before = existing ? { ...existing } : null;
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
  await createActivityLog({
    projectId: input.projectId,
    userId: input.submittedBy,
    action: "deliverable_review.submit",
    entityType: "deliverable_review",
    entityId: deliverableActionEntityId(input.projectId, input.phaseId, input.deliverableName),
    meta: {
      phaseId: input.phaseId,
      deliverableName: input.deliverableName,
      reviewerUserId: input.reviewerUserId,
      submittedBy: input.submittedBy,
      before,
      after: {
        projectId: input.projectId,
        phaseId: input.phaseId,
        deliverableName: input.deliverableName,
        status: "pending",
        reviewerUserId: input.reviewerUserId,
        submittedBy: input.submittedBy,
      },
    },
  });
  try {
    const entityId = deliverableActionEntityId(input.projectId, input.phaseId, input.deliverableName);
    await closeActionItems({
      kind: "deliverable_rework",
      entityType: "deliverable_review",
      entityId,
    });
    await notifyActionItem({
      kind: "deliverable_review",
      projectId: input.projectId,
      entityType: "deliverable_review",
      entityId,
      dedupeKey: actionDedupeKey({ kind: "deliverable_review", entityId, recipientUserId: input.reviewerUserId }),
      recipientUserId: input.reviewerUserId,
      title: "交付物待审核",
      body: `项目交付物「${input.deliverableName}」待你审核。`,
      actionPath: buildDeliverableReviewActionPath({
        projectId: input.projectId,
        phaseId: input.phaseId,
        deliverableName: input.deliverableName,
      }),
      priority: "high",
      metadata: { phaseId: input.phaseId, deliverableName: input.deliverableName, submittedBy: input.submittedBy },
    }, deps);
  } catch { /* best-effort */ }
}

export async function maybeAutoSubmitDeliverableReviewOnUpload(
  input: { projectId: string; phaseId: string | null; deliverableName: string | null; uploadedBy: number },
  deps?: ReviewDeps,
): Promise<{ submitted: boolean; reviewerUserId?: number; reason?: string }> {
  if (!input.phaseId || !input.deliverableName?.trim()) return { submitted: false, reason: "missing_deliverable" };
  const db = await getDb(); if (!db) throw new Error("Database not available");
  const existing = await findReview(db, input.projectId, input.phaseId, input.deliverableName);
  if (existing) return { submitted: false, reason: "review_exists" };
  const project = await getProjectById(input.projectId);
  if (!project) return { submitted: false, reason: "project_missing" };
  const effective = await getProjectEffectiveProcess(input.projectId);
  const effPhase = effective?.phases.find((phase) => phase.id === input.phaseId);
  if (!effPhase?.submittedDeliverables.includes(input.deliverableName)) {
    return { submitted: false, reason: "not_effective_deliverable" };
  }
  const reviewerUserId = await pickDefaultDeliverableReviewer({
    projectId: input.projectId,
    deliverableName: input.deliverableName,
    pmUserId: project.pmUserId ?? null,
    excludeUserId: input.uploadedBy,
  });
  if (!reviewerUserId) return { submitted: false, reason: "no_reviewer" };
  await submitDeliverableReview({
    projectId: input.projectId,
    phaseId: input.phaseId,
    deliverableName: input.deliverableName,
    reviewerUserId,
    submittedBy: input.uploadedBy,
  }, deps);
  return { submitted: true, reviewerUserId };
}

export async function reviewDeliverable(
  input: { projectId: string; phaseId: string; deliverableName: string; decision: "approved" | "rejected"; reviewedBy: number; note: string | null },
  deps?: ReviewDeps
): Promise<void> {
  const db = await getDb(); if (!db) throw new Error("no db");
  const existing = await findReview(db, input.projectId, input.phaseId, input.deliverableName);
  if (!existing || existing.status !== "pending") throw new Error("仅待审交付物可审核");
  await db.update(projectDeliverableReviews).set({
    status: input.decision, reviewedBy: input.reviewedBy, reviewedAt: sql`now()`, reviewNote: input.note,
  }).where(eq(projectDeliverableReviews.id, existing.id));
  await createActivityLog({
    projectId: input.projectId,
    userId: input.reviewedBy,
    action: input.decision === "approved" ? "deliverable_review.approve" : "deliverable_review.reject",
    entityType: "deliverable_review",
    entityId: deliverableActionEntityId(input.projectId, input.phaseId, input.deliverableName),
    meta: {
      phaseId: input.phaseId,
      deliverableName: input.deliverableName,
      note: input.note,
      before: existing,
      after: {
        ...existing,
        status: input.decision,
        reviewedBy: input.reviewedBy,
        reviewNote: input.note,
      },
    },
  });
  const entityId = deliverableActionEntityId(input.projectId, input.phaseId, input.deliverableName);
  await closeActionItems({
    kind: "deliverable_review",
    entityType: "deliverable_review",
    entityId,
  });
  if (input.decision === "approved") {
    await notifyGateReadyIfReady({
      projectId: input.projectId,
      phaseId: input.phaseId,
      actorId: input.reviewedBy,
      reason: "deliverable_review.approve",
    }).catch((error) => {
      console.warn("[gate-ready] failed after deliverable approval:", error);
    });
  }
  if (input.decision === "rejected") {
    try {
      await notifyActionItem({
        kind: "deliverable_rework",
        projectId: input.projectId,
        entityType: "deliverable_review",
        entityId,
        dedupeKey: actionDedupeKey({ kind: "deliverable_rework", entityId, recipientUserId: existing.submittedBy }),
        recipientUserId: existing.submittedBy,
        title: "交付物被驳回",
        body: `「${input.deliverableName}」被驳回${input.note ? "：" + input.note : ""}。`,
        actionPath: buildProjectActionPath({ projectId: input.projectId, tab: "reviews", phaseId: input.phaseId }),
        priority: "high",
        metadata: { phaseId: input.phaseId, deliverableName: input.deliverableName, reviewedBy: input.reviewedBy },
      }, deps);
    } catch { /* best-effort */ }
  }
}

export async function resetReviewOnReupload(
  projectId: string,
  phaseId: string,
  deliverableName: string,
  actorOrDeps?: number | null | ReviewDeps,
  maybeDeps?: ReviewDeps,
): Promise<void> {
  const actorId = typeof actorOrDeps === "number" || actorOrDeps == null ? actorOrDeps ?? null : null;
  const deps = typeof actorOrDeps === "object" && actorOrDeps !== null ? actorOrDeps : maybeDeps;
  const db = await getDb(); if (!db) throw new Error("Database not available");
  const existing = await findReview(db, projectId, phaseId, deliverableName);
  if (!existing || existing.status === "pending") return;
  await db.update(projectDeliverableReviews).set({ status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null, submittedAt: sql`now()` })
    .where(eq(projectDeliverableReviews.id, existing.id));
  await createActivityLog({
    projectId,
    userId: actorId ?? existing.submittedBy,
    action: "deliverable_review.reset",
    entityType: "deliverable_review",
    entityId: deliverableActionEntityId(projectId, phaseId, deliverableName),
    meta: {
      phaseId,
      deliverableName,
      before: existing,
      after: {
        ...existing,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      },
    },
  });
  try {
    const entityId = deliverableActionEntityId(projectId, phaseId, deliverableName);
    await closeActionItems({
      kind: "deliverable_rework",
      entityType: "deliverable_review",
      entityId,
    });
    await notifyActionItem({
      kind: "deliverable_review",
      projectId,
      entityType: "deliverable_review",
      entityId,
      dedupeKey: actionDedupeKey({ kind: "deliverable_review", entityId, recipientUserId: existing.reviewerUserId }),
      recipientUserId: existing.reviewerUserId,
      title: "交付物已更新待重审",
      body: `「${deliverableName}」已上传新版本，待你重新审核。`,
      actionPath: buildDeliverableReviewActionPath({ projectId, phaseId, deliverableName }),
      priority: "high",
      metadata: { phaseId, deliverableName, submittedBy: existing.submittedBy },
    }, deps);
  } catch { /* best-effort */ }
}

export async function getReviewSatisfiedSet(projectId: string, phaseId: string, requiredNames: string[]): Promise<Set<string>> {
  const db = await getDb(); if (!db || requiredNames.length === 0) return new Set();
  const files = await db.select({ deliverableName: projectFiles.deliverableName, createdAt: projectFiles.createdAt }).from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.phaseId, phaseId)));
  const latestFileByName = new Map<string, Date>();
  for (const file of files) {
    if (!file.deliverableName) continue;
    const prev = latestFileByName.get(file.deliverableName);
    if (!prev || file.createdAt > prev) latestFileByName.set(file.deliverableName, file.createdAt);
  }
  const reviews = await db.select({
    deliverableName: projectDeliverableReviews.deliverableName,
    status: projectDeliverableReviews.status,
    reviewedAt: projectDeliverableReviews.reviewedAt,
  }).from(projectDeliverableReviews)
    .where(and(eq(projectDeliverableReviews.projectId, projectId), eq(projectDeliverableReviews.phaseId, phaseId)));
  const reviewByName = new Map(reviews.map((r) => [r.deliverableName, r]));
  const out = new Set<string>();
  for (const name of requiredNames) {
    const latestFileAt = latestFileByName.get(name);
    const review = reviewByName.get(name);
    const approvedAfterLatestFile =
      !!latestFileAt &&
      review?.status === "approved" &&
      !!review.reviewedAt &&
      review.reviewedAt >= latestFileAt;
    const reviewStatus = approvedAfterLatestFile
      ? "approved"
      : review?.status === "approved"
        ? null
        : review?.status ?? null;
    if (isDeliverableSatisfied(!!latestFileAt, reviewStatus)) out.add(name);
  }
  return out;
}
