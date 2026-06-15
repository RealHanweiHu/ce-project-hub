// 千人千面面板：exec/pm/mine 三视角，视角由父组件控制。portfolio rows 由父传入。
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { RISK_CONFIG, PHASE_MAP } from "@/lib/data";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { TaskListView, type TaskRow } from "../TaskListView";
import type { TaskStatus, TaskPriority } from "@shared/const";
import { isProjectedOverdue } from "@shared/health";
import { Bug, Ban, CalendarClock, ChevronRight, CheckCircle2 } from "lucide-react";
import type { PortfolioTableRow } from "./PortfolioTable";

export type Lens = "exec" | "pm" | "mine";
const prog = (r: PortfolioTableRow) => (r.taskTotal > 0 ? Math.round((r.taskDone / r.taskTotal) * 100) : 0);
const overdue = (r: PortfolioTableRow) => isProjectedOverdue(r.projectedEnd, r.targetDate);

export function PerspectivePanel({ lens, rows, onSelectProject }: { lens: Lens; rows: PortfolioTableRow[]; onSelectProject: (id: string) => void }) {
  const { user } = useAuth();
  const { data: myTasks = [], isLoading: myLoading, refetch: refetchMine } = trpc.tasks.myTasks.useQuery();

  const exec = useMemo(() => {
    const total = rows.length || 1;
    const od = rows.filter(overdue).length;
    const risk = { high: rows.filter((r) => r.risk === "high").length, medium: rows.filter((r) => r.risk === "medium").length, low: rows.filter((r) => r.risk === "low").length };
    const byPhase = new Map<string, number>();
    for (const r of rows) byPhase.set(r.currentPhase, (byPhase.get(r.currentPhase) ?? 0) + r.overdueTasks);
    const phaseDelays = Array.from(byPhase.entries()).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    return { total: rows.length, delayRate: Math.round((od / total) * 100), risk, phaseDelays };
  }, [rows]);

  // PortfolioTableRow has pmName (string) but no pmUserId; filter by display name match.
  const myProjects = useMemo(() => rows.filter((r) => r.pmName === user?.name), [rows, user?.name]);

  if (lens === "exec") {
    return (
      <div className="space-y-5">
        <Panel title="风险分布">
          {(["high", "medium", "low"] as const).map((k) => {
            const n = exec.risk[k]; const pct = exec.total ? Math.round((n / exec.total) * 100) : 0;
            const rc = RISK_CONFIG[k];
            return (
              <div key={k} className="flex items-center gap-3 py-1.5">
                <span className={`w-12 text-xs ${rc.color}`}>{rc.label}</span>
                <div className="flex-1"><ProgressBar value={pct} color={k === "high" ? "bg-rose-500" : k === "medium" ? "bg-amber-500" : "bg-emerald-500"} height="h-2" /></div>
                <span className="text-[11px] font-mono text-stone-500 w-12 text-right">{n} ({pct}%)</span>
              </div>
            );
          })}
        </Panel>
        <Panel title="阶段延期分布（按当前阶段汇总逾期任务）">
          {exec.phaseDelays.length === 0 ? <div className="text-sm text-stone-400">暂无逾期任务</div> :
            exec.phaseDelays.map(([ph, n]) => (
              <div key={ph} className="flex items-center justify-between py-1 text-sm">
                <span className="text-stone-600">{PHASE_MAP[ph]?.name ?? ph}</span>
                <span className="text-[11px] font-mono text-rose-600">{n} 个逾期</span>
              </div>
            ))}
        </Panel>
        <Panel title="高风险项目">
          <ProjectRows rows={rows.filter((r) => r.risk === "high")} onSelectProject={onSelectProject} empty="暂无高风险项目" />
        </Panel>
      </div>
    );
  }

  if (lens === "pm") {
    return (
      <Panel title={`我负责的项目（${myProjects.length}）`}>
        <ProjectRows rows={myProjects} onSelectProject={onSelectProject} empty="你当前不是任何项目的 PM" />
      </Panel>
    );
  }

  return <MyTasks tasks={myTasks} isLoading={myLoading} onRefetch={() => refetchMine()} onSelectProject={onSelectProject} />;
}

type MyTaskApiRow = {
  id: number; projectId: string; phaseId: string; taskId: string;
  projectName: string; projectNumber: string; projectCategory: string;
  status: string; priority: string | null; dueDate: string | null;
  assigneeUserId: number | null; completed: boolean;
};

function MyTasks({ tasks, isLoading, onRefetch, onSelectProject }: {
  tasks: MyTaskApiRow[]; isLoading: boolean; onRefetch: () => void; onSelectProject: (id: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const od = tasks.filter((t) => t.dueDate && t.dueDate < today).length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const soon = tasks.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)).length;
  const rows: TaskRow[] = tasks.map((t) => ({
    id: t.id, projectId: t.projectId, phaseId: t.phaseId, taskId: t.taskId,
    projectName: t.projectName, projectNumber: t.projectNumber, projectCategory: t.projectCategory,
    status: t.status as TaskStatus, priority: t.priority as TaskPriority,
    dueDate: t.dueDate ? String(t.dueDate) : null, assigneeUserId: t.assigneeUserId ?? null, completed: t.completed,
  }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="待办任务" value={tasks.length} />
        <Stat label="已逾期" value={od} accent={od > 0 ? "text-rose-600" : undefined} />
        <Stat label="3天内到期" value={soon} accent={soon > 0 ? "text-amber-600" : undefined} />
        <Stat label="被阻塞" value={blocked} accent={blocked > 0 ? "text-amber-600" : undefined} />
      </div>
      <div className="ce-table-shell">
        <TaskListView tasks={rows} isLoading={isLoading} emptyIcon={<CheckCircle2 size={24} />}
          emptyTitle="没有待办任务 🎉" emptyDesc="当前没有指派给您的未完成任务。"
          onRefetch={onRefetch} onNavigateToProject={onSelectProject} showOverdueBadge />
      </div>
    </div>
  );
}

function ProjectRows({ rows, onSelectProject, empty }: { rows: PortfolioTableRow[]; onSelectProject: (id: string) => void; empty: string }) {
  if (rows.length === 0) return <div className="text-sm text-stone-400">{empty}</div>;
  return (
    <div className="divide-y divide-stone-100">
      {rows.map((r) => (
        <div key={r.id} onClick={() => onSelectProject(r.id)} className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-stone-50/60 -mx-2 px-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-stone-800 truncate">{r.name}</div>
            <div className="text-[10px] font-mono text-stone-400">{PHASE_MAP[r.currentPhase]?.name ?? r.currentPhase}</div>
          </div>
          <div className="w-24"><ProgressBar value={prog(r)} color="bg-stone-800" height="h-1.5" /></div>
          {r.overdueTasks > 0 && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-0.5"><CalendarClock size={9} />{r.overdueTasks}</span>}
          {r.blockedTasks > 0 && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-0.5"><Ban size={9} />{r.blockedTasks}</span>}
          {r.openIssues > 0 && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-0.5"><Bug size={9} />{r.openIssues}</span>}
          {overdue(r) && <span className="text-[10px] font-mono text-rose-600">超期</span>}
          <ChevronRight size={13} className="text-stone-300" />
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="ce-card p-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{label}</div>
      <div className={`mt-1.5 text-2xl font-serif font-semibold ${accent ?? "text-stone-900"}`}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ce-panel p-4">
      <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}
