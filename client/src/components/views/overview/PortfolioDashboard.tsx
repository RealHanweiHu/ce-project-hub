import type React from "react";
import { useMemo } from "react";
import {
  Activity, AlertTriangle, CalendarClock, CheckCircle2, ChevronRight,
  ClipboardCheck, Flag, Gauge, Layers3, Rocket, UserRound,
} from "lucide-react";
import { getPhasesForCategory } from "@/lib/sop-templates";
import { isProjectedOverdue, type RagLevel } from "@shared/health";
import type { PortfolioTableRow } from "./PortfolioTable";

type DrillKind = "overdue" | "blocked";

type ScoredProject = {
  row: PortfolioTableRow;
  level: RagLevel;
  reasons: string[];
};

const HEALTH_LABEL: Record<RagLevel, string> = { green: "绿灯", amber: "黄灯", red: "红灯" };
const HEALTH_COLOR: Record<RagLevel, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};
const HEALTH_TEXT: Record<RagLevel, string> = {
  green: "text-emerald-700",
  amber: "text-amber-700",
  red: "text-rose-700",
};

const PIE_FALLBACK_COLORS = ["#1f2937", "#0369a1", "#0f766e", "#a16207", "#7c3aed", "#b45309", "#166534", "#be123c"];

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
      <div className="ce-panel p-5">
        <div className="flex items-center gap-2 text-sm text-stone-400">
          <Gauge size={16} />
          当前范围暂无项目数据。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="ce-panel overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 divide-x divide-y divide-stone-100">
          <MetricCell icon={<Layers3 size={15} />} label="项目总数" value={data.total} detail={scopeLabel} />
          <MetricCell icon={<Activity size={15} />} label="进行中项目" value={data.activeProjects} detail={`${ratio(data.activeProjects, data.total)}% 处于推进中`} />
          <MetricCell icon={<Flag size={15} />} label="未开始项目" value={data.notStartedProjects} detail={`${ratio(data.notStartedProjects, data.total)}% 尚未进入执行`} />
          <MetricCell icon={<UserRound size={15} />} label="项目来源" value={data.primarySource.label} detail={data.sourceSummary} />
          <MetricCell icon={<ClipboardCheck size={15} />} label="Gate 总数" value={data.gateTaskTotal} detail="负责项目里程碑任务数" />
          <MetricCell icon={<CheckCircle2 size={15} />} label="已结束 Gate" value={data.gateTaskDone} detail={`${ratio(data.gateTaskDone, data.gateTaskTotal)}% 已完成`} tone={data.gateTaskDone === data.gateTaskTotal ? "ok" : "neutral"} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
        <HealthBoard data={data} />
        <PhaseBoard phases={data.phaseRows} total={data.total} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <GateBoard rows={data.gateRows} total={data.total} onSelectProject={onSelectProject} />
        <DeliveryBoard rows={data.deliveryRows} total={data.total} onSelectProject={onSelectProject} onDrill={onDrill} />
        <ReleaseBoard rows={data.releaseRows} total={data.total} onSelectProject={onSelectProject} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-4">
        <OwnerBoard rows={data.ownerRows} total={data.total} />
        <AttentionBoard rows={data.attentionRows} onSelectProject={onSelectProject} />
      </div>
    </div>
  );
}

function buildDashboard(rows: PortfolioTableRow[]) {
  const scored = rows.map(scoreProject);
  const total = rows.length;
  const health = { green: 0, amber: 0, red: 0 } as Record<RagLevel, number>;
  for (const item of scored) health[item.level] += 1;

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
  const phaseRows = Array.from(phaseMap.values())
    .map((phase) => ({ ...phase, percent: ratio(phase.count, total) }))
    .sort((a, b) => a.order - b.order || b.count - a.count);

  const gateRows = rows
    .filter((row) => !row.gateDone && (row.gateBlockers > 0 || row.deliverableGap > 0 || !!row.gateDueDate))
    .sort((a, b) => (b.gateBlockers + b.deliverableGap) - (a.gateBlockers + a.deliverableGap))
    .slice(0, 6);

  const deliveryRows = rows
    .filter((row) => row.overdueTasks > 0 || row.blockedTasks > 0 || row.criticalIssues > 0 || isProjectedOverdue(row.projectedEnd, row.targetDate))
    .sort((a, b) =>
      (b.overdueTasks * 3 + b.blockedTasks * 2 + b.criticalIssues * 4) -
      (a.overdueTasks * 3 + a.blockedTasks * 2 + a.criticalIssues * 4)
    )
    .slice(0, 6);

  const releaseRows = rows
    .filter((row) => row.releaseHardBlockers > 0 || row.releaseDecision === "conditional" || row.releaseGateReady)
    .sort((a, b) => b.releaseHardBlockers - a.releaseHardBlockers)
    .slice(0, 6);

  const ownerMap = new Map<string, number>();
  for (const row of rows) {
    const key = row.pmName || "未指定 PM";
    ownerMap.set(key, (ownerMap.get(key) ?? 0) + 1);
  }
  const ownerRows = Array.from(ownerMap.entries())
    .map(([name, count]) => ({ name, count, percent: ratio(count, total) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const sourceMap = new Map<string, number>();
  for (const row of rows) {
    const label = projectSourceLabel(row);
    sourceMap.set(label, (sourceMap.get(label) ?? 0) + 1);
  }
  const sourceRows = Array.from(sourceMap.entries())
    .map(([label, count]) => ({ label, count, percent: ratio(count, total) }))
    .sort((a, b) => b.count - a.count);
  const primarySource = sourceRows[0] ?? { label: "暂无来源", count: 0, percent: 0 };
  const sourceSummary = sourceRows.length
    ? sourceRows.slice(0, 3).map((row) => `${row.label} ${row.count}`).join(" / ")
    : "暂无来源词条";

  const attentionRows = scored
    .filter((item) => item.level !== "green" || item.row.gateBlockers > 0 || item.row.releaseHardBlockers > 0)
    .sort((a, b) => {
      const rank = (level: RagLevel) => level === "red" ? 0 : level === "amber" ? 1 : 2;
      return rank(a.level) - rank(b.level);
    })
    .slice(0, 8);

  return {
    total,
    activeProjects: rows.filter(projectIsActive).length,
    notStartedProjects: rows.filter(projectIsNotStarted).length,
    primarySource,
    sourceSummary,
    gateTaskTotal: rows.reduce((sum, row) => sum + row.gateTaskTotal, 0),
    gateTaskDone: rows.reduce((sum, row) => sum + row.gateTaskDone, 0),
    health,
    scored,
    phaseRows,
    gateRows,
    deliveryRows,
    releaseRows,
    ownerRows,
    attentionRows,
  };
}

function normalizePieColor(color: string | undefined, index: number) {
  return color && color.startsWith("#") ? color : PIE_FALLBACK_COLORS[index % PIE_FALLBACK_COLORS.length];
}

function projectSourceLabel(row: PortfolioTableRow) {
  if (row.customer?.trim()) return "客户/渠道";
  if (row.category === "eco") return "ECO 变更";
  if (row.category === "idr") return "ID/外观输入";
  return "内部立项";
}

function MetricCell({
  icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  detail: string;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const toneClass =
    tone === "ok" ? "text-emerald-700" :
    tone === "warn" ? "text-amber-700" :
    tone === "bad" ? "text-rose-700" :
    "text-stone-900";
  return (
    <div className="min-h-[112px] p-4 bg-white">
      <div className="flex items-center gap-1.5 text-stone-400">
        {icon}
        <span className="text-[10px] font-mono uppercase tracking-wider">{label}</span>
      </div>
      <div className={`mt-2 truncate font-serif font-semibold leading-none ${typeof value === "number" ? "text-3xl" : "text-xl"} ${toneClass}`}>{value}</div>
      <div className="mt-2 text-[11px] text-stone-500 truncate">{detail}</div>
    </div>
  );
}

function HealthBoard({
  data,
}: {
  data: ReturnType<typeof buildDashboard>;
}) {
  const total = data.total;
  return (
    <Panel title="项目健康度分布" icon={<Gauge size={15} />}>
      <div className="space-y-3">
        {(["red", "amber", "green"] as RagLevel[]).map((level) => (
          <div key={level}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className={`font-medium ${HEALTH_TEXT[level]}`}>{HEALTH_LABEL[level]}</span>
              <span className="font-mono text-stone-400">{data.health[level]} 项 · {ratio(data.health[level], total)}%</span>
            </div>
            <div className="h-2 bg-stone-100">
              <div className={`h-2 ${HEALTH_COLOR[level]}`} style={{ width: `${ratio(data.health[level], total)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PhaseBoard({
  phases,
  total,
}: {
  phases: Array<{ id: string; code: string; name: string; count: number; percent: number; color: string }>;
  total: number;
}) {
  const gradient = buildPieGradient(phases);
  return (
    <Panel title="阶段分布" icon={<Layers3 size={15} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[176px_1fr] sm:items-center">
        <div className="relative mx-auto h-40 w-40 shrink-0 rounded-full" style={{ background: gradient }}>
          <div className="absolute inset-8 rounded-full bg-white shadow-inner" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-3xl font-serif font-semibold text-stone-900">{total}</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400">projects</div>
          </div>
        </div>
        <div className="space-y-2">
          {phases.map((phase) => (
            <div key={phase.id} className="grid grid-cols-[12px_58px_1fr_48px] items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: phase.color }} />
              <div className="text-xs font-semibold text-stone-800">{phase.code}</div>
              <div className="min-w-0">
                <div className="truncate text-xs text-stone-600">{phase.name}</div>
              </div>
              <div className="text-right text-[11px] font-mono text-stone-400">{phase.count} · {phase.percent}%</div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function buildPieGradient(phases: Array<{ percent: number; color: string }>) {
  if (phases.length === 0) return "#e7e5e4";
  let cursor = 0;
  return `conic-gradient(${phases.map((phase, index) => {
    const start = cursor;
    const end = index === phases.length - 1 ? 100 : Math.min(100, cursor + phase.percent);
    cursor = end;
    return `${phase.color} ${start}% ${end}%`;
  }).join(", ")})`;
}

function GateBoard({
  rows,
  total,
  onSelectProject,
}: {
  rows: PortfolioTableRow[];
  total: number;
  onSelectProject: (id: string) => void;
}) {
  return (
    <Panel title="Gate 与交付物" icon={<Flag size={15} />}>
      <BoardSummary value={rows.length} label={`项目需补齐 · ${ratio(rows.length, total)}%`} tone={rows.length ? "warn" : "ok"} />
      <ProjectRows
        rows={rows}
        empty="Gate 材料暂无明显缺口"
        onSelectProject={onSelectProject}
        renderTags={(row) => (
          <>
            {row.gateBlockers > 0 && <Tag tone="amber">缺口 {row.gateBlockers}</Tag>}
            {row.deliverableGap > 0 && <Tag tone="amber">交付物 {row.deliverableGap}</Tag>}
          </>
        )}
        renderDetail={(row) => row.gateName || "Gate 待确认"}
      />
    </Panel>
  );
}

function DeliveryBoard({
  rows,
  total,
  onSelectProject,
  onDrill,
}: {
  rows: PortfolioTableRow[];
  total: number;
  onSelectProject: (id: string) => void;
  onDrill: (kind: DrillKind) => void;
}) {
  return (
    <Panel title="延期与阻塞" icon={<CalendarClock size={15} />}>
      <BoardSummary value={rows.length} label={`项目有交付风险 · ${ratio(rows.length, total)}%`} tone={rows.length ? "bad" : "ok"} />
      <div className="mb-2 flex gap-2">
        <button type="button" onClick={() => onDrill("overdue")} className="ce-control flex-1 border border-stone-200 px-2 py-1.5 text-[11px] text-stone-600 hover:border-stone-400">
          逾期任务
        </button>
        <button type="button" onClick={() => onDrill("blocked")} className="ce-control flex-1 border border-stone-200 px-2 py-1.5 text-[11px] text-stone-600 hover:border-stone-400">
          阻塞任务
        </button>
      </div>
      <ProjectRows
        rows={rows}
        empty="暂无延期或阻塞项目"
        onSelectProject={onSelectProject}
        renderTags={(row) => (
          <>
            {row.overdueTasks > 0 && <Tag tone="rose">逾期 {row.overdueTasks}</Tag>}
            {row.blockedTasks > 0 && <Tag tone="amber">阻塞 {row.blockedTasks}</Tag>}
            {row.criticalIssues > 0 && <Tag tone="rose">P0/P1 {row.criticalIssues}</Tag>}
          </>
        )}
        renderDetail={(row) => row.projectedEnd ? `预计完成 ${row.projectedEnd}` : "尚未形成完整排期"}
      />
    </Panel>
  );
}

function ReleaseBoard({
  rows,
  total,
  onSelectProject,
}: {
  rows: PortfolioTableRow[];
  total: number;
  onSelectProject: (id: string) => void;
}) {
  const blocked = rows.filter((row) => row.releaseHardBlockers > 0).length;
  return (
    <Panel title="发布准备" icon={<Rocket size={15} />}>
      <BoardSummary value={blocked} label={`项目存在硬卡 · ${ratio(blocked, total)}%`} tone={blocked ? "bad" : "ok"} />
      <ProjectRows
        rows={rows}
        empty="暂无发布阻断项目"
        onSelectProject={onSelectProject}
        renderTags={(row) => (
          <>
            {row.releaseHardBlockers > 0 ? <Tag tone="rose">硬卡 {row.releaseHardBlockers}</Tag> : <Tag tone="emerald">可推进</Tag>}
            {row.releaseDecision === "conditional" && <Tag tone="amber">有条件</Tag>}
          </>
        )}
        renderDetail={(row) => row.releaseGateName || "发布 Gate 未配置"}
      />
    </Panel>
  );
}

function OwnerBoard({ rows, total }: { rows: Array<{ name: string; count: number; percent: number }>; total: number }) {
  return (
    <Panel title="PM 负责分布" icon={<UserRound size={15} />}>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.name} className="grid grid-cols-[112px_1fr_42px] items-center gap-3">
            <div className="truncate text-xs text-stone-700">{row.name}</div>
            <div className="h-2 bg-stone-100">
              <div className="h-2 bg-sky-600" style={{ width: `${Math.max(row.percent, row.count > 0 ? 6 : 0)}%` }} />
            </div>
            <div className="text-right text-[11px] font-mono text-stone-400">{row.count}/{total}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AttentionBoard({
  rows,
  onSelectProject,
}: {
  rows: ScoredProject[];
  onSelectProject: (id: string) => void;
}) {
  return (
    <Panel title="需关注项目" icon={<AlertTriangle size={15} />}>
      <div className="divide-y divide-stone-100">
        {rows.length === 0 && <div className="py-2 text-sm text-stone-400">暂无需要重点关注的项目。</div>}
        {rows.map(({ row, level, reasons }) => (
          <button key={row.id} onClick={() => onSelectProject(row.id)} className="w-full py-2.5 text-left hover:bg-stone-50/70 -mx-2 px-2">
            <div className="flex items-center gap-3">
              <span className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_COLOR[level]}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-stone-800">{row.name}</div>
                <div className="truncate text-[10px] font-mono text-stone-400">{reasons.length ? reasons.join(" / ") : "项目需关注"}</div>
              </div>
              {row.pmName && <Tag tone="stone">PM {row.pmName}</Tag>}
              <ChevronRight size={13} className="text-stone-300" />
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function BoardSummary({ value, label, tone }: { value: number; label: string; tone: "ok" | "warn" | "bad" }) {
  const cls = tone === "ok" ? "text-emerald-700 bg-emerald-50" : tone === "warn" ? "text-amber-700 bg-amber-50" : "text-rose-700 bg-rose-50";
  return (
    <div className={`mb-3 flex items-end justify-between px-3 py-2 ${cls}`}>
      <div className="text-2xl font-serif font-semibold leading-none">{value}</div>
      <div className="text-[11px]">{label}</div>
    </div>
  );
}

function ProjectRows({
  rows,
  empty,
  onSelectProject,
  renderTags,
  renderDetail,
}: {
  rows: PortfolioTableRow[];
  empty: string;
  onSelectProject: (id: string) => void;
  renderTags: (row: PortfolioTableRow) => React.ReactNode;
  renderDetail: (row: PortfolioTableRow) => React.ReactNode;
}) {
  if (rows.length === 0) return <div className="py-2 text-sm text-stone-400">{empty}</div>;
  return (
    <div className="divide-y divide-stone-100">
      {rows.map((row) => (
        <button key={row.id} type="button" onClick={() => onSelectProject(row.id)} className="w-full py-2 text-left hover:bg-stone-50/70 -mx-2 px-2">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-stone-800">{row.name}</div>
              <div className="truncate text-[11px] text-stone-500">{renderDetail(row)}</div>
            </div>
            <div className="flex max-w-[150px] shrink-0 flex-wrap justify-end gap-1">{renderTags(row)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="ce-panel p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-stone-400">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function Tag({ tone, children }: { tone: "rose" | "amber" | "emerald" | "stone"; children: React.ReactNode }) {
  const cls =
    tone === "rose" ? "bg-rose-50 text-rose-700 border-rose-200" :
    tone === "amber" ? "bg-amber-50 text-amber-700 border-amber-200" :
    tone === "emerald" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    "bg-stone-50 text-stone-600 border-stone-200";
  return <span className={`whitespace-nowrap border px-1.5 py-0.5 text-[10px] font-mono ${cls}`}>{children}</span>;
}
