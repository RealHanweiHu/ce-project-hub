// 项目详情 · 总览三栏只读仪表盘
// 固定排版：每张卡片高度固定，列表区 overflow-y-auto；增删条目不改变整体高度。
// 数据全部来自 project + 现有 hooks/selector，不新增后端调用。
import {
  AlertTriangle, ArrowRight, CheckCircle2, Circle, Settings as SettingsIcon,
  ListChecks, Bug, GaugeCircle, Flag, Calendar,
} from 'lucide-react';
import {
  Project, HEALTH_CONFIG, getProjectPhases, computeOverallProgress,
  Issue, ChangeRecord,
} from '@/lib/data';
import { CATEGORY_MAP } from '@/lib/sop-templates';
import { CHANGE_TYPE_CONFIG } from './../ChangeLog';
import { LinearCard, Kicker, LinearBar } from '@/components/linear/primitives';
import { trpc } from '@/lib/trpc';

// ── helpers ───────────────────────────────────────────────────────────────────
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function daysFromToday(iso?: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function relativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} 个月前`;
  return `${Math.floor(mon / 12)} 年前`;
}

const ISSUE_STATUS_LABEL: Record<string, string> = {
  open: '待处理', in_progress: '处理中', resolved: '待复测', closed: '复测通过', wont_fix: '不修复',
};
const ISSUE_CATEGORY_LABEL: Record<string, string> = {
  hardware: '硬件', software: '软件', mechanical: '结构', thermal: '热设计',
  reliability: '可靠性', safety: '安全', performance: '性能', other: '其他',
};
const TASK_STATUS_LABEL: Record<string, string> = {
  todo: '待开始', in_progress: '进行中', blocked: '阻塞', done: '已完成',
  skipped: '跳过', pending_approval: '待审批',
};

interface FlatTask {
  id: string; name: string; status: string; dueDate?: string | null; assigneeUserId?: number | null;
}

export function ProjectDashboard({
  project, onOpenSettings, onSelectTab,
}: {
  project: Project;
  onOpenSettings: () => void;
  onSelectTab: (tab: string) => void;
}) {
  const { data: users = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const userName = (id?: number | null) => (id ? users.find((u) => u.id === id)?.name ?? '—' : '未分配');

  const phases = getProjectPhases(project);
  const overallProgress = computeOverallProgress(project);
  const health = HEALTH_CONFIG[project.risk];
  const pmName = project.pmUserId ? users.find((u) => u.id === project.pmUserId)?.name ?? '—' : '—';
  const productLine = project.category ? CATEGORY_MAP[project.category]?.name ?? project.category : '—';
  const currentPhaseName = phases.find((p) => p.id === project.currentPhase)?.name ?? project.currentPhase;

  // ── tasks: flatten across phases ────────────────────────────────────────────
  let doneTasks = 0, totalTasks = 0;
  const todoTasks: FlatTask[] = [];
  for (const phase of phases) {
    const pd = project.phases[phase.id];
    const checked = pd?.tasks ?? {};
    const details = pd?.taskDetails ?? {};
    for (const task of phase.tasks) {
      totalTasks += 1;
      const isDone = checked[task.id] === true;
      if (isDone) { doneTasks += 1; continue; }
      const d = details[task.id];
      const status = d?.taskStatus ?? 'todo';
      if (status === 'done' || status === 'skipped') continue;
      todoTasks.push({
        id: `${phase.id}:${task.id}`, name: task.name, status,
        dueDate: d?.dueDate, assigneeUserId: d?.assigneeUserId,
      });
    }
  }
  // 待办优先级：有截止日的排前面、按日期升序
  todoTasks.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });

  // ── issues: open / in_progress across phases ────────────────────────────────
  const openIssues: Issue[] = [];
  for (const phase of phases) {
    for (const issue of project.phases[phase.id]?.issues ?? []) {
      if (issue.status === 'open' || issue.status === 'in_progress') openIssues.push(issue);
    }
  }
  const SEV_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  openIssues.sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));

  // ── changelog: recent entries ───────────────────────────────────────────────
  const recentChanges: ChangeRecord[] = [...(project.changeLog ?? [])]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // ── next gate: nearest undone gate task with a due date ─────────────────────
  let nextGate: { name: string; due: string; days: number } | null = null;
  for (const phase of phases) {
    const pd = project.phases[phase.id];
    const gateDone = pd?.tasks?.[phase.gateTaskId] === true;
    if (gateDone) continue;
    const due = pd?.taskDetails?.[phase.gateTaskId]?.dueDate;
    if (!due) continue;
    const days = daysFromToday(due);
    if (days === null) continue;
    if (!nextGate || due < nextGate.due) {
      const gateTask = phase.tasks.find((t) => t.id === phase.gateTaskId);
      nextGate = { name: gateTask?.name ?? phase.gate, due, days };
    }
  }

  const atRisk = project.risk === 'high' || project.risk === 'medium';

  return (
    <div className="space-y-4">
      {/* ── 风险预警横幅（仅风险项目显示，缺省不占位）──────────────────────────── */}
      {atRisk && (
        <div
          className="flex items-start gap-3 rounded-[11px] border px-4 py-3"
          style={{
            borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)',
            background: 'var(--warning-soft)',
          }}
        >
          <AlertTriangle size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
          <div className="min-w-0">
            <div className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>
              {health?.label ?? '需关注'} · 项目存在风险
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground truncate">
              {project.riskOverrideReason?.trim()
                || (openIssues.length > 0
                  ? `${openIssues.length} 个未关闭问题需要收口，当前阶段「${currentPhaseName}」`
                  : `当前阶段「${currentPhaseName}」存在进度风险，请关注关键节点`)}
            </div>
          </div>
        </div>
      )}

      {/* ── 三栏主网格 ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_360px] gap-4 items-start">
        {/* 左列 */}
        <div className="space-y-4">
          {/* 待办任务 */}
          <LinearCard className="p-4">
            <CardHeader title="待办任务" actionLabel="查看全部" onAction={() => onSelectTab('tasks')} />
            <div className="h-[248px] overflow-y-auto -mr-1 pr-1">
              {todoTasks.length === 0 ? (
                <EmptyState text="暂无待办" />
              ) : (
                <ul className="space-y-0.5">
                  {todoTasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-secondary">
                      <Circle size={13} className="shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{t.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {TASK_STATUS_LABEL[t.status] ?? t.status} · {userName(t.assigneeUserId)}
                        </div>
                      </div>
                      {t.dueDate && (
                        <span className="num shrink-0 text-[11px] text-muted-foreground">{t.dueDate.slice(5)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </LinearCard>

          {/* 未关闭问题 */}
          <LinearCard className="p-4">
            <CardHeader title="未关闭问题" actionLabel="查看全部" onAction={() => onSelectTab('issues')} />
            <div className="h-[168px] overflow-y-auto -mr-1 pr-1">
              {openIssues.length === 0 ? (
                <EmptyState text="暂无未关闭问题" />
              ) : (
                <ul className="space-y-0.5">
                  {openIssues.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-secondary">
                      <SeverityBadge sev={i.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{i.title}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {ISSUE_CATEGORY_LABEL[i.category] ?? i.category} · {i.owner || '—'}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{ISSUE_STATUS_LABEL[i.status] ?? i.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </LinearCard>
        </div>

        {/* 中列 */}
        <div className="space-y-4">
          {/* 关键信息 */}
          <LinearCard className="p-4">
            <CardHeader title="关键信息" actionLabel="设置" onAction={onOpenSettings} icon={<SettingsIcon size={12} />} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 pt-1">
              <InfoCell label="项目编号" value={project.code || '—'} mono />
              <InfoCell label="项目经理" value={pmName} />
              <InfoCell label="产品线" value={productLine} />
              <InfoCell label="当前阶段" value={currentPhaseName} />
              <InfoCell label="开始" value={project.startDate || '—'} mono />
              <InfoCell label="目标量产" value={project.targetDate || '—'} mono />
            </div>
          </LinearCard>

          {/* 最近变更 */}
          <LinearCard className="p-4">
            <CardHeader title="最近变更" actionLabel="查看全部" onAction={() => onSelectTab('changelog')} />
            <div className="h-[168px] overflow-y-auto -mr-1 pr-1">
              {recentChanges.length === 0 ? (
                <EmptyState text="暂无变更记录" />
              ) : (
                <ul className="space-y-0.5">
                  {recentChanges.map((c) => {
                    const cfg = CHANGE_TYPE_CONFIG[c.type];
                    return (
                      <li key={c.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-secondary">
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold border ${cfg?.color ?? 'bg-secondary'} ${cfg?.textColor ?? 'text-muted-foreground'} ${cfg?.borderColor ?? 'border-border'}`}>
                          {cfg?.badge ?? c.type.toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground">{c.title}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {(c.decisionMaker || '—')} · {relativeTime(c.createdAt)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </LinearCard>
        </div>

        {/* 右列（固定 360px） */}
        <div className="space-y-4">
          {/* 进度 */}
          <LinearCard className="p-4">
            <Kicker className="mb-3 flex items-center gap-1.5"><GaugeCircle size={12} />进度</Kicker>
            <div className="flex items-baseline gap-2">
              <span className="num text-3xl font-semibold text-foreground">{overallProgress}</span>
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <LinearBar value={overallProgress} className="mt-3" />
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Stat icon={<ListChecks size={13} />} label="任务完成" value={`${doneTasks}/${totalTasks}`} />
              <Stat icon={<Bug size={13} />} label="未关闭问题" value={String(openIssues.length)} accent={openIssues.length > 0} />
              <Stat
                icon={<span className={`h-2 w-2 rounded-full ${health?.dot ?? 'bg-muted-foreground'}`} />}
                label="风险等级"
                value={health?.label ?? project.risk}
              />
            </div>
          </LinearCard>

          {/* 下一 GATE */}
          <LinearCard className="overflow-hidden p-0">
            <div className="bg-primary p-4 text-primary-foreground">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80">
                <Flag size={12} />下一 GATE
              </div>
              {nextGate ? (
                <div className="mt-2.5">
                  <div className="num text-2xl font-semibold leading-none">
                    {nextGate.days >= 0 ? `T-${nextGate.days} 天后` : `已超期 ${-nextGate.days} 天`}
                  </div>
                  <div className="mt-2 truncate text-sm font-medium">{nextGate.name}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs opacity-80">
                    <Calendar size={11} />
                    <span className="num">{nextGate.due}</span>
                    <span>· {WEEKDAYS[new Date(`${nextGate.due}T00:00:00`).getDay()]}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 flex h-[68px] items-center text-sm opacity-80">暂无即将 Gate</div>
              )}
            </div>
          </LinearCard>
        </div>
      </div>
    </div>
  );
}

// ── sub-components ──────────────────────────────────────────────────────────────
function CardHeader({ title, actionLabel, onAction, icon }: {
  title: string; actionLabel: string; onAction: () => void; icon?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <Kicker>{title}</Kicker>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {icon}{actionLabel}{icon ? null : <ArrowRight size={11} />}
      </button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</div>
  );
}

function InfoCell({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-sm text-foreground ${mono ? 'num' : ''}`}>{value}</div>
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md bg-secondary px-1.5 py-2">
      <div className="flex items-center justify-center text-muted-foreground">{icon}</div>
      <div className={`mt-1 truncate text-sm font-semibold ${accent ? 'text-[color:var(--destructive)]' : 'text-foreground'}`}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function SeverityBadge({ sev }: { sev: string }) {
  const tone = sev === 'P0' || sev === 'P1'
    ? 'text-[color:var(--destructive)] border-[color:var(--destructive)]/30 bg-[color:var(--destructive-soft)]'
    : sev === 'P2'
      ? 'text-[color:var(--warning)] border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)]'
      : 'text-muted-foreground border-border bg-secondary';
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold border num ${tone}`}>{sev}</span>
  );
}
