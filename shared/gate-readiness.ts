export type GateDim = "prereq" | "deliverables" | "critical_issues" | "review_conditions";

export type GateReadinessInput = {
  phaseId: string;
  gateName: string;
  prereq: { incompleteTaskIds: string[] };
  deliverables: { required: string[]; uploaded: string[] };
  criticalIssues: { titles: string[] };
  latestReview: { decision: "approved" | "conditional" | "rejected"; conditions: string | null; notes: string | null } | null;
};

export type GateDimResult = { dimension: GateDim; ok: boolean; summary: string; blockers: string[] };
export type GateReadiness = { phaseId: string; gateName: string; ready: boolean; dimensions: GateDimResult[]; blockerCount: number };

/** Gate 就绪度纯判定。交付物「已上传」口径由上层传入（2a=文件存在；2b 升级为已审核）。 */
export function computeGateReadiness(input: GateReadinessInput): GateReadiness {
  const dimensions: GateDimResult[] = [];

  const prereqBlockers = input.prereq.incompleteTaskIds;
  dimensions.push({
    dimension: "prereq",
    ok: prereqBlockers.length === 0,
    summary: prereqBlockers.length === 0 ? "前置任务全部完成" : `还差 ${prereqBlockers.length} 项前置任务`,
    blockers: prereqBlockers,
  });

  const uploadedSet = new Set(input.deliverables.uploaded);
  const missing = input.deliverables.required.filter((name) => !uploadedSet.has(name));
  const total = input.deliverables.required.length;
  dimensions.push({
    dimension: "deliverables",
    ok: missing.length === 0,
    summary: missing.length === 0 ? `交付物齐全 (${total}/${total})` : `缺 ${missing.length}/${total} 项交付物`,
    blockers: missing,
  });

  const issueTitles = input.criticalIssues.titles;
  dimensions.push({
    dimension: "critical_issues",
    ok: issueTitles.length === 0,
    summary: issueTitles.length === 0 ? "无未关闭 P0/P1" : `${issueTitles.length} 个未关闭 P0/P1`,
    blockers: issueTitles,
  });

  const review = input.latestReview;
  let reviewOk = true;
  let reviewBlockers: string[] = [];
  let reviewSummary = "无遗留评审条件";
  if (review && review.decision === "conditional") {
    reviewOk = false;
    reviewBlockers = [review.conditions || "上轮评审有遗留条件"];
    reviewSummary = "上轮评审有遗留条件";
  } else if (review && review.decision === "rejected") {
    reviewOk = false;
    reviewBlockers = [review.notes || review.conditions || "上轮评审被驳回"];
    reviewSummary = "上轮评审被驳回";
  }
  dimensions.push({ dimension: "review_conditions", ok: reviewOk, summary: reviewSummary, blockers: reviewBlockers });

  const blockerCount = dimensions.reduce((sum, d) => sum + d.blockers.length, 0);
  return { phaseId: input.phaseId, gateName: input.gateName, ready: dimensions.every((d) => d.ok), dimensions, blockerCount };
}
