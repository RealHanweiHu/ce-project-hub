import type React from "react";
import type { PortfolioTableRow } from "./PortfolioTable";
import { Hash, Activity, AlertTriangle, TrendingUp, CalendarClock, Ban } from "lucide-react";
import { isProjectedOverdue } from "@shared/health";

const isOverdue = (r: PortfolioTableRow) => isProjectedOverdue(r.projectedEnd, r.targetDate);

export function KpiStrip({ rows, onDrill }: { rows: PortfolioTableRow[]; onDrill: (kind: "overdue" | "blocked") => void }) {
  const total = rows.length;
  const active = rows.filter((r) => r.currentPhase !== "mp").length;
  const redHealth = rows.filter((r) => r.ragLevel === "red").length;
  const delayRate = total > 0 ? Math.round((rows.filter(isOverdue).length / total) * 100) : 0;
  const overdueTasks = rows.reduce((s, r) => s + r.overdueTasks, 0);
  const blockedTasks = rows.reduce((s, r) => s + r.blockedTasks, 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Kpi icon={<Hash size={15} />} label="项目总数" value={total} />
      <Kpi icon={<Activity size={15} />} label="进行中" value={active} />
      <Kpi icon={<AlertTriangle size={15} />} label="红灯项目" value={redHealth} accent={redHealth > 0 ? "text-[color:var(--destructive)]" : undefined} />
      <Kpi icon={<TrendingUp size={15} />} label="延期率" value={`${delayRate}%`} accent={delayRate > 0 ? "text-[color:var(--warning)]" : undefined} />
      <Kpi icon={<CalendarClock size={15} />} label="逾期任务" value={overdueTasks} accent={overdueTasks > 0 ? "text-[color:var(--destructive)]" : undefined} onClick={() => onDrill("overdue")} />
      <Kpi icon={<Ban size={15} />} label="阻塞任务" value={blockedTasks} accent={blockedTasks > 0 ? "text-[color:var(--warning)]" : undefined} onClick={() => onDrill("blocked")} />
    </div>
  );
}

function Kpi({ icon, label, value, accent, onClick }: { icon: React.ReactNode; label: string; value: number | string; accent?: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span>{onClick && <span className="ml-auto text-[9px] text-muted-foreground">下钻›</span>}</div>
      <div className={`mt-1.5 text-2xl font-semibold num ${accent ?? "text-foreground"}`}>{value}</div>
    </>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} className="rounded-[10px] border border-border bg-card p-4 text-left cursor-pointer hover:border-[color:var(--acc-border)] transition-colors">{inner}</button>;
  }
  return <div className="rounded-[10px] border border-border bg-card p-4">{inner}</div>;
}
