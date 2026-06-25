// 看板视图：把项目所有 SOP 任务按系统状态分列，仅用于查看流转分布。
// Linear redesign — Phase 1 VISUAL. Presentation only; data flattening preserved.
import { Project, getProjectPhases } from '@/lib/data';

const COLUMNS: { status: string; label: string; tone: string }[] = [
  { status: 'todo', label: '待办', tone: 'var(--muted-foreground)' },
  { status: 'in_progress', label: '进行中', tone: 'var(--primary)' },
  { status: 'blocked', label: '阻塞', tone: 'var(--destructive)' },
  { status: 'pending_approval', label: '待审批', tone: 'var(--warning)' },
  { status: 'done', label: '完成', tone: 'var(--success)' },
  { status: 'skipped', label: '跳过', tone: 'var(--border)' },
];

const PRIORITY_DOT: Record<string, string> = {
  critical: 'var(--destructive)', high: 'var(--warning)', medium: 'var(--primary)', low: 'var(--muted-foreground)',
};

type Card = { phaseId: string; phaseName: string; taskId: string; name: string; status: string; priority: string };

export function KanbanBoard({ project }: { project: Project; onUpdate: (p: Project) => void; canEdit: boolean }) {
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

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-3 pb-2">
        {COLUMNS.map((col) => {
          const colCards = cards.filter((c) => c.status === col.status);
          return (
            <div
              key={col.status}
              className="flex w-60 shrink-0 flex-col rounded-[12px] border border-border bg-[color:var(--secondary)]"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <span className="h-[9px] w-[9px] rounded-full" style={{ background: col.tone }} />
                  {col.label}
                </span>
                <span className="num rounded-full border border-border bg-card px-2 py-px text-[11px] text-muted-foreground">{colCards.length}</span>
              </div>
              <div className="min-h-[120px] space-y-2 p-2">
                {colCards.map((c) => (
                  <div
                    key={`${c.phaseId}/${c.taskId}`}
                    className="rounded-[9px] border border-border bg-card p-2.5 text-sm shadow-[0_1px_2px_rgb(0_0_0/0.03)]"
                  >
                    <div className="flex items-start gap-1.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PRIORITY_DOT[c.priority] || 'var(--muted-foreground)' }} />
                      <span className="leading-snug text-foreground">{c.name}</span>
                    </div>
                    <div className="mt-1.5 pl-3 text-[10px] text-muted-foreground">{c.phaseName}</div>
                  </div>
                ))}
                {colCards.length === 0 && <div className="py-4 text-center text-[11px] text-muted-foreground/60">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
