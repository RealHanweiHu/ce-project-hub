// 全部项目表：可排序/筛选/下钻。rows 由父组件传入（源自 projects.portfolio）。
import { useMemo, useState } from "react";
import { HEALTH_CONFIG } from "@/lib/data";
import { CATEGORY_MAP } from "@/lib/sop-templates";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { ChevronRight, ArrowUpDown } from "lucide-react";
import { isProjectedOverdue, type RagLevel } from "@shared/health";
import { resolvePhaseName } from "@shared/sop-template-resolution";

export type PortfolioTableRow = {
  id: string; name: string; projectNumber: string; category: string; risk: string;
  sopTemplateVersion?: string | null;
  customFields?: unknown;
  ragLevel: RagLevel;
  ragReasons: string[];
  customer: string | null;
  currentPhase: string; startDate: string | null; targetDate: string | null; pmUserId: number | null; pmName: string | null;
  /** 当前用户对本项目的有效角色（成员角色 ∪ pm/owner/admin 兜底）；用于总览定视角 */
  myRole?: string | null;
  taskTotal: number; taskDone: number; taskInProgress: number; overdueTasks: number; blockedTasks: number;
  openIssues: number; criticalIssues: number; plannedEnd: string | null; projectedEnd: string | null;
  progressBehindPct: number | null;
  unassignedTasks: number;
  memberGap: number;
  gateTaskTotal: number;
  gateTaskDone: number;
  gatePhaseId: string | null;
  gateName: string | null;
  gateDueDate: string | null;
  gateDone: boolean;
  gateReady: boolean | null;
  gateBlockers: number;
  gateNotReady: "red" | "amber" | null;
  deliverableGap: number;
  releaseDecision: "approved" | "conditional" | "rejected" | null;
  releaseGateName: string | null;
  releaseGateReady: boolean;
  releaseDeliverableDone: number;
  releaseDeliverableTotal: number;
  releaseHardBlockers: number;
  releaseConditions: string | null;
  expenseCurrency?: string | null;
  expenseCurrencyCount?: number;
  expenseBudgetMinor?: number | null;
  expenseActualMinor?: number | null;
  expenseVarianceMinor?: number | null;
};

const progressOf = (r: PortfolioTableRow) => (r.taskTotal > 0 ? Math.round((r.taskDone / r.taskTotal) * 100) : 0);
const isOverdue = (r: PortfolioTableRow) => isProjectedOverdue(r.projectedEnd, r.targetDate);
const HEALTH_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
type SortKey = "name" | "progress" | "risk" | "overdueTasks" | "blockedTasks" | "openIssues" | "projectedEnd" | "expenseVarianceMinor";

function fmtMinor(currency: string | null | undefined, value: number | null | undefined) {
  if (value == null) return "—";
  return `${currency ?? ""} ${(value / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

export function PortfolioTable({ rows, onSelectProject }: { rows: PortfolioTableRow[]; onSelectProject: (id: string) => void }) {
  const [healthFilter, setHealthFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    let r = rows.filter((x) => (!healthFilter || x.risk === healthFilter) && (!catFilter || x.category === catFilter));
    r = [...r].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "progress": cmp = progressOf(a) - progressOf(b); break;
        case "risk": cmp = (HEALTH_ORDER[a.risk] ?? 9) - (HEALTH_ORDER[b.risk] ?? 9); break;
        case "projectedEnd": cmp = (a.projectedEnd ?? "9999").localeCompare(b.projectedEnd ?? "9999"); break;
        default: cmp = ((a[sortKey] as number | null | undefined) ?? 0) - ((b[sortKey] as number | null | undefined) ?? 0);
      }
      return sortAsc ? cmp : -cmp;
    });
    return r;
  }, [rows, healthFilter, catFilter, sortKey, sortAsc]);

  const sortBtn = (key: SortKey, label: string) => (
    <button onClick={() => { sortKey === key ? setSortAsc(!sortAsc) : (setSortKey(key), setSortAsc(true)); }}
      className={`flex items-center gap-1 hover:text-foreground ${sortKey === key ? "text-foreground" : ""}`}>
      {label}<ArrowUpDown size={10} className="opacity-50" />
    </button>
  );

  return (
    <div className="rounded-[11px] border border-border bg-card p-0">
      <div className="flex flex-wrap items-center gap-2 text-xs p-3 border-b border-border">
        <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} className="rounded-[7px] border border-border bg-card px-2 py-1.5">
          <option value="">全部健康</option><option value="high">红灯</option><option value="medium">黄灯</option><option value="low">绿灯</option>
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-[7px] border border-border bg-card px-2 py-1.5">
          <option value="">全部类型</option><option value="npd">新产品开发</option><option value="eco">工程变更</option><option value="derivative">产品迭代/衍生开发</option><option value="idr">外观翻新</option>
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1040px]">
          <thead>
            <tr className="border-b border-border bg-secondary text-[10px] num uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-3 py-2.5">{sortBtn("name", "项目")}</th>
              <th className="text-left px-3 py-2.5">类型</th>
              <th className="text-left px-3 py-2.5">当前阶段</th>
              <th className="text-left px-3 py-2.5 w-40">{sortBtn("progress", "进度")}</th>
              <th className="text-center px-3 py-2.5">{sortBtn("risk", "健康")}</th>
              <th className="text-center px-3 py-2.5">{sortBtn("overdueTasks", "逾期")}</th>
              <th className="text-center px-3 py-2.5">{sortBtn("blockedTasks", "阻塞")}</th>
              <th className="text-center px-3 py-2.5">{sortBtn("openIssues", "开放问题")}</th>
              <th className="text-left px-3 py-2.5">{sortBtn("expenseVarianceMinor", "预算偏差")}</th>
              <th className="text-left px-3 py-2.5">{sortBtn("projectedEnd", "预计完成")}</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const cat = CATEGORY_MAP[r.category as keyof typeof CATEGORY_MAP];
              const health = HEALTH_CONFIG[r.risk as keyof typeof HEALTH_CONFIG];
              const prog = progressOf(r);
              const overdue = isOverdue(r);
              return (
                <tr key={r.id} onClick={() => onSelectProject(r.id)} className="border-b border-border hover:bg-secondary cursor-pointer">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-foreground">{r.name}</div>
                    <div className="text-[10px] num text-muted-foreground">{r.projectNumber || "—"}{r.pmName ? ` · PM ${r.pmName}` : ""}</div>
                  </td>
                  <td className="px-3 py-2.5">{cat ? <span className={`text-[10px] num px-1.5 py-0.5 border ${cat.borderColor} ${cat.color} ${cat.textColor}`}>{cat.badge}</span> : r.category}</td>
                  <td className="px-3 py-2.5 text-xs text-[color:var(--secondary-foreground)]">{resolvePhaseName(r, r.currentPhase)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2"><div className="flex-1 min-w-[60px]"><ProgressBar value={prog} color="bg-primary" height="h-1.5" /></div><span className="text-[11px] num text-muted-foreground">{prog}%</span></div>
                    <div className="text-[10px] num text-muted-foreground">{r.taskDone}/{r.taskTotal}</div>
                  </td>
                  <td className="px-3 py-2.5 text-center"><span className={`text-xs font-medium ${health?.color}`}>{health?.label ?? r.risk}</span></td>
                  <td className="px-3 py-2.5 text-center"><Cell n={r.overdueTasks} tone="rose" /></td>
                  <td className="px-3 py-2.5 text-center"><Cell n={r.blockedTasks} tone="amber" /></td>
                  <td className="px-3 py-2.5 text-center"><Cell n={r.openIssues} tone="rose" /></td>
                  <td className="px-3 py-2.5 text-xs num">
                    {(r.expenseCurrencyCount ?? 0) > 1 ? (
                      <span className="text-[color:var(--warning)]">多币种</span>
                    ) : (r.expenseCurrencyCount ?? 0) === 1 ? (
                      <div>
                        <span className={(r.expenseVarianceMinor ?? 0) > 0 ? "text-[color:var(--destructive)]" : "text-[color:var(--success)]"}>
                          {(r.expenseVarianceMinor ?? 0) > 0 ? "+" : ""}{fmtMinor(r.expenseCurrency, r.expenseVarianceMinor)}
                        </span>
                        <span className="block text-[9px] text-muted-foreground">实际 {fmtMinor(r.expenseCurrency, r.expenseActualMinor)} / 预算 {fmtMinor(r.expenseCurrency, r.expenseBudgetMinor)}</span>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs num">
                    <span className={overdue ? "text-[color:var(--destructive)]" : "text-[color:var(--secondary-foreground)]"}>{r.projectedEnd || "未排期"}</span>
                    {overdue && <span className="block text-[9px] text-[color:var(--destructive)]">超目标 {r.targetDate}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight size={14} /></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={11} className="px-3 py-10 text-center text-muted-foreground text-sm">暂无项目</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ n, tone }: { n: number; tone: "rose" | "amber" }) {
  if (!n) return <span className="text-muted-foreground">—</span>;
  const cls = tone === "rose" ? "bg-[color:var(--destructive)]/10 text-[color:var(--destructive)] border-[color:var(--destructive)]/30" : "bg-[color:var(--warning)]/10 text-[color:var(--warning)] border-[color:var(--warning)]/30";
  return <span className={`text-[11px] num px-1.5 py-0.5 border ${cls}`}>{n}</span>;
}
