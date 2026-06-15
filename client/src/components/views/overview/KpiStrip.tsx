import type React from "react";
import type { PortfolioTableRow } from "./PortfolioTable";
import { Hash, Activity, AlertTriangle, TrendingUp, CalendarClock, Ban } from "lucide-react";

const isOverdue = (r: PortfolioTableRow) => !!(r.projectedEnd && r.targetDate && r.projectedEnd > r.targetDate);

export function KpiStrip({ rows, onDrill }: { rows: PortfolioTableRow[]; onDrill: (kind: "overdue" | "blocked") => void }) {
  const total = rows.length;
  const active = rows.filter((r) => r.currentPhase !== "mp").length;
  const highRisk = rows.filter((r) => r.risk === "high").length;
  const delayRate = total > 0 ? Math.round((rows.filter(isOverdue).length / total) * 100) : 0;
  const overdueTasks = rows.reduce((s, r) => s + r.overdueTasks, 0);
  const blockedTasks = rows.reduce((s, r) => s + r.blockedTasks, 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Kpi icon={<Hash size={15} />} label="项目总数" value={total} />
      <Kpi icon={<Activity size={15} />} label="进行中" value={active} />
      <Kpi icon={<AlertTriangle size={15} />} label="高风险" value={highRisk} accent={highRisk > 0 ? "text-rose-600" : undefined} />
      <Kpi icon={<TrendingUp size={15} />} label="延期率" value={`${delayRate}%`} accent={delayRate > 0 ? "text-amber-600" : undefined} />
      <Kpi icon={<CalendarClock size={15} />} label="逾期任务" value={overdueTasks} accent={overdueTasks > 0 ? "text-rose-600" : undefined} onClick={() => onDrill("overdue")} />
      <Kpi icon={<Ban size={15} />} label="阻塞任务" value={blockedTasks} accent={blockedTasks > 0 ? "text-amber-600" : undefined} onClick={() => onDrill("blocked")} />
    </div>
  );
}

function Kpi({ icon, label, value, accent, onClick }: { icon: React.ReactNode; label: string; value: number | string; accent?: string; onClick?: () => void }) {
  const clickable = !!onClick;
  return (
    <button type="button" disabled={!clickable} onClick={onClick}
      className={`ce-card p-4 text-left ${clickable ? "cursor-pointer hover:border-stone-300 transition-colors" : "cursor-default"}`}>
      <div className="flex items-center gap-1.5 text-stone-400">{icon}<span className="text-[10px] font-mono uppercase tracking-wider">{label}</span>{clickable && <span className="ml-auto text-[9px] font-mono text-stone-300">下钻›</span>}</div>
      <div className={`mt-1.5 text-2xl font-serif font-semibold ${accent ?? "text-stone-900"}`}>{value}</div>
    </button>
  );
}
