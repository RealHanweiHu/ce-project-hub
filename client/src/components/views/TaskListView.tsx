/**
 * TaskListView – reusable task list table used by PerspectivePanel (我的视角)
 * and OverviewPage's drill-down drawer.
 * Displays tasks with project context, priority badge, status badge, assignee, and due date.
 * Status is system-derived from dependencies, schedule, and completion.
 */
import {
  AlertTriangle, Calendar, ChevronRight, RefreshCw, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toLocalISODate } from '@/lib/utils';
import { TASK_STATUS_UI, TASK_PRIORITY_UI } from '@/lib/task-ui';
import { type TaskStatus, type TaskPriority } from '@shared/const';
import type { ProjectTemplateLike } from '@shared/npd-v3';
import { resolveProjectPhase, resolveTaskName } from '@shared/sop-template-resolution';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskRow {
  id: number;
  projectId: string;
  phaseId: string;
  taskId: string;
  projectName: string;
  projectNumber: string;
  projectCategory: string;
  sopTemplateVersion?: string | null;
  customFields?: unknown;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeUserId: number | null;
  completed: boolean;
}

/** Deep-link target: open a project at a specific tab/phase with an optional task detail expanded. */
export type TaskFocus = {
  tab?: 'overview' | 'tasks' | 'reviews' | 'materials' | 'activity' | 'metrics' | 'kanban' | 'requirements' | 'gantt' | 'issues' | 'changelog' | 'bom' | 'files';
  phaseId?: string;
  taskId?: string;
  taskTab?: 'comments' | 'activity' | 'flow' | 'approval';
};

interface TaskListViewProps {
  tasks: TaskRow[];
  isLoading: boolean;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptyDesc: string;
  onRefetch: () => void;
  onNavigateToProject?: (projectId: string, focus?: TaskFocus) => void;
  /** Show overdue indicator */
  showOverdueBadge?: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

// 状态/优先级展示口径统一从 lib/task-ui 引入（全站单一定义，B8 收敛）
const STATUS_CONFIG = TASK_STATUS_UI;
const PRIORITY_CONFIG = TASK_PRIORITY_UI;

// ─── Project-bound template context ─────────────────────────────────────────

export function taskProjectLike(task: Pick<TaskRow, 'projectCategory' | 'sopTemplateVersion' | 'customFields'>): ProjectTemplateLike {
  return {
    category: task.projectCategory,
    sopTemplateVersion: task.sopTemplateVersion,
    customFields: task.customFields,
  };
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return dueDate < toLocalISODate();
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ value }: { value: TaskStatus }) {
  const cfg = STATUS_CONFIG[value] ?? STATUS_CONFIG.todo;
  return (
    <span
      className="inline-flex h-6 w-28 items-center justify-center rounded-[6px] border px-2 text-[11px] font-medium"
      style={{ color: cfg.tone.color, background: cfg.tone.bg, borderColor: cfg.tone.border }}
    >
      {cfg.label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TaskListView({
  tasks,
  isLoading,
  emptyIcon,
  emptyTitle,
  emptyDesc,
  onRefetch,
  onNavigateToProject,
  showOverdueBadge = false,
}: TaskListViewProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
        <span className="ml-3 text-sm text-muted-foreground">加载中…</span>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[10px] bg-secondary text-muted-foreground">
          {emptyIcon}
        </div>
        <h3 className="mb-1 text-sm font-semibold text-foreground">{emptyTitle}</h3>
        <p className="max-w-xs text-xs text-muted-foreground">{emptyDesc}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 text-xs"
          onClick={onRefetch}
        >
          <RefreshCw size={12} className="mr-1.5" />刷新
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[680px]">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 border-b border-border bg-secondary px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>任务 / 项目</span>
        <span className="w-28 text-center">状态</span>
        <span className="w-16 text-center">优先级</span>
        <span className="w-24 text-center">截止日期</span>
        <span className="w-6" />
      </div>

      {/* Rows */}
      {tasks.map((task) => {
        const projectLike = taskProjectLike(task);
        const taskName = resolveTaskName(projectLike, task.taskId, task.phaseId);
        const phase = resolveProjectPhase(projectLike, task.phaseId);
        const phaseLabel = phase ? `${phase.code} ${phase.name}` : task.phaseId;
        const overdue = showOverdueBadge && isOverdue(task.dueDate);
        const priorityCfg = PRIORITY_CONFIG[task.priority];

        return (
          <div
            key={task.id}
            onClick={onNavigateToProject ? () => onNavigateToProject(task.projectId, { phaseId: task.phaseId, taskId: task.taskId }) : undefined}
            className={`group grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 border-b border-border px-3 py-3 transition-colors hover:bg-secondary ${
              onNavigateToProject ? 'cursor-pointer' : ''
            }`}
            style={overdue ? { background: 'color-mix(in srgb, var(--destructive) 5%, transparent)' } : undefined}
          >
            {/* Task name + project context */}
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                {overdue && (
                  <AlertTriangle size={11} className="shrink-0" style={{ color: 'var(--destructive)' }} />
                )}
                <span className="truncate text-xs font-medium text-foreground">{taskName}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="num truncate text-[10px] text-muted-foreground">
                  {task.projectNumber} · {task.projectName}
                </span>
                <span className="text-[9px] text-muted-foreground/60">·</span>
                <span className="num truncate text-[10px] text-muted-foreground">{phaseLabel}</span>
              </div>
            </div>

            {/* System status */}
            <div className="w-28">
              <StatusBadge value={task.status} />
            </div>

            {/* Priority badge */}
            <div className="flex w-16 justify-center">
              <span
                className="inline-flex items-center gap-1 rounded-[6px] border px-1.5 py-0.5 text-[10px] font-medium"
                style={{ color: priorityCfg.tone.color, background: priorityCfg.tone.bg, borderColor: priorityCfg.tone.border }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: priorityCfg.dot }} />
                {priorityCfg.label}
              </span>
            </div>

            {/* Due date */}
            <div className="flex w-24 items-center justify-center gap-1">
              {task.dueDate ? (
                <span
                  className="num flex items-center gap-1 text-[10px]"
                  style={{ color: overdue ? 'var(--destructive)' : 'var(--muted-foreground)', fontWeight: overdue ? 600 : 400 }}
                >
                  <Calendar size={10} />
                  {task.dueDate}
                </span>
              ) : (
                <span className="num text-[10px] text-muted-foreground/60">—</span>
              )}
            </div>

            {/* Navigate to project */}
            <div className="flex w-6 justify-center">
              {onNavigateToProject && (
                <button
                  onClick={(e) => { e.stopPropagation(); onNavigateToProject(task.projectId, { phaseId: task.phaseId, taskId: task.taskId }); }}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                  title={`打开任务 ${taskName}`}
                >
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 text-[10px] text-muted-foreground">
        <span className="num">{tasks.length} 条任务</span>
        <button
          onClick={onRefetch}
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <RefreshCw size={10} />刷新
        </button>
      </div>
      </div>
    </div>
  );
}
