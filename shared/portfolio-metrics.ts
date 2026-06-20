import type { ProjectMetrics } from "./metrics";

export type PortfolioMetricRow = {
  projectId: string;
  name: string;
  ragLevel: string;
  leadTimeDaysMedian: number | null;
  overdueRatePct: number | null;
  recentThroughput: number;
  gateFirstPassRatePct: number | null;
  plannedCount: number;
  dueDatedCount: number;
  overdueCount: number;
};

export type PortfolioMetricAggregates = {
  projectCount: number;
  ragCounts: { red: number; amber: number; green: number };
  totalRecentThroughput: number;
  pooledOverdueRatePct: number | null;
};

export type PortfolioMetricsRollup = {
  rows: PortfolioMetricRow[];
  aggregates: PortfolioMetricAggregates;
};

export function rollupPortfolioMetrics(
  input: { projectId: string; name: string; ragLevel: string; metrics: ProjectMetrics }[],
): PortfolioMetricsRollup {
  const rows: PortfolioMetricRow[] = input.map((item) => {
    const eff = item.metrics.efficiency;
    const sorted = [...eff.throughputByWeek].sort((a, b) => a.weekKey.localeCompare(b.weekKey));
    const recentThroughput = sorted.slice(-4).reduce((sum, w) => sum + w.count, 0);
    return {
      projectId: item.projectId,
      name: item.name,
      ragLevel: item.ragLevel,
      leadTimeDaysMedian: eff.leadTimeDaysMedian,
      overdueRatePct: eff.overdueRatePct,
      recentThroughput,
      gateFirstPassRatePct: item.metrics.process.gateFirstPassRatePct,
      plannedCount: eff.plannedCount,
      dueDatedCount: eff.dueDatedCount,
      overdueCount: eff.overdueCount,
    };
  });

  rows.sort((a, b) => {
    if (a.overdueRatePct === null && b.overdueRatePct === null) return 0;
    if (a.overdueRatePct === null) return 1;
    if (b.overdueRatePct === null) return -1;
    return b.overdueRatePct - a.overdueRatePct;
  });

  const ragCounts = { red: 0, amber: 0, green: 0 };
  for (const row of rows) {
    if (row.ragLevel === "red" || row.ragLevel === "amber" || row.ragLevel === "green") {
      ragCounts[row.ragLevel] += 1;
    }
  }

  const totalRecentThroughput = rows.reduce((sum, r) => sum + r.recentThroughput, 0);
  const totalDueDated = rows.reduce((sum, r) => sum + r.dueDatedCount, 0);
  const totalOverdue = rows.reduce((sum, r) => sum + r.overdueCount, 0);
  const pooledOverdueRatePct = totalDueDated > 0
    ? Math.round((totalOverdue / totalDueDated) * 100)
    : null;

  return {
    rows,
    aggregates: { projectCount: rows.length, ragCounts, totalRecentThroughput, pooledOverdueRatePct },
  };
}
