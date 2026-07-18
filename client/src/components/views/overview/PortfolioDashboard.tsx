// Linear redesign — 总览 / Overview dashboard (exec scope).
// Phase 1: VISUAL ONLY. The data model (buildDashboard) and all derived metrics are
// preserved verbatim; only the presentation/layout was reworked to the Linear design:
// greeting subline + 6 KPI cards + 今日聚焦 row + two equal-height columns
// (风险预警 / 组合进度 on the left, 即将 Gate / 阶段分布 on the right).
import type React from "react";
import { useMemo } from "react";
import { Gauge, TrendingDown, ShieldAlert, WalletCards } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getEffectivePhasesForProjectLike } from "@shared/npd-v3";
import { resolvePhaseName } from "@shared/sop-template-resolution";
import { isProjectedOverdue, type RagLevel } from "@shared/health";
import {
  LinearCard,
  LinearBar,
  StatusDot,
} from "@/components/linear/primitives";
import type { PortfolioTableRow } from "./types";
import type { ManagementKpis } from "@shared/management-kpis";

type DrillKind = "overdue" | "blocked";

type ScoredProject = {
  row: PortfolioTableRow;
  level: RagLevel;
  reasons: string[];
};

const PIE_FALLBACK_COLORS = [
  "#5e6ad2",
  "#0ea5e9",
  "#0f766e",
  "#d97706",
  "#7c3aed",
  "#b45309",
  "#3fa66a",
  "#db2777",
];

const ragTone = (level: RagLevel): "green" | "amber" | "red" =>
  level === "red" ? "red" : level === "amber" ? "amber" : "green";

const MONTH_ABBR = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function scoreProject(row: PortfolioTableRow): ScoredProject {
  return { row, level: row.ragLevel, reasons: row.ragReasons };
}

function projectIsActive(row: PortfolioTableRow) {
  return !projectIsNotStarted(row) && !projectIsFinished(row);
}

function projectIsNotStarted(row: PortfolioTableRow) {
  return (
    row.currentPhase === "concept" &&
    row.taskDone === 0 &&
    row.taskInProgress === 0
  );
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
  return row.taskTotal > 0
    ? Math.round((row.taskDone / row.taskTotal) * 100)
    : 0;
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
  showManagementKpis = true,
}: {
  rows: PortfolioTableRow[];
  scopeLabel: string;
  onSelectProject: (id: string) => void;
  onDrill?: (kind: DrillKind) => void;
  showManagementKpis?: boolean;
}) {
  const data = useMemo(() => buildDashboard(rows), [rows]);
  const managementKpis = trpc.analytics.managementKpis.useQuery(undefined, {
    staleTime: 60_000,
    enabled: showManagementKpis,
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
  const kpis: KpiSpec[] = [
    { label: "进行中", value: data.activeProjects, sub: `${scopeLabel}` },
    {
      label: "按期",
      value: data.onTime,
      sub: `占比 ${onTimeRate}%`,
      tone: "green",
    },
    {
      label: "风险",
      value: needAttention,
      sub: `${data.health.amber} 中 · ${data.health.red} 高`,
      tone:
        data.health.red > 0 ? "red" : needAttention > 0 ? "amber" : "neutral",
    },
    {
      label: "即将 Gate",
      value: data.upcomingGateCount,
      sub: "待评审",
      tone: "acc",
    },
    {
      label: "未关闭问题",
      value: data.openIssues,
      sub: `P0/P1 ${data.criticalIssues}`,
      tone: data.criticalIssues > 0 ? "red" : "neutral",
    },
    {
      label: "逾期任务",
      value: data.overdueTasks,
      sub: `阻塞 ${data.blockedTasks}`,
      tone: data.overdueTasks > 0 ? "red" : "neutral",
      onClick: onDrill ? () => onDrill("overdue") : undefined,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="space-y-3">
        <SectionLabel title="组合摘要" sub={scopeLabel} />
        <div className="grid grid-cols-2 gap-[13px] sm:grid-cols-3 lg:grid-cols-6">
          {kpis.map(kpi => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel title="管理决策" sub="成本、质量与交付趋势" />
        {showManagementKpis && (
          <ManagementKpiBoard
            data={managementKpis.data}
            isLoading={managementKpis.isLoading}
            onSelectProject={onSelectProject}
          />
        )}
        <ExpenseVarianceBoard rows={rows} onSelectProject={onSelectProject} />
      </section>

      <section className="space-y-3">
        <SectionLabel title="执行状态" sub="风险、节点与项目推进" />
        <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <RiskAlertsBoard
            rows={data.riskAlerts}
            onSelectProject={onSelectProject}
          />
          <GatesBoard rows={data.gateRows} onSelectProject={onSelectProject} />
          <ProgressBoard
            rows={data.progressRows}
            onSelectProject={onSelectProject}
          />
          <PhaseDistBoard phases={data.phaseRows} total={data.total} />
        </div>
      </section>
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
  const onTime = rows.filter(
    row => !isProjectedOverdue(row.projectedEnd, row.targetDate)
  ).length;

  // Phase distribution (kept verbatim from prior buildDashboard).
  const phaseMap = new Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      count: number;
      color: string;
      order: number;
    }
  >();
  rows.forEach(row => {
    const phases = getEffectivePhasesForProjectLike(row);
    const phaseIndex = phases.findIndex(item => item.id === row.currentPhase);
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
  const maxPhaseCount = Math.max(
    1,
    ...Array.from(phaseMap.values()).map(p => p.count)
  );
  const phaseRows = Array.from(phaseMap.values())
    .map(phase => ({
      ...phase,
      percent: ratio(phase.count, total),
      barPct: Math.round((phase.count / maxPhaseCount) * 100),
    }))
    .sort((a, b) => a.order - b.order || b.count - a.count);

  // Upcoming gates: undone gates with a due date, soonest first.
  const gateRows = rows
    .filter(row => !row.gateDone && !!row.gateDueDate)
    .sort((a, b) =>
      (a.gateDueDate ?? "9999").localeCompare(b.gateDueDate ?? "9999")
    )
    .slice(0, 5);
  const upcomingGateCount = rows.filter(
    row => !row.gateDone && !!row.gateDueDate
  ).length;

  // Risk alerts: red/amber projects (and any with critical issues / hard blockers), worst first.
  const riskAlerts = scored
    .filter(
      item =>
        item.level !== "green" ||
        item.row.criticalIssues > 0 ||
        item.row.releaseHardBlockers > 0
    )
    .sort((a, b) => {
      const rank = (level: RagLevel) =>
        level === "red" ? 0 : level === "amber" ? 1 : 2;
      return (
        rank(a.level) - rank(b.level) ||
        b.row.criticalIssues - a.row.criticalIssues
      );
    })
    .slice(0, 5);

  // Portfolio progress: active projects by progress descending.
  const progressRows = rows
    .filter(projectIsActive)
    .sort((a, b) => progressOf(b) - progressOf(a))
    .slice(0, 6);

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
  };
}

function normalizePieColor(color: string | undefined, index: number) {
  return color && color.startsWith("#")
    ? color
    : PIE_FALLBACK_COLORS[index % PIE_FALLBACK_COLORS.length];
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
  const closureRate =
    closureTotal > 0 ? Math.round((closureClosed / closureTotal) * 100) : null;
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
      tone:
        data.gateFirstPass.ratePct != null && data.gateFirstPass.ratePct < 70
          ? "amber"
          : "green",
    },
    {
      label: "P0/P1 Aging",
      value: avgAge == null ? "—" : `${avgAge}d`,
      sub: `${data.p0p1Aging.openCount} open · >14d ${data.p0p1Aging.over14Days}`,
      tone:
        data.p0p1Aging.over14Days > 0
          ? "red"
          : data.p0p1Aging.openCount > 0
            ? "amber"
            : "green",
    },
    {
      label: "BOM 超目标",
      value: data.bomCostDelta.overTargetCount,
      sub: `${data.bomCostDelta.trackedProjectCount} 个有成本数据`,
      tone: data.bomCostDelta.overTargetCount > 0 ? "amber" : "neutral",
    },
  ];

  return (
    <div className="space-y-[18px]">
      <Panel title="关键决策指标" sub="Decision Signals">
        <div className="grid grid-cols-2 gap-[13px] p-4 lg:grid-cols-4">
          {kpis.map(kpi => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 items-stretch gap-[18px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Panel
          title="验证与问题"
          sub={`总体 ${fmtPct(closureRate)} · ${closureClosed}/${closureTotal}`}
          className="min-h-[310px]"
        >
          <div className="grid h-full grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-1 xl:divide-x-0 xl:divide-y">
            <div className="space-y-3 p-4">
              {closure.map(row => (
                <div key={row.phaseId} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-foreground">
                      {row.phaseId.toUpperCase()}
                    </span>
                    <span className="num text-muted-foreground">
                      {row.closureRatePct == null
                        ? "—"
                        : `${row.closureRatePct}%`}{" "}
                      · {row.closed}/{row.total}
                    </span>
                  </div>
                  <LinearBar
                    value={row.closureRatePct ?? 0}
                    className={
                      row.closureRatePct != null && row.closureRatePct < 80
                        ? "[&>div]:bg-[color:var(--warning)]"
                        : "[&>div]:bg-[color:var(--success)]"
                    }
                  />
                </div>
              ))}
              {closure.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  暂无验证阶段数据。
                </div>
              )}
            </div>
            <div className="bg-secondary/25 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                <ShieldAlert size={13} className="text-primary" />
                P0/P1 老化 Top
              </div>
              <div className="mt-2 divide-y divide-border">
                {data.p0p1Aging.rows.slice(0, 3).map(issue => (
                  <button
                    key={`${issue.projectId}-${issue.title}`}
                    onClick={() => onSelectProject(issue.projectId)}
                    className="w-full py-2 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-foreground">
                        {issue.title}
                      </span>
                      <Tag tone={issue.ageDays > 14 ? "rose" : "amber"}>
                        {issue.ageDays}d
                      </Tag>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {issue.projectName}
                    </div>
                  </button>
                ))}
                {data.p0p1Aging.rows.length === 0 && (
                  <div className="py-2 text-xs text-muted-foreground">
                    暂无开放 P0/P1。
                  </div>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="延期预测" sub="Projected Delay" className="min-h-[310px]">
          {data.delayPrediction.rows.length > 0 ? (
            <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-1 xl:divide-x-0 xl:divide-y">
              {data.delayPrediction.rows.slice(0, 6).map(row => (
                <button
                  key={row.projectId}
                  onClick={() => onSelectProject(row.projectId)}
                  className="px-4 py-3 text-left transition-colors hover:bg-secondary"
                >
                  <div className="flex items-start gap-3">
                    <TrendingDown
                      size={14}
                      className="mt-0.5 text-[color:var(--destructive)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {row.projectName}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        目标 {row.targetDate ?? "—"} · 预测{" "}
                        {row.projectedEnd ?? "未排期"}
                      </div>
                    </div>
                    <Tag tone={(row.slipDays ?? 0) > 7 ? "rose" : "amber"}>
                      {row.slipDays == null ? "红灯" : `晚 ${row.slipDays}d`}
                    </Tag>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-sm text-muted-foreground">
              当前没有预测延期的项目。
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function fmtPct(value: number | null | undefined): string {
  return value == null ? "—" : `${value}%`;
}

function Tag({
  tone,
  children,
}: {
  tone: "rose" | "amber" | "emerald" | "stone";
  children: React.ReactNode;
}) {
  const style: React.CSSProperties =
    tone === "rose"
      ? {
          background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
          color: "var(--destructive)",
          borderColor:
            "color-mix(in srgb, var(--destructive) 30%, transparent)",
        }
      : tone === "amber"
        ? {
            background: "color-mix(in srgb, var(--warning) 12%, transparent)",
            color: "var(--warning)",
            borderColor: "color-mix(in srgb, var(--warning) 30%, transparent)",
          }
        : tone === "emerald"
          ? {
              background: "color-mix(in srgb, var(--success) 12%, transparent)",
              color: "var(--success)",
              borderColor:
                "color-mix(in srgb, var(--success) 30%, transparent)",
            }
          : {
              background: "var(--secondary)",
              color: "var(--secondary-foreground)",
              borderColor: "var(--border)",
            };
  return (
    <span
      className="num whitespace-nowrap rounded-[5px] border px-1.5 py-0.5 text-[10px]"
      style={style}
    >
      {children}
    </span>
  );
}

function SectionLabel({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-baseline gap-2 px-0.5">
      <h2 className="text-[13px] font-semibold tracking-[-0.1px] text-foreground">
        {title}
      </h2>
      <span className="text-[11px] text-muted-foreground">{sub}</span>
    </div>
  );
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
    tone === "green"
      ? "text-[color:var(--success)]"
      : tone === "amber"
        ? "text-[color:var(--warning)]"
        : tone === "red"
          ? "text-[color:var(--destructive)]"
          : tone === "acc"
            ? "text-primary"
            : "text-foreground";
  const inner = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`num mt-[11px] text-[27px] font-bold leading-[0.9] tracking-[-0.5px] ${valueColor}`}
      >
        {value}
      </div>
      <div className="mt-[9px] text-[11px] text-muted-foreground">{sub}</div>
    </>
  );
  if (onClick) {
    return (
      <LinearCard
        hover
        className="cursor-pointer px-4 py-[15px] text-left"
        onClick={onClick}
        role="button"
        tabIndex={0}
      >
        {inner}
      </LinearCard>
    );
  }
  return <LinearCard className="px-4 py-[15px]">{inner}</LinearCard>;
}

// ── Panel shell ────────────────────────────────────────────────────────────────
function Panel({
  title,
  sub,
  cta,
  onCta,
  className,
  bodyClassName,
  children,
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
          {sub && (
            <span className="ml-1.5 text-[12px] font-medium text-muted-foreground">
              {sub}
            </span>
          )}
        </div>
        {cta && (
          <button
            onClick={onCta}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:opacity-80"
          >
            {cta}
          </button>
        )}
      </div>
      <div className={bodyClassName}>{children}</div>
    </LinearCard>
  );
}

function formatMinor(
  currency: string | null | undefined,
  value: number | null | undefined
) {
  if (value == null) return "—";
  return `${currency ?? ""} ${(value / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

function ExpenseVarianceBoard({
  rows,
  onSelectProject,
}: {
  rows: PortfolioTableRow[];
  onSelectProject: (id: string) => void;
}) {
  const expenseRows = rows
    .filter(row => (row.expenseCurrencyCount ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.expenseVarianceMinor ?? Number.NEGATIVE_INFINITY) -
        (a.expenseVarianceMinor ?? Number.NEGATIVE_INFINITY)
    );

  return (
    <Panel title="项目费用偏差" sub="Budget vs Actual">
      {expenseRows.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
          <WalletCards size={15} />
          当前范围暂无已登记的项目费用。
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {expenseRows.map(row => {
            const multiCurrency = (row.expenseCurrencyCount ?? 0) > 1;
            const variance = row.expenseVarianceMinor ?? 0;
            return (
              <button
                key={row.id}
                onClick={() => onSelectProject(row.id)}
                className="flex items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-secondary lg:odd:border-r"
              >
                <WalletCards
                  size={15}
                  className="shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">
                    {row.name}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {multiCurrency
                      ? `${row.expenseCurrencyCount} 个币种 · 请进入项目分币种查看`
                      : `预算 ${formatMinor(row.expenseCurrency, row.expenseBudgetMinor)} · 实际 ${formatMinor(row.expenseCurrency, row.expenseActualMinor)}`}
                  </div>
                </div>
                <span
                  className={`num shrink-0 text-[12px] font-semibold ${
                    multiCurrency
                      ? "text-muted-foreground"
                      : variance > 0
                        ? "text-[color:var(--destructive)]"
                        : "text-[color:var(--success)]"
                  }`}
                >
                  {multiCurrency
                    ? "多币种"
                    : `${variance > 0 ? "+" : ""}${formatMinor(row.expenseCurrency, variance)}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ── 风险预警 ───────────────────────────────────────────────────────────────────
function RiskAlertsBoard({
  rows,
  onSelectProject,
}: {
  rows: ScoredProject[];
  onSelectProject: (id: string) => void;
}) {
  return (
    <Panel title="风险预警" bodyClassName="h-[280px] overflow-y-auto">
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">
          暂无风险项目。
        </div>
      ) : (
        rows.map(({ row, level, reasons }) => {
          const sevLabel =
            row.criticalIssues > 0
              ? `P${level === "red" ? 0 : 1}×${row.criticalIssues}`
              : level === "red"
                ? "高"
                : "中";
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
                    : {
                        background:
                          "color-mix(in srgb, var(--warning) 16%, transparent)",
                        color: "var(--warning)",
                      }
                }
              >
                {sevLabel}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">
                  {row.name}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                  {row.projectNumber || "—"} ·{" "}
                  {resolvePhaseName(row, row.currentPhase)}
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
  rows,
  onSelectProject,
  className,
}: {
  rows: PortfolioTableRow[];
  onSelectProject: (id: string) => void;
  className?: string;
}) {
  return (
    <Panel
      title="组合进度"
      className={className}
      bodyClassName="h-[280px] overflow-y-auto"
    >
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">
          暂无进行中的项目。
        </div>
      ) : (
        rows.map(row => {
          const prog = progressOf(row);
          return (
            <button
              key={row.id}
              onClick={() => onSelectProject(row.id)}
              className="grid w-full grid-cols-[14px_minmax(0,1fr)_auto_120px] items-center gap-3 border-b border-border px-4 py-[11px] text-left transition-colors last:border-b-0 hover:bg-secondary"
            >
              <StatusDot tone={ragTone(row.ragLevel)} />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold">
                  {row.name}
                </div>
                <div className="num truncate text-[10.5px] text-muted-foreground">
                  {row.projectNumber || "—"}
                </div>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-[color:var(--secondary-foreground)]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-primary" />
                {resolvePhaseName(row, row.currentPhase)}
              </span>
              <div className="flex items-center gap-2">
                <LinearBar value={prog} className="flex-1" />
                <span className="num w-[30px] text-right text-[11.5px] font-semibold text-muted-foreground">
                  {prog}%
                </span>
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
  rows,
  onSelectProject,
}: {
  rows: PortfolioTableRow[];
  onSelectProject: (id: string) => void;
}) {
  return (
    <Panel title="即将到来 Gate" bodyClassName="h-[280px] overflow-y-auto">
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">
          近期暂无 Gate 评审。
        </div>
      ) : (
        rows.map(row => {
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
                <div className="num text-[17px] font-bold leading-none">
                  {d ? String(d.getDate()).padStart(2, "0") : "--"}
                </div>
                <div className="mt-0.5 text-[9px] uppercase text-muted-foreground">
                  {d ? MONTH_ABBR[d.getMonth()] : ""}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">
                  {row.name}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {row.gateName || "Gate"}
                  {row.pmName ? ` · ${row.pmName}` : ""}
                </div>
              </div>
              <span
                className="shrink-0 rounded-[5px] px-[7px] py-0.5 text-[10px] font-semibold"
                style={
                  urgent
                    ? {
                        background:
                          "color-mix(in srgb, var(--destructive) 12%, transparent)",
                        color: "var(--destructive)",
                      }
                    : {
                        background:
                          "color-mix(in srgb, var(--warning) 16%, transparent)",
                        color: "var(--warning)",
                      }
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
  phases,
  total,
  className,
}: {
  phases: Array<{
    id: string;
    code: string;
    name: string;
    count: number;
    percent: number;
    barPct: number;
    color: string;
  }>;
  total: number;
  className?: string;
}) {
  return (
    <Panel
      title="阶段分布"
      className={className}
      bodyClassName="h-[280px] overflow-y-auto"
    >
      <div className="flex flex-col gap-[10px] px-4 py-[14px]">
        {phases.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无阶段数据。</div>
        ) : (
          phases.map(phase => (
            <div
              key={phase.id}
              className="grid grid-cols-[auto_minmax(40px,1fr)_24px] items-center gap-[10px]"
            >
              <span className="whitespace-nowrap text-[12px] text-[color:var(--secondary-foreground)]">
                {phase.name}
              </span>
              <div className="h-2 overflow-hidden rounded-[5px] bg-secondary">
                <div
                  className="h-full rounded-[5px] bg-primary"
                  style={{ width: `${phase.barPct}%` }}
                />
              </div>
              <span className="num text-right text-[12px] font-semibold text-muted-foreground">
                {phase.count}
              </span>
            </div>
          ))
        )}
        {phases.length > 0 && (
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
            <span>合计</span>
            <span className="num font-semibold text-foreground">
              {total} 个项目
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}
