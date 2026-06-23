import { useMemo, useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, X } from "lucide-react";
import { Kicker } from "@/components/linear/primitives";
import type { PortfolioTableRow } from "./PortfolioTable";
import { PerspectivePanel, type Lens } from "./PerspectivePanel";
import { PortfolioDashboard } from "./PortfolioDashboard";
import { PortfolioMetricsTable } from "./PortfolioMetricsTable";
import { TaskListView, type TaskRow, type TaskFocus } from "../TaskListView";
import type { TaskStatus, TaskPriority } from "@shared/const";

const LENS_LABEL: Record<Lens, string> = { exec: "管理层", pm: "PM", mine: "我的" };

type DrillTask = {
  id: number; projectId: string; phaseId: string; taskId: string;
  projectName: string; projectNumber: string; projectCategory: string;
  status: string; priority: string | null; dueDate: string | null;
  assigneeUserId: number | null; completed: boolean;
};

export function OverviewPage({ onSelectProject }: { onSelectProject: (id: string, focus?: TaskFocus) => void }) {
  const { user } = useAuth();
  const { data: rows = [], isLoading } = trpc.projects.portfolio.useQuery();
  const portfolio = rows as PortfolioTableRow[];

  // 按身份授权可用视角：管理者(admin)→管理层；项目负责人→PM；所有人→我的。
  // 普通用户(非 admin、非任何项目 PM)只有「我的」，不出现视角切换。
  const isAdmin = user?.role === "admin";
  const isPM = useMemo(() => portfolio.some((r) => r.pmUserId === user?.id), [portfolio, user?.id]);
  const allowedLenses = useMemo<Lens[]>(() => {
    const list: Lens[] = [];
    if (isAdmin) list.push("exec");
    if (isPM) list.push("pm");
    list.push("mine");
    return list;
  }, [isAdmin, isPM]);
  const [lens, setLens] = useState<Lens | null>(null);
  // 默认=授权列表首项；手动选择须仍在授权范围内，否则回落默认（防越权/陈旧选择）。
  const activeLens: Lens = lens && allowedLenses.includes(lens) ? lens : allowedLenses[0];

  const [drill, setDrill] = useState<"overdue" | "blocked" | null>(null);
  const dashboardRows = useMemo(() => (
    activeLens === "pm" ? portfolio.filter((r) => r.pmUserId === user?.id) : portfolio
  ), [activeLens, portfolio, user?.id]);
  const scopeLabel = activeLens === "exec" ? "全部项目组合" : "可见项目组合";
  // pm/mine 都按「工作台」渲染（行动导向，不出组合层大盘）；仅 exec 出大盘。
  const isWorkbench = activeLens === "mine" || activeLens === "pm";
  const pageTitle = activeLens === "mine" ? "我的工作台" : activeLens === "pm" ? "我的项目工作台" : "项目总览";
  const pageDesc =
    activeLens === "mine" ? "只聚合与你有关的待办、审核、质量复测和在手任务。" :
    activeLens === "pm" ? "聚焦我负责的项目：今天要推动什么、待我协调拍板、各项目阶段与健康。" :
    "按项目维度查看健康、阶段、Gate、交付物、发布与延期风险。";

  if (isLoading) {
    return <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 size={16} className="animate-spin" />加载总览…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <Kicker>Portfolio Overview</Kicker>
          <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.4px]">{pageTitle}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{pageDesc}</p>
        </div>
        {allowedLenses.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">以</span>
            <select value={activeLens} onChange={(e) => setLens(e.target.value as Lens)}
              className="rounded-[7px] border border-border bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]">
              {allowedLenses.map((l) => <option key={l} value={l}>{LENS_LABEL[l]}视角</option>)}
            </select>
            <span className="text-[11px] text-muted-foreground">查看</span>
          </div>
        )}
      </div>

      {!isWorkbench && (
        <PortfolioDashboard rows={dashboardRows} scopeLabel={scopeLabel} onSelectProject={onSelectProject} onDrill={setDrill} />
      )}

      {activeLens === "exec" && <PortfolioMetricsTable />}

      {!isWorkbench && (
        <div className="flex items-center justify-between pt-1">
          <Kicker>需要处理</Kicker>
          <span className="text-[11px] text-muted-foreground">{LENS_LABEL[activeLens]}视角</span>
        </div>
      )}
      <div>
        <PerspectivePanel lens={activeLens} rows={portfolio} onSelectProject={onSelectProject} />
      </div>

      {drill && <DrillDown kind={drill} onClose={() => setDrill(null)} onSelectProject={onSelectProject} />}
    </div>
  );
}

function DrillDown({ kind, onClose, onSelectProject }: { kind: "overdue" | "blocked"; onClose: () => void; onSelectProject: (id: string, focus?: TaskFocus) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const overdueQ = trpc.tasks.overdue.useQuery(undefined, { enabled: kind === "overdue" });
  const blockedQ = trpc.tasks.blocked.useQuery(undefined, { enabled: kind === "blocked" });
  const q = kind === "overdue" ? overdueQ : blockedQ;
  const tasks = (q.data ?? []) as DrillTask[];
  const rows: TaskRow[] = tasks.map((t) => ({
    id: t.id, projectId: t.projectId, phaseId: t.phaseId, taskId: t.taskId,
    projectName: t.projectName, projectNumber: t.projectNumber, projectCategory: t.projectCategory,
    status: t.status as TaskStatus, priority: (t.priority ?? "medium") as TaskPriority,
    dueDate: t.dueDate ? String(t.dueDate) : null, assigneeUserId: t.assigneeUserId ?? null, completed: t.completed,
  }));
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-foreground/40" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-auto bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold tracking-[-0.3px]">{kind === "overdue" ? "逾期任务" : "阻塞任务"}</h3>
          <button onClick={onClose} aria-label="关闭" className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <div className="overflow-hidden rounded-[10px] border border-border">
          <TaskListView tasks={rows} isLoading={q.isLoading}
            emptyIcon={null} emptyTitle={kind === "overdue" ? "无逾期任务" : "无阻塞任务"} emptyDesc=""
            onRefetch={() => q.refetch()} onNavigateToProject={(id, focus) => { onSelectProject(id, focus); onClose(); }} showOverdueBadge />
        </div>
      </div>
    </div>
  );
}
