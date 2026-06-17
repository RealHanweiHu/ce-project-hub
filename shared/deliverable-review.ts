export const DELIVERABLE_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type DeliverableReviewStatus = (typeof DELIVERABLE_REVIEW_STATUSES)[number];

/**
 * 单个交付物是否满足 Gate 就绪：必须有文件，且（无审核记录=存量豁免视为通过，或已审核 approved）。
 */
export function isDeliverableSatisfied(
  hasFile: boolean,
  reviewStatus: DeliverableReviewStatus | null
): boolean {
  if (!hasFile) return false;
  return reviewStatus === null || reviewStatus === "approved";
}
