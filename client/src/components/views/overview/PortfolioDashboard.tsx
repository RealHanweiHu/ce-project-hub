// Linear redesign — 总览 / Overview dashboard (exec scope).
// Phase 1: VISUAL ONLY. The data model (buildDashboard) and all derived metrics are
// preserved verbatim; only the presentation/layout was reworked to the Linear design:
// greeting subline + 6 KPI cards + 今日聚焦 row + two equal-height columns
// (风险预警 / 组合进度 on the left, 即将 Gate / 阶段分布 on the right).
import type React from "react";
import { useMemo } from "react";
import { AlertTriangle, CalendarClock, Gauge } from "lucide-react";
import { getPhasesForCategory } from "@/lib/sop-templates";
import { PHASE_MAP } from "@/lib/data";
import { isProjectedOverdue, type RagLevel } from "@shared/health";
import { LinearCard, LinearBar, StatusDot } from "@/components/linear/primitives";
import type { PortfolioTableRow } from "./PortfolioTable";

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

      {/* Two equal-height columns */}
      <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-[18px]">
          <RiskAlertsBoard rows={data.riskAlerts} onSelectProject={onSelectProject} />
          <ProgressBoard rows={data.progressRows} onSelectProject={onSelectProject} className="flex-1" />
        </div>
        <div className="flex flex-col gap-[18px]">
          <GatesBoard rows={data.gateRows} onSelectProject={onSelectProject} />
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
  title, sub, cta, onCta, className, children,
}: {
  title: string;
  sub?: string;
  cta?: string;
  onCta?: () => void;
  className?: string;
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
      {children}
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
    <Panel title="风险预警">
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
    <Panel title="组合进度" className={className}>
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">暂无进行中的项目。</div>
      ) : (
        rows.map((row) => {
          const prog = progressOf(row);
          return (
            <button
              key={row.id}
              onClick={() => onSelectProject(row.id)}
              className="grid w-full grid-cols-[14px_1fr_88px_120px] items-center gap-3 border-b border-border px-4 py-[11px] text-left transition-colors last:border-b-0 hover:bg-secondary"
            >
              <StatusDot tone={ragTone(row.ragLevel)} />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold">{row.name}</div>
                <div className="num truncate text-[10.5px] text-muted-foreground">{row.projectNumber || "—"}</div>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-[color:var(--secondary-foreground)]">
                <span className="h-1.5 w-1.5 rounded-[2px] bg-primary" />
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
    <Panel title="即将到来 Gate">
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
    <Panel title="阶段分布" className={className}>
      <div className="flex flex-col gap-[10px] px-4 py-[14px]">
        {phases.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无阶段数据。</div>
        ) : (
          phases.map((phase) => (
            <div key={phase.id} className="grid grid-cols-[52px_1fr_20px] items-center gap-[10px]">
              <span className="truncate text-[12px] text-[color:var(--secondary-foreground)]">{phase.name}</span>
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
