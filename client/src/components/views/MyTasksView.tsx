/**
 * MyTasksView – shows all non-done tasks assigned to the current user,
 * ordered by priority then due date.
 */
import { CheckCircle2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { TaskListView, type TaskRow } from './TaskListView';
import type { TaskStatus, TaskPriority } from '@shared/const';

interface MyTasksViewProps {
  onNavigateToProject?: (projectId: string) => void;
}

export function MyTasksView({ onNavigateToProject }: MyTasksViewProps) {
  const { data = [], isLoading, refetch } = trpc.tasks.myTasks.useQuery(undefined, {
    staleTime: 30_000,
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

  return (
    <div className="ce-page">
      {/* Page header */}
      <div>
        <h2 className="font-serif text-xl text-stone-900 leading-tight">我的任务</h2>
        <p className="ce-kicker mt-1">
          My Tasks · 指派给我的所有未完成任务
        </p>
      </div>

      {/* Summary chips */}
      {!isLoading && data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(['critical', 'high', 'medium', 'low'] as const).map((p) => {
            const count = tasks.filter((t) => t.priority === p).length;
            if (count === 0) return null;
            const colors: Record<string, string> = {
              critical: 'bg-red-100 text-red-800 border-red-300',
              high: 'bg-orange-100 text-orange-800 border-orange-300',
              medium: 'bg-amber-100 text-amber-800 border-amber-300',
              low: 'bg-stone-100 text-stone-600 border-stone-200',
            };
            const labels: Record<string, string> = { critical: '紧急', high: '高', medium: '中', low: '低' };
            return (
              <span key={p} className={`px-2 py-0.5 text-[10px] font-mono border rounded-sm ${colors[p]}`}>
                {labels[p]} {count}
              </span>
            );
          })}
          {tasks.filter((t) => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-mono border rounded-sm bg-red-50 text-red-700 border-red-200">
              ⚠ 已逾期 {tasks.filter((t) => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length}
            </span>
          )}
        </div>
      )}

      {/* Task list */}
      <div className="ce-table-shell">
        <TaskListView
          tasks={tasks}
          isLoading={isLoading}
          emptyIcon={<CheckCircle2 size={24} />}
          emptyTitle="暂无待办任务"
          emptyDesc="当前没有指派给您的未完成任务，继续保持！"
          onRefetch={() => refetch()}
          onNavigateToProject={onNavigateToProject}
          showOverdueBadge
        />
      </div>
    </div>
  );
}
