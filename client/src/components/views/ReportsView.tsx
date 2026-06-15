// 三视角报表：同源数据、不同视角。管理层(组合度量)/ PM(我负责的项目)/ 我的(我的任务)。
import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { RISK_CONFIG, PHASE_MAP } from '@/lib/data';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { TaskListView, type TaskRow } from './TaskListView';
import type { TaskStatus, TaskPriority } from '@shared/const';
import { BarChart3, Crown, User, Users, Bug, Ban, CalendarClock, ChevronRight, CheckCircle2, Loader2 } from 'lucide-react';

type Persp = 'exec' | 'pm' | 'mine';
type PRow = {
  id: string; name: string; projectNumber: string; category: string; risk: string;
  currentPhase: string; targetDate: string | null; pmUserId: number | null; pmName: string | null;
  taskTotal: number; taskDone: number; overdueTasks: number; blockedTasks: number; openIssues: number; projectedEnd: string | null;
};
const prog = (r: PRow) => (r.taskTotal > 0 ? Math.round((r.taskDone / r.taskTotal) * 100) : 0);
const overdue = (r: PRow) => !!(r.projectedEnd && r.targetDate && r.projectedEnd > r.targetDate);

export function ReportsView({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const { user } = useAuth();
  const [persp, setPersp] = useState<Persp>(user?.role === 'admin' ? 'exec' : 'mine');
  const { data: portfolio = [], isLoading } = trpc.projects.portfolio.useQuery();
  const { data: myTasks = [], isLoading: myLoading, refetch: refetchMine } = trpc.tasks.myTasks.useQuery();
  const rows = portfolio as PRow[];

  const exec = useMemo(() => {
    const total = rows.length || 1;
    const od = rows.filter(overdue).length;
    const risk = { high: rows.filter((r) => r.risk === 'high').length, medium: rows.filter((r) => r.risk === 'medium').length, low: rows.filter((r) => r.risk === 'low').length };
    const byPhase = new Map<string, number>();
    for (const r of rows) byPhase.set(r.currentPhase, (byPhase.get(r.currentPhase) ?? 0) + r.overdueTasks);
    const phaseDelays = Array.from(byPhase.entries()).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    return { total: rows.length, delayRate: Math.round((od / total) * 100), risk, phaseDelays };
  }, [rows]);

  const myProjects = useMemo(() => rows.filter((r) => r.pmUserId === user?.id), [rows, user?.id]);

  if (isLoading) return <div className="flex items-center gap-2 text-stone-400 py-12 justify-center"><Loader2 size={16} className="animate-spin" />加载报表…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <BarChart3 size={18} className="text-amber-500" />
        <h1 className="font-serif text-xl text-stone-900">报表</h1>
      </div>
      <div className="flex items-center gap-0 border-b border-stone-200">
        {([['exec', '管理层视角', Crown], ['pm', 'PM 视角', User], ['mine', '我的视角', Users]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setPersp(k)}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${persp === k ? 'border-b-stone-900 text-stone-900' : 'border-b-transparent text-stone-400 hover:text-stone-700'}`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {persp === 'exec' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="项目总数" value={exec.total} />
            <Stat label="延期率" value={`${exec.delayRate}%`} accent={exec.delayRate > 0 ? 'text-amber-600' : undefined} />
            <Stat label="高风险项目" value={exec.risk.high} accent={exec.risk.high > 0 ? 'text-rose-600' : undefined} />
            <Stat label="逾期任务总数" value={rows.reduce((s, r) => s + r.overdueTasks, 0)} accent="text-rose-600" />
          </div>
          <Panel title="风险分布">
            {(['high', 'medium', 'low'] as const).map((k) => {
              const n = exec.risk[k]; const pct = exec.total ? Math.round((n / exec.total) * 100) : 0;
              const rc = RISK_CONFIG[k];
              return (
                <div key={k} className="flex items-center gap-3 py-1.5">
                  <span className={`w-12 text-xs ${rc.color}`}>{rc.label}</span>
                  <div className="flex-1"><ProgressBar value={pct} color={k === 'high' ? 'bg-rose-500' : k === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'} height="h-2" /></div>
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
            <ProjectRows rows={rows.filter((r) => r.risk === 'high')} onSelectProject={onSelectProject} empty="暂无高风险项目" />
          </Panel>
        </div>
      )}

      {persp === 'pm' && (
        <Panel title={`我负责的项目（${myProjects.length}）`}>
          <ProjectRows rows={myProjects} onSelectProject={onSelectProject} empty="你当前不是任何项目的 PM" />
        </Panel>
      )}

      {persp === 'mine' && (
        <MyTasks tasks={myTasks} isLoading={myLoading} onRefetch={() => refetchMine()} onSelectProject={onSelectProject} />
      )}
    </div>
  );
}

// myTasks 查询返回的行（与 MyTasksView 同源），映射到共享 TaskListView 的 TaskRow
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
  const blocked = tasks.filter((t) => t.status === 'blocked').length;
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
        <Stat label="已逾期" value={od} accent={od > 0 ? 'text-rose-600' : undefined} />
        <Stat label="3天内到期" value={soon} accent={soon > 0 ? 'text-amber-600' : undefined} />
        <Stat label="被阻塞" value={blocked} accent={blocked > 0 ? 'text-amber-600' : undefined} />
      </div>
      <div className="bg-white border border-stone-200">
        <TaskListView
          tasks={rows}
          isLoading={isLoading}
          emptyIcon={<CheckCircle2 size={24} />}
          emptyTitle="没有待办任务 🎉"
          emptyDesc="当前没有指派给您的未完成任务。"
          onRefetch={onRefetch}
          onNavigateToProject={onSelectProject}
          showOverdueBadge
        />
      </div>
    </div>
  );
}

function ProjectRows({ rows, onSelectProject, empty }: { rows: PRow[]; onSelectProject: (id: string) => void; empty: string }) {
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
    <div className="bg-white border border-stone-200 p-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{label}</div>
      <div className={`mt-1.5 text-2xl font-serif font-semibold ${accent ?? 'text-stone-900'}`}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 p-4">
      <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}
