/**
 * OverdueTasksView – shows all tasks where dueDate < today and status != done.
 * Ordered by dueDate ASC (most overdue first).
 * Admin sees all projects; regular users see only their accessible projects.
 */
import { AlertTriangle } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { TaskListView, type TaskRow } from './TaskListView';
import type { TaskStatus, TaskPriority } from '@shared/const';

interface OverdueTasksViewProps {
  onNavigateToProject?: (projectId: string) => void;
}

export function OverdueTasksView({ onNavigateToProject }: OverdueTasksViewProps) {
  const { data = [], isLoading, refetch } = trpc.tasks.overdue.useQuery(undefined, {
    staleTime: 60_000,
  });

  const tasks: TaskRow[] = data.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    phaseId: t.phaseId,
    taskId: t.taskId,
    projectName: t.projectName,
    projectNumber: t.projectNumber,
    projectCategory: t.projectCategory,
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    dueDate: t.dueDate ? String(t.dueDate) : null,
    assigneeUserId: t.assigneeUserId ?? null,
    completed: t.completed,
  }));

  // Group by project for summary
  const projectGroups = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.projectName] = (acc[t.projectName] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="ce-page">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-500" />
          <h2 className="font-serif text-xl text-stone-900 leading-tight">逾期任务</h2>
        </div>
        <p className="ce-kicker mt-1">
          Overdue Tasks · 截止日期已过且未完成的任务
        </p>
      </div>

      {/* Project breakdown */}
      {!isLoading && Object.keys(projectGroups).length > 0 && (
        <div className="ce-panel p-3 bg-red-50/80 border-red-200">
          <div className="text-[9px] font-mono uppercase tracking-widest text-red-400 mb-2">逾期任务分布</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(projectGroups).map(([name, count]) => (
              <span key={name} className="px-2 py-0.5 text-[10px] font-mono bg-white border border-red-200 text-red-700">
                {name} · {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="ce-table-shell">
        <TaskListView
          tasks={tasks}
          isLoading={isLoading}
          emptyIcon={<AlertTriangle size={24} />}
          emptyTitle="没有逾期任务"
          emptyDesc="所有任务都在截止日期内，项目进展顺利！"
          onRefetch={() => refetch()}
          onNavigateToProject={onNavigateToProject}
          showOverdueBadge
          showAssignee
        />
      </div>
    </div>
  );
}
