// 看板拖拽视图：把项目所有 SOP 任务按状态分列，拖拽改状态（复用 onUpdate→setMeta 保存路径）。
import { useState } from 'react';
import { Project, TaskDetails, getProjectPhases } from '@/lib/data';

const COLUMNS: { status: string; label: string; accent: string }[] = [
  { status: 'todo', label: '待办', accent: 'border-t-stone-400' },
  { status: 'in_progress', label: '进行中', accent: 'border-t-blue-400' },
  { status: 'blocked', label: '阻塞', accent: 'border-t-rose-400' },
  { status: 'done', label: '完成', accent: 'border-t-emerald-400' },
  { status: 'skipped', label: '跳过', accent: 'border-t-stone-300' },
];

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-rose-500', high: 'bg-amber-500', medium: 'bg-stone-400', low: 'bg-stone-300',
};

type Card = { phaseId: string; phaseName: string; taskId: string; name: string; status: string; priority: string };

export function KanbanBoard({ project, onUpdate, canEdit }: { project: Project; onUpdate: (p: Project) => void; canEdit: boolean }) {
  const [dragOver, setDragOver] = useState<string | null>(null);

  // 把所有阶段的任务摊平成卡片
  const cards: Card[] = [];
  for (const phase of getProjectPhases(project)) {
    const pd = project.phases[phase.id];
    for (const task of phase.tasks) {
      const det = pd?.taskDetails?.[task.id];
      cards.push({
        phaseId: phase.id, phaseName: phase.name, taskId: task.id, name: task.name,
        status: det?.taskStatus || 'todo',
        priority: det?.taskPriority || 'medium',
      });
    }
  }

  const moveTask = (phaseId: string, taskId: string, newStatus: string) => {
    if (!canEdit) return;
    const newProject: Project = { ...project, phases: { ...project.phases } };
    const pd = newProject.phases[phaseId] || { tasks: {}, taskDetails: {}, notes: '' };
    const existing: TaskDetails = pd.taskDetails?.[taskId] || { instructions: '', files: [] };
    newProject.phases[phaseId] = {
      ...pd,
      taskDetails: { ...pd.taskDetails, [taskId]: { ...existing, taskStatus: newStatus } },
    };
    onUpdate(newProject);
  };

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 min-w-max pb-2">
        {COLUMNS.map((col) => {
          const colCards = cards.filter((c) => c.status === col.status);
          return (
            <div
              key={col.status}
              onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(col.status); } }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(null);
                const raw = e.dataTransfer.getData('text/plain');
                if (!raw) return;
                const { phaseId, taskId } = JSON.parse(raw);
                moveTask(phaseId, taskId, col.status);
              }}
              className={`w-60 shrink-0 bg-stone-50 border-t-2 ${col.accent} border border-stone-200 ${dragOver === col.status ? 'ring-2 ring-amber-300' : ''}`}
            >
              <div className="px-3 py-2 flex items-center justify-between border-b border-stone-100">
                <span className="text-xs font-medium text-stone-700">{col.label}</span>
                <span className="text-[10px] font-mono text-stone-400">{colCards.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[120px]">
                {colCards.map((c) => (
                  <div
                    key={`${c.phaseId}/${c.taskId}`}
                    draggable={canEdit}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ phaseId: c.phaseId, taskId: c.taskId }))}
                    className={`bg-white border border-stone-200 p-2.5 text-sm ${canEdit ? 'cursor-grab active:cursor-grabbing hover:border-stone-400' : ''} transition-colors`}
                  >
                    <div className="flex items-start gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[c.priority] || 'bg-stone-400'}`} />
                      <span className="text-stone-800 leading-snug">{c.name}</span>
                    </div>
                    <div className="text-[10px] font-mono text-stone-400 mt-1.5 pl-3">{c.phaseName}</div>
                  </div>
                ))}
                {colCards.length === 0 && <div className="text-[11px] text-stone-300 text-center py-4">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
