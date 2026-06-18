export const DELIVERABLE_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type DeliverableReviewStatus = (typeof DELIVERABLE_REVIEW_STATUSES)[number];

export const DELIVERABLE_STATES = ["missing", "uploaded", "pending_review", "approved", "rejected"] as const;
export type DeliverableState = (typeof DELIVERABLE_STATES)[number];

/**
 * 文件只代表证据存在；只有审核 approved 才代表交付物有效。
 */
export function getDeliverableState(
  hasFile: boolean,
  reviewStatus: DeliverableReviewStatus | null
): DeliverableState {
  if (!hasFile) return "missing";
  if (reviewStatus === "approved") return "approved";
  if (reviewStatus === "rejected") return "rejected";
  if (reviewStatus === "pending") return "pending_review";
  return "uploaded";
}

export function isDeliverableSatisfied(
  hasFile: boolean,
  reviewStatus: DeliverableReviewStatus | null
): boolean {
  return getDeliverableState(hasFile, reviewStatus) === "approved";
}
