// 项目总揽（只读）：基础信息 + 关键指标。数据多数来自已加载的 project；
// 成员数走 members.list、PM 名走 admin.listUsersForSelect（均已存在、带缓存）。
import { Project, RISK_CONFIG, getProjectPhases, computeOverallProgress } from '@/lib/data';
import { CATEGORY_MAP } from '@/lib/sop-templates';
import { trpc } from '@/lib/trpc';
import { Hash, User, AlertTriangle, CalendarRange, Flag, GaugeCircle, ListChecks, Bug, GitBranch, Users, CalendarClock, RefreshCw } from 'lucide-react';
import { MeetingConfigPanel } from './MeetingConfigPanel';
import { toast } from 'sonner';

export function OverviewPanel({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { data: members = [] } = trpc.members.list.useQuery({ projectId: project.id });
  const { data: users = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });

  const catConfig = project.category ? CATEGORY_MAP[project.category] : null;
  const phases = getProjectPhases(project);
  const currentPhaseName = phases.find((p) => p.id === project.currentPhase)?.name ?? project.currentPhase;
  const overallProgress = computeOverallProgress(project);
  const risk = RISK_CONFIG[project.risk];
  const pmName = project.pmUserId ? users.find((u) => u.id === project.pmUserId)?.name ?? '—' : '—';

  // 任务完成率
  let doneTasks = 0;
  let totalTasks = 0;
  for (const phase of phases) {
    const taskState = project.phases[phase.id]?.tasks ?? {};
    for (const task of phase.tasks) {
      totalTasks += 1;
      if (taskState[task.id]) doneTasks += 1;
    }
  }
  const taskRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // 开放问题 / 待决变更
  const openIssues = phases.reduce((sum, phase) => {
    const issues = project.phases[phase.id]?.issues ?? [];
    return sum + issues.filter((i) => i.status === 'open' || i.status === 'in_progress').length;
  }, 0);
  const pendingChanges = (project.changeLog ?? []).filter((r) => r.status === 'proposed').length;

  // 排期：预计完成 = 所有任务最晚 due；超期 = 晚于 targetDate
  let projectedEnd: string | null = null;
  for (const phase of phases) {
    const td = project.phases[phase.id]?.taskDetails ?? {};
    for (const id of Object.keys(td)) {
      const due = td[id]?.dueDate;
      if (due && (!projectedEnd || due > projectedEnd)) projectedEnd = due;
    }
  }
  const overdue = !!(projectedEnd && project.targetDate && projectedEnd > project.targetDate);

  const utils = trpc.useUtils();
  const regenerate = trpc.tasks.regenerateSchedule.useMutation({
    onSuccess: (r) => { utils.tasks.list.invalidate({ projectId: project.id }); toast.success(`已重新生成排期（${r.count} 个任务）`); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      {/* 类型卡 */}
      {catConfig && (
        <div className={`flex items-start gap-4 border ${catConfig.borderColor} ${catConfig.color} p-4`}>
          <span className="text-3xl leading-none">{catConfig.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${catConfig.textColor}`}>{catConfig.name}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${catConfig.borderColor} ${catConfig.textColor}`}>{catConfig.badge}</span>
              <span className="text-[10px] font-mono text-stone-400">{catConfig.phaseCount} 阶段 · {catConfig.typicalDuration}</span>
            </div>
            <p className="text-xs text-stone-500 mt-1 leading-relaxed">{catConfig.desc}</p>
          </div>
        </div>
      )}

      {/* 基础信息 */}
      <div>
        <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">基础信息</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-stone-200 border border-stone-200">
          <InfoCell icon={<Hash size={13} />} label="项目编号" value={project.code || '—'} mono />
          <InfoCell icon={<User size={13} />} label="项目经理" value={pmName} />
          <InfoCell
            icon={<AlertTriangle size={13} />}
            label="风险等级"
            value={<span className={risk?.color}>{risk?.label ?? project.risk}</span>}
          />
          <InfoCell icon={<Flag size={13} />} label="当前阶段" value={currentPhaseName} />
          <InfoCell icon={<CalendarRange size={13} />} label="计划起止" value={`${project.startDate || '—'} ~ ${project.targetDate || '—'}`} mono />
          <InfoCell
            icon={<GaugeCircle size={13} />}
            label="整体进度"
            value={
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-stone-200 overflow-hidden min-w-[48px]">
                  <div className="h-full bg-stone-800" style={{ width: `${overallProgress}%` }} />
                </div>
                <span className="text-xs font-mono text-stone-600">{overallProgress}%</span>
              </div>
            }
          />
        </div>
      </div>

      {/* 关键指标 */}
      <div>
        <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">关键指标</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric icon={<ListChecks size={15} />} label="任务完成率" value={`${taskRate}%`} sub={`${doneTasks}/${totalTasks}`} />
          <Metric icon={<Bug size={15} />} label="开放问题" value={String(openIssues)} accent={openIssues > 0 ? 'text-rose-600' : undefined} />
          <Metric icon={<GitBranch size={15} />} label="待决变更" value={String(pendingChanges)} accent={pendingChanges > 0 ? 'text-amber-600' : undefined} />
          <Metric icon={<Users size={15} />} label="项目成员" value={String(members.length)} />
        </div>
      </div>

      {/* 排期 */}
      <div className="border border-stone-200 bg-white p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarClock size={14} className="text-amber-500" />
          <span className="text-sm font-medium text-stone-800">自动排期</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">预计完成</span>
          <span className="font-mono text-stone-700">{projectedEnd || '未排期'}</span>
        </div>
        {overdue && (
          <span className="text-[11px] font-mono px-1.5 py-0.5 bg-rose-50 text-rose-600 border border-rose-200">超出目标日 {project.targetDate}</span>
        )}
        <div className="text-[11px] text-stone-400 flex-1">按 SOP 工期+依赖、从开始日 {project.startDate || '（未设）'} 自动生成</div>
        {canEdit && (
          <button
            disabled={regenerate.isPending || !project.startDate}
            onClick={() => regenerate.mutate({ projectId: project.id })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-40 transition-colors"
            title={project.startDate ? '按开始日重新生成整套排期' : '请先设置项目开始日期'}
          >
            <RefreshCw size={12} />重新生成排期
          </button>
        )}
      </div>

      {/* 项目周会(每项目可配) */}
      <MeetingConfigPanel projectId={project.id} canEdit={canEdit} />
    </div>
  );
}

function InfoCell({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="bg-white p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-sm text-stone-800 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function Metric({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white border border-stone-200 p-4">
      <div className="flex items-center gap-1.5 text-stone-400">{icon}<span className="text-[10px] font-mono uppercase tracking-wider">{label}</span></div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-2xl font-semibold ${accent ?? 'text-stone-800'}`}>{value}</span>
        {sub && <span className="text-[11px] font-mono text-stone-400">{sub}</span>}
      </div>
    </div>
  );
}
