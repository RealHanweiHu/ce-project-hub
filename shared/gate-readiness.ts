export type GateDim =
  | "prereq"
  | "deliverables"
  | "test_reports"
  | "npi_readiness"
  | "sample_signoffs"
  | "critical_issues"
  | "role_blocks"
  | "review_conditions";

export type GateReadinessInput = {
  phaseId: string;
  gateName: string;
  prereq: { incompleteTaskIds: string[] };
  deliverables: { required: string[]; uploaded: string[] };
  testReports?: {
    required: boolean;
    phaseLabel?: string;
    planCount: number;
    approvedReports: number;
    pendingReports: number;
    failedReports: number;
    blockers: string[];
  };
  npiReadiness?: {
    required: boolean;
    phaseLabel?: string;
    checkCount: number;
    readyCount: number;
    blockedCount: number;
    pendingCount: number;
    missingEvidenceCount: number;
    blockers: string[];
  };
  sampleSignoffs?: {
    required: boolean;
    phaseLabel?: string;
    signoffCount: number;
    approvedCount: number;
    pendingCount: number;
    rejectedCount: number;
    blockers: string[];
  };
  criticalIssues: { titles: string[] };
  roleBlocks?: { titles: string[] };
  latestReview: { decision: "approved" | "conditional" | "rejected"; conditions: string | null; notes: string | null } | null;
};

export type GateDimResult = { dimension: GateDim; ok: boolean; summary: string; blockers: string[] };
export type GateReadiness = { phaseId: string; gateName: string; ready: boolean; dimensions: GateDimResult[]; blockerCount: number };

/** Gate 就绪度纯判定。交付物「已上传」口径由上层传入（2a=文件存在；2b 升级为已审核）。 */
export function computeGateReadiness(input: GateReadinessInput): GateReadiness {
  const dimensions: GateDimResult[] = [];

  const prereqBlockers = [...input.prereq.incompleteTaskIds];
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

  const testReports = input.testReports;
  if (testReports?.required) {
    dimensions.push({
      dimension: "test_reports",
      ok: testReports.blockers.length === 0,
      summary: testReports.blockers.length === 0
        ? `${testReports.phaseLabel ?? input.phaseId} 测试报告已复核`
        : `${testReports.blockers.length} 个测试报告缺口`,
      blockers: testReports.blockers,
    });
  } else {
    dimensions.push({
      dimension: "test_reports",
      ok: true,
      summary: "非验证阶段无需正式测试报告",
      blockers: [],
    });
  }

  const npiReadiness = input.npiReadiness;
  if (npiReadiness?.required) {
    dimensions.push({
      dimension: "npi_readiness",
      ok: npiReadiness.blockers.length === 0,
      summary: npiReadiness.blockers.length === 0
        ? `${npiReadiness.phaseLabel ?? input.phaseId} PE/NPI readiness 已确认`
        : `${npiReadiness.blockers.length} 个 PE/NPI readiness 缺口`,
      blockers: npiReadiness.blockers,
    });
  } else {
    dimensions.push({
      dimension: "npi_readiness",
      ok: true,
      summary: "非 PVT/MP Gate 无需强制 PE/NPI readiness",
      blockers: [],
    });
  }

  const sampleSignoffs = input.sampleSignoffs;
  if (sampleSignoffs?.required) {
    dimensions.push({
      dimension: "sample_signoffs",
      ok: sampleSignoffs.blockers.length === 0,
      summary: sampleSignoffs.blockers.length === 0
        ? `${sampleSignoffs.phaseLabel ?? input.phaseId} 样品/签样已确认`
        : `${sampleSignoffs.blockers.length} 个样品/签样缺口`,
      blockers: sampleSignoffs.blockers,
    });
  } else {
    dimensions.push({
      dimension: "sample_signoffs",
      ok: true,
      summary: "无强制样品/签样待确认项",
      blockers: [],
    });
  }

  const issueTitles = input.criticalIssues.titles;
  dimensions.push({
    dimension: "critical_issues",
    ok: issueTitles.length === 0,
    summary: issueTitles.length === 0 ? "无未关闭 P0/P1" : `${issueTitles.length} 个未关闭 P0/P1`,
    blockers: issueTitles,
  });

  const roleBlockTitles = input.roleBlocks?.titles ?? [];
  dimensions.push({
    dimension: "role_blocks",
    ok: roleBlockTitles.length === 0,
    summary: roleBlockTitles.length === 0 ? "无 QA/PE 阻断项" : `${roleBlockTitles.length} 个 QA/PE 阻断项`,
    blockers: roleBlockTitles,
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
