import { useMemo, useState, useEffect, Suspense, lazy } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { PHASE_MAP } from "@/lib/data";
import { Loader2, X } from "lucide-react";
import { KpiStrip } from "./KpiStrip";
import { RagHealthPanel } from "./RagHealthPanel";
import { PortfolioTable, type PortfolioTableRow } from "./PortfolioTable";
import { PerspectivePanel, type Lens } from "./PerspectivePanel";
import { MilestoneCalendar } from "./MilestoneCalendar";
import { TaskListView, type TaskRow } from "../TaskListView";
import type { TaskStatus, TaskPriority } from "@shared/const";

const PhaseDistributionChart = lazy(() =>
  import("../PhaseDistributionChart").then((m) => ({ default: m.PhaseDistributionChart }))
);

const PHASE_CODE_COLORS: Record<string, string> = {
  P1: "#78716c", P2: "#a16207", P3: "#0369a1", P4: "#7c3aed", P5: "#0f766e", P6: "#b45309", P7: "#166534",
};
const LENS_LABEL: Record<Lens, string> = { exec: "管理层", pm: "PM", mine: "我的" };

type DrillTask = {
  id: number; projectId: string; phaseId: string; taskId: string;
  projectName: string; projectNumber: string; projectCategory: string;
  status: string; priority: string | null; dueDate: string | null;
  assigneeUserId: number | null; completed: boolean;
};

export function OverviewPage({ onSelectProject }: { onSelectProject: (id: string) => void }) {
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
  const isPersonalOnly = activeLens === "mine" && allowedLenses.length === 1;

  const phaseDistribution = useMemo(() => {
    const m = new Map<string, { count: number; name: string; color: string }>();
    for (const r of portfolio) {
      const ph = PHASE_MAP[r.currentPhase];
      const code = ph?.code ?? r.currentPhase;
      const cur = m.get(code) ?? { count: 0, name: ph?.name ?? r.currentPhase, color: PHASE_CODE_COLORS[code] ?? "#78716c" };
      cur.count++; m.set(code, cur);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => Number(a.replace(/\D/g, "") || "0") - Number(b.replace(/\D/g, "") || "0"))
      .map(([code, v]) => ({ name: code, fullName: v.name, count: v.count, color: v.color, label: code }));
  }, [portfolio]);

  if (isLoading) {
    return <div className="flex items-center gap-2 text-stone-400 py-12 justify-center"><Loader2 size={16} className="animate-spin" />加载总览…</div>;
  }

  return (
    <div className="ce-page">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-xl text-stone-900">总览</h1>
        {allowedLenses.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-stone-400">以</span>
            <select value={activeLens} onChange={(e) => setLens(e.target.value as Lens)}
              className="ce-control border border-stone-300 bg-white px-2 py-1.5 text-sm">
              {allowedLenses.map((l) => <option key={l} value={l}>{LENS_LABEL[l]}视角</option>)}
            </select>
            <span className="text-[11px] font-mono text-stone-400">查看</span>
          </div>
        )}
      </div>

      {isPersonalOnly ? (
        <PerspectivePanel lens="mine" rows={portfolio} onSelectProject={onSelectProject} allowProjectNavigation={false} showRelatedProjects />
      ) : (
        <>
          <KpiStrip rows={portfolio} onDrill={setDrill} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RagHealthPanel rows={portfolio} onSelectProject={onSelectProject} />
            <div className="ce-panel p-5">
              <h3 className="font-serif text-lg text-stone-900 mb-4">阶段分布</h3>
              <Suspense fallback={<div className="h-[220px]" />}>
                <PhaseDistributionChart data={phaseDistribution} />
              </Suspense>
            </div>
          </div>
          <PortfolioTable rows={portfolio} onSelectProject={onSelectProject} />

          <div className="pt-2">
            <PerspectivePanel lens={activeLens} rows={portfolio} onSelectProject={onSelectProject} />
          </div>

          <MilestoneCalendar onSelectProject={onSelectProject} />
        </>
      )}

      {!isPersonalOnly && drill && (
        <DrillDown kind={drill} onClose={() => setDrill(null)} onSelectProject={onSelectProject} />
      )}
    </div>
  );
}

function DrillDown({ kind, onClose, onSelectProject }: { kind: "overdue" | "blocked"; onClose: () => void; onSelectProject: (id: string) => void }) {
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
    <div className="fixed inset-0 z-40 flex justify-end bg-stone-900/40" onClick={onClose}>
      <div className="w-full max-w-xl h-full bg-white shadow-xl overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-lg text-stone-900">{kind === "overdue" ? "逾期任务" : "阻塞任务"}</h3>
          <button onClick={onClose} aria-label="关闭" className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
        </div>
        <div className="ce-table-shell">
          <TaskListView tasks={rows} isLoading={q.isLoading}
            emptyIcon={null} emptyTitle={kind === "overdue" ? "无逾期任务" : "无阻塞任务"} emptyDesc=""
            onRefetch={() => q.refetch()} onNavigateToProject={(id) => { onSelectProject(id); onClose(); }} showOverdueBadge />
        </div>
      </div>
    </div>
  );
}
