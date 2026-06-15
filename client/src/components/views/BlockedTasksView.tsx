/**
 * BlockedTasksView – shows all tasks with status = 'blocked'.
 * Ordered by priority (critical→low) then projectId.
 * Admin sees all projects; regular users see only their accessible projects.
 * Helps PM identify who to follow up with.
 */
import { ShieldAlert } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { TaskListView, type TaskRow } from './TaskListView';
import type { TaskStatus, TaskPriority } from '@shared/const';

interface BlockedTasksViewProps {
  onNavigateToProject?: (projectId: string) => void;
}

export function BlockedTasksView({ onNavigateToProject }: BlockedTasksViewProps) {
  const { data = [], isLoading, refetch } = trpc.tasks.blocked.useQuery(undefined, {
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

  // Group by project for PM overview
  const projectGroups = tasks.reduce<Record<string, { count: number; critical: number }>>((acc, t) => {
    if (!acc[t.projectName]) acc[t.projectName] = { count: 0, critical: 0 };
    acc[t.projectName].count++;
    if (t.priority === 'critical') acc[t.projectName].critical++;
    return acc;
  }, {});

  return (
    <div className="ce-page">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-orange-500" />
          <h2 className="font-serif text-xl text-stone-900 leading-tight">阻塞任务</h2>
        </div>
        <p className="ce-kicker mt-1">
          Blocked Tasks · 状态为"已阻塞"的任务，PM 需跟进解除阻塞
        </p>
      </div>

      {/* PM overview: which projects have blocked tasks */}
      {!isLoading && Object.keys(projectGroups).length > 0 && (
        <div className="ce-panel p-3 bg-orange-50/80 border-orange-200">
          <div className="text-[9px] font-mono uppercase tracking-widest text-orange-400 mb-2">阻塞任务分布（PM 催进）</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(projectGroups).map(([name, { count, critical }]) => (
              <span key={name} className={`px-2 py-0.5 text-[10px] font-mono bg-white border ${critical > 0 ? 'border-red-300 text-red-700' : 'border-orange-200 text-orange-700'}`}>
                {name} · {count}{critical > 0 ? ` (${critical} 紧急)` : ''}
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
          emptyIcon={<ShieldAlert size={24} />}
          emptyTitle="没有阻塞任务"
          emptyDesc="当前没有状态为「已阻塞」的任务，项目推进顺畅！"
          onRefetch={() => refetch()}
          onNavigateToProject={onNavigateToProject}
          showAssignee
        />
      </div>
    </div>
  );
}
