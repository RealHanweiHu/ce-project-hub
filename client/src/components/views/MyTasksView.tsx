/**
 * MyTasksView – dedicated「我的任务」first-class page for execution roles
 * (structural/ID engineers, etc.). Reuses the「mine」workbench perspective so a
 * user lands directly on their own queue + task list, and clicking a task
 * deep-links into the project at the right phase with the task detail open.
 *
 * Linear redesign — Phase 1 VISUAL. Dual mode (列表 / 看板), tasks grouped by
 * 逾期 / 进行中 / 已完成, checkbox completion (existing `tasks.setCompleted`
 * mutation), priority flags, status filter + search. No new data/logic added —
 * the data source is the existing `trpc.workbench.mine` query (which already
 * filters out done/skipped tasks server-side).
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import { Search, Flag, Check, List as ListIcon, LayoutGrid, ClipboardCheck } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { cn, toLocalISODate, localISODatePlus } from '@/lib/utils';
import { PageHeader, SegToggle } from '@/components/linear/primitives';
import type { TaskStatus, TaskPriority } from '@shared/const';
import { taskProjectLike, type TaskFocus } from './TaskListView';
import { MyWorkBuckets } from './overview/PerspectivePanel';
import { resolveProjectPhase, resolveTaskName } from '@shared/sop-template-resolution';
import { buildTaskCompletionActionPath } from '@shared/action-links';

// ── Types ───────────────────────────────────────────────────────────────────
type ApiTask = {
  id: number; projectId: string; phaseId: string; taskId: string;
  projectName: string; projectNumber: string; projectCategory: string;
  sopTemplateVersion?: string | null; customFields?: unknown;
  status: string; priority: string | null; dueDate: string | null;
  assigneeUserId: number | null; completed: boolean;
};

type Task = {
  id: number; projectId: string; phaseId: string; taskId: string;
  name: string; projectName: string; projectNumber: string; phaseLabel: string;
  status: TaskStatus; priority: TaskPriority; dueDate: string | null; completed: boolean;
};

type ViewMode = 'list' | 'board';
type StatusFilter = 'all' | 'open' | 'overdue' | 'done';

// ── Priority flag config ────────────────────────────────────────────────────
const PRIORITY: Record<TaskPriority, { label: string; color: string; dot: string }> = {
  critical: { label: '紧急', color: 'var(--destructive)', dot: 'var(--destructive)' },
  high:     { label: '高',   color: 'var(--warning)',     dot: 'var(--warning)' },
  medium:   { label: '中',   color: 'var(--primary)',     dot: 'var(--primary)' },
  low:      { label: '低',   color: 'var(--muted-foreground)', dot: 'var(--muted-foreground)' },
};

const TODAY = toLocalISODate();
function isOverdue(t: Task): boolean {
  return !t.completed && !!t.dueDate && t.dueDate < TODAY;
}
function isSoon(t: Task): boolean {
  if (t.completed || !t.dueDate || isOverdue(t)) return false;
  const soon = localISODatePlus(6);
  return t.dueDate <= soon;
}

// ── Group definitions (preserve逾期 / 进行中 / 已完成 grouping) ──────────────
const GROUPS: { key: 'overdue' | 'open' | 'done'; label: string; tone: string; test: (t: Task) => boolean }[] = [
  { key: 'overdue', label: '逾期',        tone: 'var(--destructive)', test: (t) => isOverdue(t) },
  { key: 'open',    label: '进行中 / 待办', tone: 'var(--primary)',     test: (t) => !t.completed && !isOverdue(t) },
  { key: 'done',    label: '已完成',       tone: 'var(--success)',     test: (t) => t.completed },
];

// ── Avatar ──────────────────────────────────────────────────────────────────
function Avatar({ label, size = 24 }: { label: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: 'var(--primary)', fontSize: size * 0.42 }}
    >
      {label}
    </span>
  );
}

// ── Priority flag indicator ──────────────────────────────────────────────────
function PriorityFlag({ priority }: { priority: TaskPriority }) {
  return <Flag size={13} className="shrink-0" style={{ color: PRIORITY[priority].color, fill: PRIORITY[priority].color }} />;
}

// ── Checkbox (drives the existing completion mutation) ───────────────────────
function Checkbox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors',
        checked ? 'border-[color:var(--success)] bg-[color:var(--success)]' : 'border-[color:var(--border)] hover:border-[color:var(--acc-border)]',
      )}
      title={checked ? '标记为未完成' : '标记为已完成'}
    >
      <Check size={11} strokeWidth={3} className={cn('text-white transition-opacity', checked ? 'opacity-100' : 'opacity-0')} />
    </button>
  );
}

// ── Due date display ──────────────────────────────────────────────────────────
function DueText({ task, className }: { task: Task; className?: string }) {
  const over = isOverdue(task), soon = isSoon(task);
  if (!task.dueDate) return <span className={cn('text-muted-foreground num', className)}>—</span>;
  return (
    <span
      className={cn('num font-medium', className)}
      style={{ color: task.completed ? 'var(--muted-foreground)' : over ? 'var(--destructive)' : soon ? 'var(--warning)' : 'var(--secondary-foreground)' }}
    >
      {over ? '逾期 ' : ''}{task.dueDate}
    </span>
  );
}

export function MyTasksView({ onSelectProject }: { onSelectProject: (id: string, focus?: TaskFocus) => void }) {
  const queryClient = useQueryClient();
  const { data: workbench } = trpc.workbench.mine.useQuery();
  // 待你审核的交付物——被选为审核人的 qa/cert/scm 等角色的复核入口（此前只在 PM 视角可见）
  const { data: pendingReviews = [] } = trpc.deliverableReviews.myPending.useQuery();
  const setCompleted = trpc.tasks.setCompleted.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.workbench.mine) });
    },
    onError: (e) => {
      // 失败时列表会回滚到未完成态,不提示的话用户会误以为已完成。
      toast.error(`更新任务状态失败：${e.message}`);
      queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.workbench.mine) });
    },
  });

  const [view, setView] = useState<ViewMode>('list');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'due' | 'priority' | 'project'>('due');

  // Map API tasks → display model (preserve all source fields). The query already
  // excludes done/skipped, so 已完成 group only renders if/when data has them.
  const tasks: Task[] = useMemo(() => {
    const rows = (workbench?.tasks ?? []) as ApiTask[];
    return rows.map((t) => {
      const projectLike = taskProjectLike(t);
      return {
        id: t.id, projectId: t.projectId, phaseId: t.phaseId, taskId: t.taskId,
        name: resolveTaskName(projectLike, t.taskId, t.phaseId),
        projectName: t.projectName, projectNumber: t.projectNumber,
        phaseLabel: resolveProjectPhase(projectLike, t.phaseId)?.code ?? t.phaseId,
        status: t.status as TaskStatus, priority: (t.priority ?? 'medium') as TaskPriority,
        dueDate: t.dueDate ? String(t.dueDate) : null, completed: t.completed,
      };
    });
  }, [workbench?.tasks]);

  const handleToggle = (t: Task) => {
    if (!t.completed) {
      window.location.assign(buildTaskCompletionActionPath({
        projectId: t.projectId,
        phaseId: t.phaseId,
        taskId: t.taskId,
      }));
      return;
    }
    setCompleted.mutate({ projectId: t.projectId, phaseId: t.phaseId, taskId: t.taskId, completed: !t.completed });
  };

  const passStatus = (t: Task): boolean => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'done') return t.completed;
    if (statusFilter === 'overdue') return isOverdue(t);
    if (statusFilter === 'open') return !t.completed;
    return true;
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = tasks.filter((t) =>
      passStatus(t) &&
      (!q || `${t.name} ${t.projectName} ${t.projectNumber}`.toLowerCase().includes(q)),
    );
    const prioRank = (p: TaskPriority) => (p === 'high' ? 0 : p === 'medium' ? 1 : 2);
    return [...filtered].sort((a, b) => {
      if (sortBy === 'due') {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      }
      if (sortBy === 'priority') return prioRank(a.priority) - prioRank(b.priority);
      return a.projectName.localeCompare(b.projectName, 'zh');
    });
  }, [tasks, statusFilter, search, sortBy]);

  const groups = GROUPS
    .map((g) => ({ ...g, items: visible.filter(g.test) }))
    .filter((g) => g.items.length > 0);

  const openCount = tasks.filter((t) => !t.completed).length;
  const overCount = tasks.filter(isOverdue).length;
  const nextDue = tasks
    .filter((t) => !t.completed && t.dueDate)
    .reduce<string | null>((min, t) => (min === null || (t.dueDate as string) < min ? (t.dueDate as string) : min), null);

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'open', label: '进行中' },
    { value: 'overdue', label: '逾期' },
    { value: 'done', label: '已完成' },
  ];

  return (
    <div className="flex flex-col">
      <PageHeader
        title="我的工作"
        sub="你的待办、审批、待审核与提醒都在这里；点击任意条目直达对应项目阶段与任务详情。"
        actions={
          <SegToggle<ViewMode>
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: <><ListIcon size={12} />列表</> },
              { value: 'board', label: <><LayoutGrid size={12} />看板</> },
            ]}
          />
        }
      />

      {/* 设计4 §6 三桶（现在处理 / 等待别人 / 仅关注）——个人队列全站唯一入口 */}
      <div className="mb-4">
        <MyWorkBuckets onSelectProject={onSelectProject} />
      </div>

      {/* Filter bar: status segmented + search + meta */}
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <SegToggle<StatusFilter> value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
        <div className="flex h-[32px] w-full min-w-[160px] items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:border-[color:var(--acc-border)] focus-within:ring-2 focus-within:ring-[color:var(--acc-soft)] sm:w-auto sm:flex-1 lg:w-[220px] lg:flex-none">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务…"
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          排序
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'due' | 'priority' | 'project')}
            className="h-8 cursor-pointer rounded-[7px] border border-border bg-card px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="due">截止日期</option>
            <option value="priority">优先级</option>
            <option value="project">项目</option>
          </select>
        </label>
        <div className="ml-auto text-[12px] text-muted-foreground">
          我 · <span className="num">{openCount}</span> 项进行中 · <span className="num">{overCount}</span> 项逾期
          {nextDue && (
            <> · 最近截止 <span className="num text-foreground">{nextDue}</span></>
          )}
        </div>
      </div>

      {/* 待你审核的交付物 —— 复核闭环入口 */}
      {pendingReviews.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-[11px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)]">
          <div className="flex items-center gap-1.5 border-b border-[color:var(--warning)] px-4 py-2">
            <ClipboardCheck size={13} className="text-[color:var(--warning)]" />
            <span className="text-[12.5px] font-semibold text-[color:var(--warning)]">待你审核的交付物</span>
            <span className="num text-[12px] text-[color:var(--warning)]">{pendingReviews.length}</span>
          </div>
          {pendingReviews.map((r) => (
            <div
              key={r.id}
              onClick={() => onSelectProject(r.projectId, { tab: 'tasks', phaseId: r.phaseId })}
              className="flex cursor-pointer items-center gap-3 border-b border-[color:var(--warning)]/40 px-4 py-2.5 transition-colors last:border-none hover:bg-[color:var(--warning-soft)]"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--warning)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-foreground">{r.deliverableName}</div>
                <div className="num mt-0.5 truncate text-[11px] text-muted-foreground">项目 {r.projectId} · {r.phaseId}</div>
              </div>
              <span className="shrink-0 text-[11px] font-medium text-[color:var(--warning)]">去审核 →</span>
            </div>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[11px] border border-border bg-card py-16 text-center">
          <Check size={26} className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">没有符合条件的任务</p>
        </div>
      ) : view === 'list' ? (
        <ListMode groups={groups} onToggle={handleToggle} onOpen={onSelectProject} />
      ) : (
        <BoardMode groups={groups} onToggle={handleToggle} onOpen={onSelectProject} />
      )}
    </div>
  );
}

type GroupWithItems = { key: string; label: string; tone: string; items: Task[] };

// ── List mode ─────────────────────────────────────────────────────────────────
function ListMode({ groups, onToggle, onOpen }: {
  groups: GroupWithItems[]; onToggle: (t: Task) => void; onOpen: (id: string, focus?: TaskFocus) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[11px] border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="sticky top-0 z-[1] flex items-center gap-2.5 border-b border-border bg-secondary px-4 py-2">
            <span className="h-[9px] w-[9px] rounded-full" style={{ background: g.tone }} />
            <span className="text-[12.5px] font-semibold text-foreground">{g.label}</span>
            <span className="num text-[12px] text-muted-foreground">{g.items.length}</span>
          </div>
          {g.items.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(t.projectId, { tab: 'tasks', phaseId: t.phaseId, taskId: t.taskId })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(t.projectId, { tab: 'tasks', phaseId: t.phaseId, taskId: t.taskId });
                }
              }}
              className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 transition-colors last:border-none hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset lg:grid lg:grid-cols-[18px_16px_1fr_auto_auto_24px] lg:gap-3"
            >
              <Checkbox checked={t.completed} onToggle={() => onToggle(t)} />
              <PriorityFlag priority={t.priority} />
              <div className="min-w-0 flex-1 lg:flex-none">
                <div className={cn('truncate text-[13.5px] font-medium', t.completed ? 'text-muted-foreground line-through' : 'text-foreground')}>
                  {t.name}
                </div>
                <div className="num mt-0.5 truncate text-[11px] text-muted-foreground">
                  {t.projectName} · {t.projectNumber} · {t.phaseLabel}
                </div>
              </div>
              {/* Right group: wraps to its own line on phone/tablet; restores inline desktop layout at lg */}
              <div className="flex w-full flex-wrap items-center justify-start gap-x-3 gap-y-1 pl-[34px] lg:contents lg:w-auto lg:pl-0">
                <span className="hidden items-center gap-1.5 rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-[color:var(--secondary-foreground)] sm:inline-flex">
                  <span className="h-1.5 w-1.5 rounded-[2px]" style={{ background: PRIORITY[t.priority].dot }} />
                  {PRIORITY[t.priority].label}优先级
                </span>
                <DueText task={t} className="text-[12px] lg:w-[88px] lg:text-right" />
                <Avatar label="我" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Board mode (one column per group) ─────────────────────────────────────────
function BoardMode({ groups, onToggle, onOpen }: {
  groups: GroupWithItems[]; onToggle: (t: Task) => void; onOpen: (id: string, focus?: TaskFocus) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col rounded-[12px] border border-border bg-[color:var(--secondary)]">
          <div className="flex items-center gap-2 px-3 pb-2.5 pt-3">
            <span className="h-[9px] w-[9px] rounded-full" style={{ background: g.tone }} />
            <span className="flex-1 text-[12.5px] font-semibold text-foreground">{g.label}</span>
            <span className="num rounded-full border border-border bg-card px-2 py-px text-[12px] text-muted-foreground">{g.items.length}</span>
          </div>
          <div className="flex flex-1 flex-col gap-2.5 px-2.5 pb-2.5">
            {g.items.map((t) => (
              <div
                key={t.id}
                onClick={() => onOpen(t.projectId, { tab: 'tasks', phaseId: t.phaseId, taskId: t.taskId })}
                className="cursor-pointer rounded-[9px] border border-border bg-card p-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-[box-shadow,border-color] hover:border-[color:var(--acc-border)] hover:shadow-[0_4px_14px_rgb(0_0_0/0.09)]"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <Checkbox checked={t.completed} onToggle={() => onToggle(t)} />
                  <PriorityFlag priority={t.priority} />
                  <span className="num truncate text-[10.5px] text-muted-foreground">{t.projectNumber} · {t.phaseLabel}</span>
                </div>
                <div className={cn('text-[13px] font-semibold leading-tight', t.completed ? 'text-muted-foreground line-through' : 'text-foreground')}>
                  {t.name}
                </div>
                <div className="mt-1 truncate text-[10.5px] text-muted-foreground">{t.projectName}</div>
                <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
                  <DueText task={t} className="text-[11px]" />
                  <Avatar label="我" size={22} />
                </div>
              </div>
            ))}
            {g.items.length === 0 && (
              <div className="flex items-center justify-center gap-1 py-4 text-[11px] text-muted-foreground">—</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
