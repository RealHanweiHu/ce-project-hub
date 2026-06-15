/**
 * TaskListView – reusable task list table used by MyTasksView, OverdueTasksView, BlockedTasksView.
 * Displays tasks with project context, priority badge, status badge, assignee, and due date.
 * Allows inline status/priority updates via trpc.tasks.setMeta.
 */
import { useState } from 'react';
import {
  AlertTriangle, Calendar, User, ChevronRight, RefreshCw,
  Clock, Flag, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/trpc';
import { getPhasesForCategory } from '@/lib/sop-templates';
import { TASK_STATUSES, TASK_PRIORITIES, type TaskStatus, type TaskPriority } from '@shared/const';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskRow {
  id: number;
  projectId: string;
  phaseId: string;
  taskId: string;
  projectName: string;
  projectNumber: string;
  projectCategory: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeUserId: number | null;
  completed: boolean;
}

interface TaskListViewProps {
  tasks: TaskRow[];
  isLoading: boolean;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptyDesc: string;
  onRefetch: () => void;
  onNavigateToProject?: (projectId: string) => void;
  /** Show assignee column (for overdue/blocked views where PM needs to see who owns it) */
  showAssignee?: boolean;
  /** Show overdue indicator */
  showOverdueBadge?: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  todo:        { label: '待处理',  color: 'bg-stone-100 text-stone-600 border-stone-200' },
  in_progress: { label: '进行中',  color: 'bg-blue-50 text-blue-700 border-blue-200' },
  blocked:     { label: '已阻塞',  color: 'bg-red-50 text-red-700 border-red-200' },
  done:        { label: '已完成',  color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  skipped:     { label: '已跳过',  color: 'bg-stone-50 text-stone-400 border-stone-200' },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; dot: string }> = {
  critical: { label: '紧急', color: 'bg-red-100 text-red-800 border-red-300',    dot: 'bg-red-500' },
  high:     { label: '高',   color: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-500' },
  medium:   { label: '中',   color: 'bg-amber-100 text-amber-800 border-amber-300',    dot: 'bg-amber-500' },
  low:      { label: '低',   color: 'bg-stone-100 text-stone-600 border-stone-200',    dot: 'bg-stone-400' },
};

// ─── Helper: resolve task display name from SOP template ─────────────────────

function resolveTaskName(taskId: string, phaseId: string, category: string): string {
  try {
    const phases = getPhasesForCategory(category);
    const phase = phases.find((p) => p.id === phaseId);
    if (!phase) return taskId;
    const task = phase.tasks.find((t) => t.id === taskId);
    return task?.name ?? taskId;
  } catch {
    return taskId;
  }
}

function resolvePhaseLabel(phaseId: string, category: string): string {
  try {
    const phases = getPhasesForCategory(category);
    const phase = phases.find((p) => p.id === phaseId);
    return phase ? `${phase.code} ${phase.name}` : phaseId;
  } catch {
    return phaseId;
  }
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

// ─── Inline Status Selector ───────────────────────────────────────────────────

function StatusSelector({
  value,
  projectId,
  phaseId,
  taskId,
  onSuccess,
}: {
  value: TaskStatus;
  projectId: string;
  phaseId: string;
  taskId: string;
  onSuccess: () => void;
}) {
  const utils = trpc.useUtils();
  const setMeta = trpc.tasks.setMeta.useMutation({
    onSuccess: () => {
      utils.tasks.myTasks.invalidate();
      utils.tasks.overdue.invalidate();
      utils.tasks.blocked.invalidate();
      onSuccess();
    },
  });

  return (
    <Select
      value={value}
      onValueChange={(v) =>
        setMeta.mutate({ projectId, phaseId, taskId, status: v as TaskStatus })
      }
    >
      <SelectTrigger
        className={`h-6 text-[11px] font-mono border px-2 py-0 w-28 ${STATUS_CONFIG[value].color}`}
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {STATUS_CONFIG[s].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  showAssignee = false,
  showOverdueBadge = false,
}: TaskListViewProps) {
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-stone-400" />
        <span className="ml-3 text-sm font-mono text-stone-400 uppercase tracking-widest">Loading...</span>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 bg-stone-100 flex items-center justify-center mb-4 text-stone-400">
          {emptyIcon}
        </div>
        <h3 className="text-sm font-serif text-stone-700 mb-1">{emptyTitle}</h3>
        <p className="text-xs font-mono text-stone-400 max-w-xs">{emptyDesc}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 text-xs font-mono uppercase tracking-wider"
          onClick={onRefetch}
        >
          <RefreshCw size={12} className="mr-1.5" />刷新
        </Button>
      </div>
    );
  }

  return (
    <div className="ce-scroll-x">
      <div className="min-w-[680px]">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 bg-stone-50/80 px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-400 border-b border-stone-200">
        <span>任务 / 项目</span>
        <span className="w-28 text-center">状态</span>
        <span className="w-16 text-center">优先级</span>
        <span className="w-24 text-center">截止日期</span>
        <span className="w-6" />
      </div>

      {/* Rows */}
      {tasks.map((task) => {
        const taskName = resolveTaskName(task.taskId, task.phaseId, task.projectCategory);
        const phaseLabel = resolvePhaseLabel(task.phaseId, task.projectCategory);
        const overdue = showOverdueBadge && isOverdue(task.dueDate);
        const priorityCfg = PRIORITY_CONFIG[task.priority];
        const isUpdating = updatingId === task.id;

        return (
          <div
            key={task.id}
            className={`grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-3 items-center border-b border-stone-100 hover:bg-stone-50/70 transition-colors group ${
              overdue ? 'bg-red-50/30' : ''
            }`}
          >
            {/* Task name + project context */}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                {overdue && (
                  <AlertTriangle size={11} className="text-red-500 shrink-0" />
                )}
                <span className="text-xs text-stone-800 font-medium truncate">{taskName}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-mono text-stone-400 truncate">
                  {task.projectNumber} · {task.projectName}
                </span>
                <span className="text-[9px] font-mono text-stone-300">·</span>
                <span className="text-[10px] font-mono text-stone-400 truncate">{phaseLabel}</span>
              </div>
            </div>

            {/* Status selector */}
            <div className="w-28">
              <StatusSelector
                value={task.status}
                projectId={task.projectId}
                phaseId={task.phaseId}
                taskId={task.taskId}
                onSuccess={() => setUpdatingId(null)}
              />
            </div>

            {/* Priority badge */}
            <div className="w-16 flex justify-center">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono border rounded-sm ${priorityCfg.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${priorityCfg.dot}`} />
                {priorityCfg.label}
              </span>
            </div>

            {/* Due date */}
            <div className="w-24 flex items-center justify-center gap-1">
              {task.dueDate ? (
                <span className={`flex items-center gap-1 text-[10px] font-mono ${overdue ? 'text-red-600 font-semibold' : 'text-stone-500'}`}>
                  <Calendar size={10} />
                  {task.dueDate}
                </span>
              ) : (
                <span className="text-[10px] font-mono text-stone-300">—</span>
              )}
            </div>

            {/* Navigate to project */}
            <div className="w-6 flex justify-center">
              {onNavigateToProject && (
                <button
                  onClick={() => onNavigateToProject(task.projectId)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-400 hover:text-amber-600"
                  title={`打开项目 ${task.projectName}`}
                >
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 text-[10px] font-mono text-stone-400">
        <span>{tasks.length} 条任务</span>
        <button
          onClick={onRefetch}
          className="flex items-center gap-1 hover:text-stone-600 transition-colors"
        >
          <RefreshCw size={10} />刷新
        </button>
      </div>
      </div>
    </div>
  );
}
