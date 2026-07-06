// Linear redesign — 总览 / Overview dashboard (exec scope).
// Phase 1: VISUAL ONLY. The data model (buildDashboard) and all derived metrics are
// preserved verbatim; only the presentation/layout was reworked to the Linear design:
// greeting subline + 6 KPI cards + 今日聚焦 row + two equal-height columns
// (风险预警 / 组合进度 on the left, 即将 Gate / 阶段分布 on the right).
import type React from "react";
import { useMemo } from "react";
import { AlertTriangle, CalendarClock, Gauge, TrendingDown, ShieldAlert, Factory, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getPhasesForCategory } from "@/lib/sop-templates";
import { PHASE_MAP } from "@/lib/data";
import { isProjectedOverdue, type RagLevel } from "@shared/health";
import { LinearCard, LinearBar, StatusDot } from "@/components/linear/primitives";
import type { PortfolioTableRow } from "./PortfolioTable";
import type { ManagementKpis } from "@shared/management-kpis";

type DrillKind = "overdue" | "blocked";

type ScoredProject = {
  row: PortfolioTableRow;
  level: RagLevel;
  reasons: string[];
};

const PIE_FALLBACK_COLORS = ["#5e6ad2", "#0ea5e9", "#0f766e", "#d97706", "#7c3aed", "#b45309", "#3fa66a", "#db2777"];

const ragTone = (level: RagLevel): "green" | "amber" | "red" =>
  level === "red" ? "red" : level === "amber" ? "amber" : "green";

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function scoreProject(row: PortfolioTableRow): ScoredProject {
  return { row, level: row.ragLevel, reasons: row.ragReasons };
}

function projectIsActive(row: PortfolioTableRow) {
  return !projectIsNotStarted(row) && !projectIsFinished(row);
}

function projectIsNotStarted(row: PortfolioTableRow) {
  return row.currentPhase === "concept" && row.taskDone === 0 && row.taskInProgress === 0;
}

function projectIsFinished(row: PortfolioTableRow) {
  if (row.gateTaskTotal > 0) return row.gateTaskDone >= row.gateTaskTotal;
  if (row.taskTotal > 0) return row.taskDone >= row.taskTotal;
  return row.currentPhase === "mp";
}

function ratio(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function progressOf(row: PortfolioTableRow) {
  return row.taskTotal > 0 ? Math.round((row.taskDone / row.taskTotal) * 100) : 0;
}

function daysAway(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 864e5);
}

export function PortfolioDashboard({
  rows,
  scopeLabel,
  onSelectProject,
  onDrill,
}: {
  rows: PortfolioTableRow[];
  scopeLabel: string;
  onSelectProject: (id: string) => void;
  onDrill: (kind: DrillKind) => void;
}) {
  const data = useMemo(() => buildDashboard(rows), [rows]);
  const managementKpis = trpc.analytics.managementKpis.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (rows.length === 0) {
    return (
      <LinearCard className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Gauge size={16} />
          当前范围暂无项目数据。
        </div>
      </LinearCard>
    );
  }

  const needAttention = data.health.red + data.health.amber;
  const onTimeRate = ratio(data.onTime, data.total);
  const greeting = `${data.activeProjects} 个进行中 · ${needAttention} 个需关注 · ${data.upcomingGateCount} 场即将 Gate`;

  const kpis: KpiSpec[] = [
    { label: "进行中", value: data.activeProjects, sub: `${scopeLabel}` },
    { label: "按期", value: data.onTime, sub: `占比 ${onTimeRate}%`, tone: "green" },
    { label: "风险", value: needAttention, sub: `${data.health.amber} 中 · ${data.health.red} 高`, tone: data.health.red > 0 ? "red" : needAttention > 0 ? "amber" : "neutral" },
    { label: "即将 Gate", value: data.upcomingGateCount, sub: "待评审", tone: "acc" },
    { label: "未关闭问题", value: data.openIssues, sub: `P0/P1 ${data.criticalIssues}`, tone: data.criticalIssues > 0 ? "red" : "neutral" },
    { label: "逾期任务", value: data.overdueTasks, sub: `阻塞 ${data.blockedTasks}`, tone: data.overdueTasks > 0 ? "red" : "neutral", onClick: () => onDrill("overdue") },
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <p className="-mt-1 text-[13px] text-muted-foreground">{greeting}</p>

      {/* KPI strip — 6 cards */}
      <div className="grid grid-cols-2 gap-[13px] sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
      </div>

      {/* 今日聚焦 / Today's Focus — full-width, 3 items */}
      <FocusBand items={data.focusItems} onSelectProject={onSelectProject} onDrill={onDrill} />

      <ManagementKpiBoard
        data={managementKpis.data}
        isLoading={managementKpis.isLoading}
        onSelectProject={onSelectProject}
      />

      {/* Two balanced, equal-height columns — boards keep a fixed height so adding/removing
          content never changes the overall page length (content overflows + scrolls in place). */}
      <div className="grid grid-cols-1 items-stretch gap-[18px] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-[18px]">
          <RiskAlertsBoard rows={data.riskAlerts} onSelectProject={onSelectProject} />
          <ProgressBoard rows={data.progressRows} onSelectProject={onSelectProject} />
        </div>
        <div className="flex flex-col gap-[18px]">
          <GatesBoard rows={data.gateRows} onSelectProject={onSelectProject} />
          <PhaseDistBoard phases={data.phaseRows} total={data.total} />
        </div>
      </div>
    </div>
  );
}

function buildDashboard(rows: PortfolioTableRow[]) {
  const scored = rows.map(scoreProject);
  const total = rows.length;
  const health = { green: 0, amber: 0, red: 0 } as Record<RagLevel, number>;
  for (const item of scored) health[item.level] += 1;

  const overdueTasks = rows.reduce((sum, row) => sum + row.overdueTasks, 0);
  const blockedTasks = rows.reduce((sum, row) => sum + row.blockedTasks, 0);
  const openIssues = rows.reduce((sum, row) => sum + row.openIssues, 0);
  const criticalIssues = rows.reduce((sum, row) => sum + row.criticalIssues, 0);
  const onTime = rows.filter((row) => !isProjectedOverdue(row.projectedEnd, row.targetDate)).length;

  // Phase distribution (kept verbatim from prior buildDashboard).
  const phaseMap = new Map<string, { id: string; code: string; name: string; count: number; color: string; order: number }>();
  rows.forEach((row) => {
    const phases = getPhasesForCategory(row.category);
    const phaseIndex = phases.findIndex((item) => item.id === row.currentPhase);
    const phase = phaseIndex >= 0 ? phases[phaseIndex] : null;
    const key = phase?.id ?? row.currentPhase;
    const existing = phaseMap.get(key);
    phaseMap.set(key, {
      id: key,
      code: phase?.code ?? key.toUpperCase(),
      name: phase?.name ?? key,
      count: (existing?.count ?? 0) + 1,
      color: existing?.color ?? normalizePieColor(phase?.color, phaseMap.size),
      order: existing?.order ?? (phaseIndex >= 0 ? phaseIndex : 99),
    });
  });
  const maxPhaseCount = Math.max(1, ...Array.from(phaseMap.values()).map((p) => p.count));
  const phaseRows = Array.from(phaseMap.values())
    .map((phase) => ({ ...phase, percent: ratio(phase.count, total), barPct: Math.round((phase.count / maxPhaseCount) * 100) }))
    .sort((a, b) => a.order - b.order || b.count - a.count);

  // Upcoming gates: undone gates with a due date, soonest first.
  const gateRows = rows
    .filter((row) => !row.gateDone && !!row.gateDueDate)
    .sort((a, b) => (a.gateDueDate ?? "9999").localeCompare(b.gateDueDate ?? "9999"))
    .slice(0, 5);
  const upcomingGateCount = rows.filter((row) => !row.gateDone && !!row.gateDueDate).length;

  // Risk alerts: red/amber projects (and any with critical issues / hard blockers), worst first.
  const riskAlerts = scored
    .filter((item) => item.level !== "green" || item.row.criticalIssues > 0 || item.row.releaseHardBlockers > 0)
    .sort((a, b) => {
      const rank = (level: RagLevel) => (level === "red" ? 0 : level === "amber" ? 1 : 2);
      return rank(a.level) - rank(b.level) || b.row.criticalIssues - a.row.criticalIssues;
    })
    .slice(0, 5);

  // Portfolio progress: active projects by progress descending.
  const progressRows = rows
    .filter(projectIsActive)
    .sort((a, b) => progressOf(b) - progressOf(a))
    .slice(0, 6);

  // 今日聚焦: highest-signal action items across the portfolio.
  const focusItems = buildFocusItems(rows, scored);

  return {
    total,
    activeProjects: rows.filter(projectIsActive).length,
    notStartedProjects: rows.filter(projectIsNotStarted).length,
    onTime,
    overdueTasks,
    blockedTasks,
    openIssues,
    criticalIssues,
    health,
    scored,
    phaseRows,
    gateRows,
    upcomingGateCount,
    riskAlerts,
    progressRows,
    focusItems,
  };
}

type FocusItem = {
  key: string;
  tone: "red" | "amber";
  title: string;
  detail: string;
  projectId: string | null;
  drill?: DrillKind;
};

function buildFocusItems(rows: PortfolioTableRow[], scored: ScoredProject[]): FocusItem[] {
  const items: FocusItem[] = [];

  // 1) Most critical issue-bearing project.
  const critical = [...rows].filter((r) => r.criticalIssues > 0).sort((a, b) => b.criticalIssues - a.criticalIssues)[0];
  if (critical) {
    items.push({
      key: `crit-${critical.id}`,
      tone: "red",
      title: `${critical.name} · ${critical.criticalIssues} 项 P0/P1 问题`,
      detail: `${critical.projectNumber || "—"} · ${PHASE_MAP[critical.currentPhase]?.name ?? critical.currentPhase}${critical.pmName ? ` · ${critical.pmName}` : ""}`,
      projectId: critical.id,
    });
  }

  // 2) Most overdue / blocked load.
  const delayed = [...rows]
    .filter((r) => r.overdueTasks > 0 || r.blockedTasks > 0)
    .sort((a, b) => (b.overdueTasks * 2 + b.blockedTasks) - (a.overdueTasks * 2 + a.blockedTasks))[0];
  if (delayed) {
    items.push({
      key: `delay-${delayed.id}`,
      tone: "amber",
      title: `${delayed.name} · 逾期 ${delayed.overdueTasks} · 阻塞 ${delayed.blockedTasks}`,
      detail: `${delayed.projectNumber || "—"} · ${PHASE_MAP[delayed.currentPhase]?.name ?? delayed.currentPhase}`,
      projectId: delayed.id,
      drill: delayed.overdueTasks >= delayed.blockedTasks ? "overdue" : "blocked",
    });
  }

  // 3) Nearest upcoming gate.
  const nextGate = [...rows]
    .filter((r) => !r.gateDone && !!r.gateDueDate)
    .sort((a, b) => (a.gateDueDate ?? "9999").localeCompare(b.gateDueDate ?? "9999"))[0];
  if (nextGate) {
    const away = daysAway(nextGate.gateDueDate);
    items.push({
      key: `gate-${nextGate.id}`,
      tone: "amber",
      title: `${nextGate.name || "评审"} · ${nextGate.gateName || "Gate"}`,
      detail: `${away !== null ? (away <= 0 ? "已到期" : `还有 ${away} 天`) : nextGate.gateDueDate} · ${nextGate.name}`,
      projectId: nextGate.id,
    });
  }

  // Backfill from red/amber projects if we have fewer than 3 signals.
  for (const s of scored) {
    if (items.length >= 3) break;
    if (s.level === "green") continue;
    if (items.some((i) => i.projectId === s.row.id)) continue;
    items.push({
      key: `att-${s.row.id}`,
      tone: s.level === "red" ? "red" : "amber",
      title: `${s.row.name} · ${s.reasons[0] ?? "需关注"}`,
      detail: `${s.row.projectNumber || "—"} · ${PHASE_MAP[s.row.currentPhase]?.name ?? s.row.currentPhase}`,
      projectId: s.row.id,
    });
  }

  return items.slice(0, 3);
}

function normalizePieColor(color: string | undefined, index: number) {
  return color && color.startsWith("#") ? color : PIE_FALLBACK_COLORS[index % PIE_FALLBACK_COLORS.length];
}

function ManagementKpiBoard({
  data,
  isLoading,
  onSelectProject,
}: {
  data?: ManagementKpis;
  isLoading: boolean;
  onSelectProject: (id: string) => void;
}) {
  if (isLoading && !data) {
    return (
      <LinearCard className="p-4 text-sm text-muted-foreground">
        正在计算管理层 KPI...
      </LinearCard>
    );
  }
  if (!data) return null;

  const avgAge = data.p0p1Aging.averageAgeDays;
  const closure = data.validationClosure.byPhase;
  const closureTotal = closure.reduce((sum, row) => sum + row.total, 0);
  const closureClosed = closure.reduce((sum, row) => sum + row.closed, 0);
  const closureRate = closureTotal > 0 ? Math.round((closureClosed / closureTotal) * 100) : null;
  const topCustomerRisk = data.customerRiskRanking.rows[0];

  const kpis: KpiSpec[] = [
    {
      label: "延期预测",
      value: data.delayPrediction.delayedCount,
      sub: `${fmtPct(data.delayPrediction.delayedRatePct)} · 最大 ${data.delayPrediction.maxSlipDays ?? 0} 天`,
      tone: data.delayPrediction.delayedCount > 0 ? "red" : "green",
    },
    {
      label: "Gate 一次通过",
      value: fmtPct(data.gateFirstPass.ratePct),
      sub: `${data.gateFirstPass.firstPassCount}/${data.gateFirstPass.reviewedGateCount}`,
      tone: data.gateFirstPass.ratePct != null && data.gateFirstPass.ratePct < 70 ? "amber" : "green",
    },
    {
      label: "P0/P1 Aging",
      value: avgAge == null ? "—" : `${avgAge}d`,
      sub: `${data.p0p1Aging.openCount} open · >14d ${data.p0p1Aging.over14Days}`,
      tone: data.p0p1Aging.over14Days > 0 ? "red" : data.p0p1Aging.openCount > 0 ? "amber" : "green",
    },
    {
      label: "EVT/DVT/PVT 关闭",
      value: fmtPct(closureRate),
      sub: `${closureClosed}/${closureTotal} test case`,
      tone: closureRate != null && closureRate < 80 ? "amber" : "green",
    },
    {
      label: "BOM 超目标",
      value: data.bomCostDelta.overTargetCount,
      sub: `${data.bomCostDelta.trackedProjectCount} 个有成本数据`,
      tone: data.bomCostDelta.overTargetCount > 0 ? "amber" : "neutral",
    },
    {
      label: "客户项目风险",
      value: topCustomerRisk ? topCustomerRisk.score : 0,
      sub: topCustomerRisk ? `${topCustomerRisk.customer} · ${topCustomerRisk.projectName}` : "暂无客户风险",
      tone: topCustomerRisk && topCustomerRisk.score > 0 ? "red" : "green",
    },
  ];

  return (
    <div className="space-y-[18px]">
      <Panel title="管理层决策 KPI" sub="Phase 3F">
        <div className="grid grid-cols-2 gap-[13px] p-4 sm:grid-cols-3 lg:grid-cols-6">
          {kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-3">
        <Panel title="客户项目风险排行" sub="Customer Risk" className="min-h-[280px]">
          <div className="divide-y divide-border">
            {data.customerRiskRanking.rows.slice(0, 5).map((row) => (
              <button key={row.projectId} onClick={() => onSelectProject(row.projectId)}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-secondary">
                <div className="flex items-start gap-3">
                  <Users size={14} className="mt-0.5 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{row.projectName}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {row.customer} · {PHASE_MAP[row.currentPhase]?.name ?? row.currentPhase}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.criticalIssues > 0 && <Tag tone="rose">P0/P1 {row.criticalIssues}</Tag>}
                      {row.slipDays != null && row.slipDays > 0 && <Tag tone="amber">晚 {row.slipDays}d</Tag>}
                      {row.highRisks > 0 && <Tag tone="rose">高风险 {row.highRisks}</Tag>}
                    </div>
                  </div>
                  <span className="num text-sm font-semibold text-foreground">{row.score}</span>
                </div>
              </button>
            ))}
            {data.customerRiskRanking.rows.length === 0 && (
              <EmptyPanelLine text="暂无客户项目风险排行。" />
            )}
          </div>
        </Panel>

        <Panel title="BOM Cost Delta" sub="Target vs Working" className="min-h-[280px]">
          <div className="divide-y divide-border">
            {data.bomCostDelta.rows.slice(0, 5).map((row) => (
              <button key={row.projectId} onClick={() => onSelectProject(row.projectId)}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-secondary">
                <div className="flex items-start gap-3">
                  <Factory size={14} className="mt-0.5 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{row.projectName}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      BOM {fmtMoney(row.workingBomCost)} · Target {fmtMoney(row.targetCost)}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Tag tone={(row.delta ?? 0) > 0 ? "amber" : "emerald"}>
                        {row.delta == null ? "缺口径" : `${row.delta > 0 ? "+" : ""}${fmtMoney(row.delta)} (${fmtPct(row.deltaPct)})`}
                      </Tag>
                      <Tag tone="stone">{row.lineCount} lines</Tag>
                    </div>
                  </div>
                </div>
              </button>
            ))}
            {data.bomCostDelta.rows.length === 0 && (
              <EmptyPanelLine text="暂无 BOM 成本与目标成本对比数据。" />
            )}
          </div>
        </Panel>

        <Panel title="验证关闭率" sub="EVT / DVT / PVT" className="min-h-[280px]">
          <div className="space-y-3 p-4">
            {closure.map((row) => (
              <div key={row.phaseId} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-foreground">{row.phaseId.toUpperCase()}</span>
                  <span className="num text-muted-foreground">
                    {row.closureRatePct == null ? "—" : `${row.closureRatePct}%`} · {row.closed}/{row.total}
                  </span>
                </div>
                <LinearBar
                  value={row.closureRatePct ?? 0}
                  className={row.closureRatePct != null && row.closureRatePct < 80
                    ? "[&>div]:bg-[color:var(--warning)]"
                    : "[&>div]:bg-[color:var(--success)]"}
                />
              </div>
            ))}
            <div className="mt-4 rounded-md border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                <ShieldAlert size={13} className="text-primary" />
                P0/P1 老化 Top
              </div>
              <div className="mt-2 divide-y divide-border">
                {data.p0p1Aging.rows.slice(0, 3).map((issue) => (
                  <button key={`${issue.projectId}-${issue.title}`} onClick={() => onSelectProject(issue.projectId)}
                    className="w-full py-2 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-foreground">{issue.title}</span>
                      <Tag tone={issue.ageDays > 14 ? "rose" : "amber"}>{issue.ageDays}d</Tag>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{issue.projectName}</div>
                  </button>
                ))}
                {data.p0p1Aging.rows.length === 0 && (
                  <div className="py-2 text-xs text-muted-foreground">暂无开放 P0/P1。</div>
                )}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {data.delayPrediction.rows.length > 0 && (
        <Panel title="延期预测 Top" sub="Projected Delay">
          <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            {data.delayPrediction.rows.slice(0, 6).map((row) => (
              <button key={row.projectId} onClick={() => onSelectProject(row.projectId)}
                className="px-4 py-3 text-left transition-colors hover:bg-secondary">
                <div className="flex items-start gap-3">
                  <TrendingDown size={14} className="mt-0.5 text-[color:var(--destructive)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{row.projectName}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      目标 {row.targetDate ?? "—"} · 预测 {row.projectedEnd ?? "未排期"}
                    </div>
                  </div>
                  <Tag tone={(row.slipDays ?? 0) > 7 ? "rose" : "amber"}>
                    {row.slipDays == null ? "红灯" : `晚 ${row.slipDays}d`}
                  </Tag>
                </div>
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function EmptyPanelLine({ text }: { text: string }) {
  return <div className="px-4 py-8 text-sm text-muted-foreground">{text}</div>;
}

function fmtPct(value: number | null | undefined): string {
  return value == null ? "—" : `${value}%`;
}

function fmtMoney(value: number | null | undefined): string {
  return value == null ? "—" : Number(value).toFixed(2);
}

function Tag({ tone, children }: { tone: "rose" | "amber" | "emerald" | "stone"; children: React.ReactNode }) {
  const style: React.CSSProperties =
    tone === "rose" ? { background: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: "var(--destructive)", borderColor: "color-mix(in srgb, var(--destructive) 30%, transparent)" } :
    tone === "amber" ? { background: "color-mix(in srgb, var(--warning) 12%, transparent)", color: "var(--warning)", borderColor: "color-mix(in srgb, var(--warning) 30%, transparent)" } :
    tone === "emerald" ? { background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)", borderColor: "color-mix(in srgb, var(--success) 30%, transparent)" } :
    { background: "var(--secondary)", color: "var(--secondary-foreground)", borderColor: "var(--border)" };
  return <span className="num whitespace-nowrap rounded-[5px] border px-1.5 py-0.5 text-[10px]" style={style}>{children}</span>;
}

// ── KPI card ──────────────────────────────────────────────────────────────────
type KpiSpec = {
  label: string;
  value: number | string;
  sub: string;
  tone?: "neutral" | "green" | "amber" | "red" | "acc";
  onClick?: () => void;
};

function KpiCard({ label, value, sub, tone = "neutral", onClick }: KpiSpec) {
  const valueColor =
    tone === "green" ? "text-[color:var(--success)]" :
    tone === "amber" ? "text-[color:var(--warning)]" :
    tone === "red" ? "text-[color:var(--destructive)]" :
    tone === "acc" ? "text-primary" :
    "text-foreground";
  const inner = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{label}</div>
      <div className={`num mt-[11px] text-[27px] font-bold leading-[0.9] tracking-[-0.5px] ${valueColor}`}>{value}</div>
      <div className="mt-[9px] text-[11px] text-muted-foreground">{sub}</div>
    </>
  );
  if (onClick) {
    return (
      <LinearCard hover className="cursor-pointer px-4 py-[15px] text-left" onClick={onClick} role="button" tabIndex={0}>
        {inner}
      </LinearCard>
    );
  }
  return <LinearCard className="px-4 py-[15px]">{inner}</LinearCard>;
}

// ── Panel shell ────────────────────────────────────────────────────────────────
function Panel({
  title, sub, cta, onCta, className, bodyClassName, children,
}: {
  title: string;
  sub?: string;
  cta?: string;
  onCta?: () => void;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <LinearCard className={`flex flex-col overflow-hidden ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-border px-4 py-[13px]">
        <div className="text-[14px] font-semibold">
          {title}
          {sub && <span className="ml-1.5 text-[12px] font-medium text-muted-foreground">{sub}</span>}
        </div>
        {cta && (
          <button onClick={onCta} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:opacity-80">
            {cta}
          </button>
        )}
      </div>
      <div className={bodyClassName}>{children}</div>
    </LinearCard>
  );
}

// ── 今日聚焦 ───────────────────────────────────────────────────────────────────
function FocusBand({
  items, onSelectProject, onDrill,
}: {
  items: FocusItem[];
  onSelectProject: (id: string) => void;
  onDrill: (kind: DrillKind) => void;
}) {
  return (
    <Panel title="今日聚焦" sub="Today's Focus">
      {items.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">今天没有紧急事项。</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={() => (item.drill ? onDrill(item.drill) : item.projectId && onSelectProject(item.projectId))}
              className="flex items-center gap-3 border-b border-border px-4 py-[15px] text-left transition-colors last:border-b-0 hover:bg-secondary lg:border-b-0 lg:border-r lg:last:border-r-0"
            >
              <span
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px]"
                style={
                  item.tone === "red"
                    ? { background: "color-mix(in srgb, var(--destructive) 14%, transparent)", color: "var(--destructive)" }
                    : { background: "color-mix(in srgb, var(--warning) 16%, transparent)", color: "var(--warning)" }
                }
              >
                {item.tone === "red" ? <AlertTriangle size={15} /> : <CalendarClock size={15} />}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold">{item.title}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{item.detail}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── 风险预警 ───────────────────────────────────────────────────────────────────
function RiskAlertsBoard({
  rows, onSelectProject,
}: {
  rows: ScoredProject[];
  onSelectProject: (id: string) => void;
}) {
  return (
    <Panel title="风险预警" bodyClassName="h-[280px] overflow-y-auto">
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">暂无风险项目。</div>
      ) : (
        rows.map(({ row, level, reasons }) => {
          const sevLabel = row.criticalIssues > 0 ? `P${level === "red" ? 0 : 1}×${row.criticalIssues}` : level === "red" ? "高" : "中";
          return (
            <button
              key={row.id}
              onClick={() => onSelectProject(row.id)}
              className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-secondary"
            >
              <span
                className="shrink-0 rounded-[5px] px-[7px] py-0.5 text-[9.5px] font-bold"
                style={
                  level === "red"
                    ? { background: "var(--destructive)", color: "#fff" }
                    : { background: "color-mix(in srgb, var(--warning) 16%, transparent)", color: "var(--warning)" }
                }
              >
                {sevLabel}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">{row.name}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                  {row.projectNumber || "—"} · {PHASE_MAP[row.currentPhase]?.name ?? row.currentPhase}
                  {row.pmName ? ` · ${row.pmName}` : ""}
                  {reasons.length ? ` · ${reasons[0]}` : ""}
                </div>
              </div>
              <StatusDot tone={ragTone(level)} />
            </button>
          );
        })
      )}
    </Panel>
  );
}

// ── 组合进度 ───────────────────────────────────────────────────────────────────
function ProgressBoard({
  rows, onSelectProject, className,
}: {
  rows: PortfolioTableRow[];
  onSelectProject: (id: string) => void;
  className?: string;
}) {
  return (
    <Panel title="组合进度" className={className} bodyClassName="h-[280px] overflow-y-auto">
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">暂无进行中的项目。</div>
      ) : (
        rows.map((row) => {
          const prog = progressOf(row);
          return (
            <button
              key={row.id}
              onClick={() => onSelectProject(row.id)}
              className="grid w-full grid-cols-[14px_minmax(0,1fr)_auto_120px] items-center gap-3 border-b border-border px-4 py-[11px] text-left transition-colors last:border-b-0 hover:bg-secondary"
            >
              <StatusDot tone={ragTone(row.ragLevel)} />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold">{row.name}</div>
                <div className="num truncate text-[10.5px] text-muted-foreground">{row.projectNumber || "—"}</div>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-[color:var(--secondary-foreground)]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-primary" />
                {PHASE_MAP[row.currentPhase]?.name ?? row.currentPhase}
              </span>
              <div className="flex items-center gap-2">
                <LinearBar value={prog} className="flex-1" />
                <span className="num w-[30px] text-right text-[11.5px] font-semibold text-muted-foreground">{prog}%</span>
              </div>
            </button>
          );
        })
      )}
    </Panel>
  );
}

// ── 即将 Gate ──────────────────────────────────────────────────────────────────
function GatesBoard({
  rows, onSelectProject,
}: {
  rows: PortfolioTableRow[];
  onSelectProject: (id: string) => void;
}) {
  return (
    <Panel title="即将到来 Gate" bodyClassName="h-[280px] overflow-y-auto">
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">近期暂无 Gate 评审。</div>
      ) : (
        rows.map((row) => {
          const away = daysAway(row.gateDueDate);
          const d = row.gateDueDate ? new Date(row.gateDueDate) : null;
          const urgent = away !== null && away <= 7;
          return (
            <button
              key={row.id}
              onClick={() => onSelectProject(row.id)}
              className="flex w-full items-center gap-[11px] border-b border-border px-4 py-[11px] text-left transition-colors last:border-b-0 hover:bg-secondary"
            >
              <div className="w-[42px] shrink-0 text-center">
                <div className="num text-[17px] font-bold leading-none">{d ? String(d.getDate()).padStart(2, "0") : "--"}</div>
                <div className="mt-0.5 text-[9px] uppercase text-muted-foreground">{d ? MONTH_ABBR[d.getMonth()] : ""}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{row.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{row.gateName || "Gate"}{row.pmName ? ` · ${row.pmName}` : ""}</div>
              </div>
              <span
                className="shrink-0 rounded-[5px] px-[7px] py-0.5 text-[10px] font-semibold"
                style={
                  urgent
                    ? { background: "color-mix(in srgb, var(--destructive) 12%, transparent)", color: "var(--destructive)" }
                    : { background: "color-mix(in srgb, var(--warning) 16%, transparent)", color: "var(--warning)" }
                }
              >
                {away !== null ? (away <= 0 ? "到期" : `${away}天`) : "—"}
              </span>
            </button>
          );
        })
      )}
    </Panel>
  );
}

// ── 阶段分布 ───────────────────────────────────────────────────────────────────
function PhaseDistBoard({
  phases, total, className,
}: {
  phases: Array<{ id: string; code: string; name: string; count: number; percent: number; barPct: number; color: string }>;
  total: number;
  className?: string;
}) {
  return (
    <Panel title="阶段分布" className={className} bodyClassName="h-[280px] overflow-y-auto">
      <div className="flex flex-col gap-[10px] px-4 py-[14px]">
        {phases.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无阶段数据。</div>
        ) : (
          phases.map((phase) => (
            <div key={phase.id} className="grid grid-cols-[auto_minmax(40px,1fr)_24px] items-center gap-[10px]">
              <span className="whitespace-nowrap text-[12px] text-[color:var(--secondary-foreground)]">{phase.name}</span>
              <div className="h-2 overflow-hidden rounded-[5px] bg-secondary">
                <div className="h-full rounded-[5px] bg-primary" style={{ width: `${phase.barPct}%` }} />
              </div>
              <span className="num text-right text-[12px] font-semibold text-muted-foreground">{phase.count}</span>
            </div>
          ))
        )}
        {phases.length > 0 && (
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
            <span>合计</span>
            <span className="num font-semibold text-foreground">{total} 个项目</span>
          </div>
        )}
      </div>
    </Panel>
  );
}
