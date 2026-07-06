import { daysBetween, isProjectedOverdue, type RagLevel } from "./health";

export type ManagementPortfolioInput = {
  id: string;
  name: string;
  projectNumber: string;
  category: string;
  customer: string | null;
  currentPhase: string;
  targetDate: string | null;
  projectedEnd: string | null;
  ragLevel: RagLevel;
  ragReasons: string[];
  pmName: string | null;
  overdueTasks: number;
  blockedTasks: number;
  criticalIssues: number;
  openIssues: number;
  highRisks?: number;
  mediumRisks?: number;
  gateBlockers: number;
  deliverableGap: number;
};

export type ManagementGateReviewInput = {
  projectId: string;
  phaseId: string;
  decision: string;
  roundNumber: number;
  reviewDate?: string | null;
};

export type ManagementIssueInput = {
  projectId: string;
  projectName: string;
  phaseId: string | null;
  title: string;
  severity: "P0" | "P1" | "P2" | "P3" | string;
  status: string;
  foundDate: string | null;
  targetDate?: string | null;
  owner?: string | null;
};

export type ManagementClosureInput = {
  projectId: string;
  phaseId: string;
  status: string;
  relatedIssueStatus?: string | null;
};

export type ManagementBomCostInput = {
  projectId: string;
  projectName: string;
  customer: string | null;
  targetCost: number | null;
  workingBomCost: number | null;
  lineCount: number;
};

export type ManagementDelayRow = {
  projectId: string;
  projectName: string;
  projectNumber: string;
  customer: string | null;
  currentPhase: string;
  targetDate: string | null;
  projectedEnd: string | null;
  slipDays: number | null;
  ragLevel: RagLevel;
  reasons: string[];
};

export type ManagementCustomerRiskRow = ManagementDelayRow & {
  score: number;
  criticalIssues: number;
  openIssues: number;
  overdueTasks: number;
  blockedTasks: number;
  highRisks: number;
  mediumRisks: number;
};

export type ManagementKpis = {
  delayPrediction: {
    totalTracked: number;
    delayedCount: number;
    delayedRatePct: number | null;
    maxSlipDays: number | null;
    rows: ManagementDelayRow[];
  };
  gateFirstPass: {
    reviewedGateCount: number;
    firstPassCount: number;
    ratePct: number | null;
    byPhase: Array<{ phaseId: string; reviewedGateCount: number; firstPassCount: number; ratePct: number | null }>;
  };
  p0p1Aging: {
    openCount: number;
    averageAgeDays: number | null;
    over7Days: number;
    over14Days: number;
    over30Days: number;
    rows: Array<ManagementIssueInput & { ageDays: number }>;
  };
  validationClosure: {
    byPhase: Array<{ phaseId: "evt" | "dvt" | "pvt"; total: number; closed: number; open: number; closureRatePct: number | null }>;
  };
  bomCostDelta: {
    trackedProjectCount: number;
    overTargetCount: number;
    rows: Array<ManagementBomCostInput & { delta: number | null; deltaPct: number | null }>;
  };
  customerRiskRanking: {
    rows: ManagementCustomerRiskRow[];
  };
};

const VALIDATION_PHASES = ["evt", "dvt", "pvt"] as const;
const OPEN_ISSUE_STATUSES = new Set(["open", "in_progress"]);
const CLOSED_ISSUE_STATUSES = new Set(["resolved", "closed", "wont_fix"]);
const CLOSED_TEST_STATUSES = new Set(["passed", "waived"]);

export function computeManagementKpis(input: {
  portfolio: ManagementPortfolioInput[];
  gateReviews: ManagementGateReviewInput[];
  issues: ManagementIssueInput[];
  validationItems: ManagementClosureInput[];
  bomCosts: ManagementBomCostInput[];
  todayISO: string;
}): ManagementKpis {
  const delayRows = input.portfolio
    .map((row): ManagementDelayRow | null => {
      const slipDays = daysBetween(row.targetDate, row.projectedEnd);
      if (!isProjectedOverdue(row.projectedEnd, row.targetDate) && row.ragLevel !== "red") return null;
      return {
        projectId: row.id,
        projectName: row.name,
        projectNumber: row.projectNumber,
        customer: row.customer,
        currentPhase: row.currentPhase,
        targetDate: row.targetDate,
        projectedEnd: row.projectedEnd,
        slipDays,
        ragLevel: row.ragLevel,
        reasons: row.ragReasons,
      };
    })
    .filter((row): row is ManagementDelayRow => !!row)
    .sort((a, b) => (b.slipDays ?? -999) - (a.slipDays ?? -999));

  const trackedDelayRows = input.portfolio.filter((row) => row.targetDate || row.projectedEnd);
  const delayedCount = trackedDelayRows.filter((row) => isProjectedOverdue(row.projectedEnd, row.targetDate)).length;
  const slipDays = trackedDelayRows
    .map((row) => daysBetween(row.targetDate, row.projectedEnd))
    .filter((value): value is number => value !== null);

  const gateFirstPass = computeGateFirstPass(input.gateReviews);
  const p0p1Aging = computeP0P1Aging(input.issues, input.todayISO);
  const validationClosure = computeValidationClosure(input.validationItems);
  const bomCostDelta = computeBomCostDelta(input.bomCosts);
  const customerRiskRanking = computeCustomerRiskRanking(input.portfolio);

  return {
    delayPrediction: {
      totalTracked: trackedDelayRows.length,
      delayedCount,
      delayedRatePct: trackedDelayRows.length > 0 ? Math.round((delayedCount / trackedDelayRows.length) * 100) : null,
      maxSlipDays: slipDays.length > 0 ? Math.max(...slipDays) : null,
      rows: delayRows.slice(0, 10),
    },
    gateFirstPass,
    p0p1Aging,
    validationClosure,
    bomCostDelta,
    customerRiskRanking,
  };
}

function computeGateFirstPass(gateReviews: ManagementGateReviewInput[]): ManagementKpis["gateFirstPass"] {
  const byGate = new Map<string, ManagementGateReviewInput[]>();
  for (const review of gateReviews) {
    const key = `${review.projectId}:${review.phaseId}`;
    byGate.set(key, [...(byGate.get(key) ?? []), review]);
  }

  const reviewed = Array.from(byGate.values());
  const isFirstPass = (reviews: ManagementGateReviewInput[]) =>
    reviews.some((review) => review.roundNumber === 1 && review.decision === "approved");
  const firstPassCount = reviewed.filter(isFirstPass).length;
  const byPhaseMap = new Map<string, { reviewedGateCount: number; firstPassCount: number }>();
  for (const reviews of reviewed) {
    const phaseId = reviews[0]?.phaseId || "unknown";
    const prev = byPhaseMap.get(phaseId) ?? { reviewedGateCount: 0, firstPassCount: 0 };
    prev.reviewedGateCount += 1;
    if (isFirstPass(reviews)) prev.firstPassCount += 1;
    byPhaseMap.set(phaseId, prev);
  }

  return {
    reviewedGateCount: reviewed.length,
    firstPassCount,
    ratePct: reviewed.length > 0 ? Math.round((firstPassCount / reviewed.length) * 100) : null,
    byPhase: Array.from(byPhaseMap.entries())
      .map(([phaseId, row]) => ({
        phaseId,
        reviewedGateCount: row.reviewedGateCount,
        firstPassCount: row.firstPassCount,
        ratePct: row.reviewedGateCount > 0 ? Math.round((row.firstPassCount / row.reviewedGateCount) * 100) : null,
      }))
      .sort((a, b) => phaseOrder(a.phaseId) - phaseOrder(b.phaseId)),
  };
}

function computeP0P1Aging(issues: ManagementIssueInput[], todayISO: string): ManagementKpis["p0p1Aging"] {
  const rows = issues
    .filter((issue) => (issue.severity === "P0" || issue.severity === "P1") && OPEN_ISSUE_STATUSES.has(issue.status))
    .map((issue) => ({ ...issue, ageDays: Math.max(0, daysBetween(issue.foundDate, todayISO) ?? 0) }))
    .sort((a, b) => b.ageDays - a.ageDays || a.projectName.localeCompare(b.projectName));
  const averageAgeDays = rows.length > 0
    ? Math.round(rows.reduce((sum, row) => sum + row.ageDays, 0) / rows.length)
    : null;

  return {
    openCount: rows.length,
    averageAgeDays,
    over7Days: rows.filter((row) => row.ageDays > 7).length,
    over14Days: rows.filter((row) => row.ageDays > 14).length,
    over30Days: rows.filter((row) => row.ageDays > 30).length,
    rows: rows.slice(0, 10),
  };
}

function computeValidationClosure(items: ManagementClosureInput[]): ManagementKpis["validationClosure"] {
  return {
    byPhase: VALIDATION_PHASES.map((phaseId) => {
      const phaseItems = items.filter((item) => item.phaseId === phaseId);
      const closed = phaseItems.filter((item) =>
        CLOSED_TEST_STATUSES.has(item.status)
        || ((item.status === "failed" || item.status === "blocked") && item.relatedIssueStatus != null && CLOSED_ISSUE_STATUSES.has(item.relatedIssueStatus))
      ).length;
      const total = phaseItems.length;
      return {
        phaseId,
        total,
        closed,
        open: total - closed,
        closureRatePct: total > 0 ? Math.round((closed / total) * 100) : null,
      };
    }),
  };
}

function computeBomCostDelta(rows: ManagementBomCostInput[]): ManagementKpis["bomCostDelta"] {
  const enriched = rows
    .map((row) => {
      const delta = row.workingBomCost != null && row.targetCost != null ? roundMoney(row.workingBomCost - row.targetCost) : null;
      const deltaPct = delta != null && row.targetCost && row.targetCost > 0
        ? Math.round((delta / row.targetCost) * 100)
        : null;
      return { ...row, delta, deltaPct };
    })
    .filter((row) => row.workingBomCost != null || row.targetCost != null)
    .sort((a, b) => (b.deltaPct ?? -999) - (a.deltaPct ?? -999));

  return {
    trackedProjectCount: enriched.length,
    overTargetCount: enriched.filter((row) => (row.delta ?? 0) > 0).length,
    rows: enriched.slice(0, 10),
  };
}

function computeCustomerRiskRanking(rows: ManagementPortfolioInput[]): ManagementKpis["customerRiskRanking"] {
  const ranked = rows
    .filter((row) => !!row.customer)
    .map((row): ManagementCustomerRiskRow => {
      const slipDays = daysBetween(row.targetDate, row.projectedEnd);
      const score =
        (row.ragLevel === "red" ? 60 : row.ragLevel === "amber" ? 30 : 0)
        + row.criticalIssues * 15
        + row.openIssues * 3
        + row.overdueTasks * 4
        + row.blockedTasks * 5
        + (row.highRisks ?? 0) * 12
        + (row.mediumRisks ?? 0) * 6
        + Math.max(0, slipDays ?? 0);
      return {
        projectId: row.id,
        projectName: row.name,
        projectNumber: row.projectNumber,
        customer: row.customer,
        currentPhase: row.currentPhase,
        targetDate: row.targetDate,
        projectedEnd: row.projectedEnd,
        slipDays,
        ragLevel: row.ragLevel,
        reasons: row.ragReasons,
        score,
        criticalIssues: row.criticalIssues,
        openIssues: row.openIssues,
        overdueTasks: row.overdueTasks,
        blockedTasks: row.blockedTasks,
        highRisks: row.highRisks ?? 0,
        mediumRisks: row.mediumRisks ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score || (b.slipDays ?? -999) - (a.slipDays ?? -999));

  return { rows: ranked.slice(0, 10) };
}

function phaseOrder(phaseId: string): number {
  const order = ["concept", "planning", "design", "evt", "dvt", "pvt", "mp"];
  const index = order.indexOf(phaseId);
  return index >= 0 ? index : 99;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseCostValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
