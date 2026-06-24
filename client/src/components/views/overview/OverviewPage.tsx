import { useMemo, useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, X } from "lucide-react";
import { Kicker, LinearCard } from "@/components/linear/primitives";
import type { PortfolioTableRow } from "./PortfolioTable";
import { PerspectivePanel, type Lens } from "./PerspectivePanel";
import { PortfolioDashboard } from "./PortfolioDashboard";
import { TaskListView, type TaskRow, type TaskFocus } from "../TaskListView";
import type { TaskStatus, TaskPriority } from "@shared/const";

type DrillTask = {
  id: number; projectId: string; phaseId: string; taskId: string;
  projectName: string; projectNumber: string; projectCategory: string;
  status: string; priority: string | null; dueDate: string | null;
  assigneeUserId: number | null; completed: boolean;
};

export function OverviewPage({ onSelectProject, onSelectView }: { onSelectProject: (id: string, focus?: TaskFocus) => void; onSelectView?: (v: string) => void }) {
  const { user } = useAuth();
  const { data: rows = [], isLoading } = trpc.projects.portfolio.useQuery();
  const portfolio = rows as PortfolioTableRow[];

  const isAdmin = user?.role === "admin";
  const isPM = useMemo(() => portfolio.some((r) => r.pmUserId === user?.id), [portfolio, user?.id]);
  // 视角由角色自动决定：admin → 管理层大盘；PM → PM 工作台；其他 → null（空状态）
  const activeLens: Lens | null = isAdmin ? "exec" : isPM ? "pm" : null;

  const [drill, setDrill] = useState<"overdue" | "blocked" | null>(null);
  const dashboardRows = useMemo(() => (
    activeLens === "pm" ? portfolio.filter((r) => r.pmUserId === user?.id) : portfolio
  ), [activeLens, portfolio, user?.id]);
  const scopeLabel = activeLens === "exec" ? "全部项目组合" : "可见项目组合";
  // pm 按「工作台」渲染；exec 出大盘
  const isWorkbench = activeLens === "pm";
  const pageTitle = activeLens === "pm" ? "我的项目工作台" : "项目总览";
  const pageDesc =
    activeLens === "pm" ? "聚焦我负责的项目：今天要推动什么、待我协调拍板、各项目阶段与健康。" :
    "按项目维度查看健康、阶段、Gate、交付物、发布与延期风险。";

  if (isLoading) {
    return <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 size={16} className="animate-spin" />加载总览…</div>;
  }

  if (activeLens == null) {
    return (
      <div className="mx-auto mt-10 max-w-md text-center">
        <LinearCard className="p-8">
          <p className="text-[15px] font-semibold">总览面向管理层与项目经理</p>
          <p className="mt-2 text-[13px] text-muted-foreground">你的待办、审核与在手任务请在「我的任务」查看。</p>
          <button onClick={() => onSelectView ? onSelectView("mytasks") : (window.location.href = "/?view=mytasks")} className="mt-4 inline-flex h-8 items-center rounded-[7px] bg-primary px-4 text-[13px] font-medium text-white">前往我的任务</button>
        </LinearCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <Kicker>Portfolio Overview</Kicker>
          <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.4px]">{pageTitle}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{pageDesc}</p>
        </div>
      </div>

      {!isWorkbench && (
        <PortfolioDashboard rows={dashboardRows} scopeLabel={scopeLabel} onSelectProject={onSelectProject} onDrill={setDrill} />
      )}


      {/* 「需要处理」行动队列仅在 pm/mine 工作台视角出现；exec 总览只看大盘，不要这一块 */}
      {isWorkbench && (
        <div>
          <PerspectivePanel lens={activeLens} rows={portfolio} onSelectProject={onSelectProject} />
        </div>
      )}

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
