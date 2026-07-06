// 看板视图：把项目所有 SOP 任务按系统状态归入 3 列（待办 / 进行中 / 已完成），仅用于查看流转分布。
// Linear redesign — 富卡片（名称 + 负责人头像 + 截止），列高上限内部滚动。Presentation only。
import { Project, getProjectPhases } from '@/lib/data';
import { trpc } from '@/lib/trpc';

// 状态徽标：阻塞 / 待审批 / 跳过。done 列内的常规完成无徽标。
const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  blocked: { label: '阻塞', color: 'var(--destructive)' },
  pending_approval: { label: '待审批', color: 'var(--warning)' },
  skipped: { label: '跳过', color: 'var(--muted-foreground)' },
};

type Card = {
  phaseId: string;
  phaseName: string;
  taskId: string;
  name: string;
  status: string;
  assigneeUserId: number | null | undefined;
  dueDate: string | null | undefined;
};

type Column = { key: string; label: string; tone: string; statuses: string[] };

const COLUMNS: Column[] = [
  { key: 'todo', label: '待办', tone: 'var(--muted-foreground)', statuses: ['todo'] },
  { key: 'in_progress', label: '进行中', tone: 'var(--primary)', statuses: ['in_progress', 'blocked', 'pending_approval'] },
  { key: 'done', label: '已完成', tone: 'var(--success)', statuses: ['done', 'skipped'] },
];

function formatDue(due: string | null | undefined): string | null {
  if (!due) return null;
  // 期望 YYYY-MM-DD → MM-DD
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(due);
  if (m) return `${m[1]}-${m[2]}`;
  return due;
}

function Avatar({ name }: { name: string }) {
  const ch = (name || '?').trim().charAt(0) || '?';
  // 由名字派生一个稳定的色相，保证不同负责人头像颜色稳定区分。
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
      style={{ background: `hsl(${hash} 55% 50%)` }}
      title={name}
    >
      {ch}
    </span>
  );
}

export function KanbanBoard({ project, phaseFilter }: { project: Project; onUpdate: (p: Project) => void; canEdit: boolean; phaseFilter?: string }) {
  const { data: users = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const nameById = new Map<number, string>();
  for (const u of users) nameById.set(u.id, u.name || u.username || `#${u.id}`);

  // 把所有阶段的任务摊平成卡片（phaseFilter 指定单阶段时只取该阶段）
  const cards: Card[] = [];
  for (const phase of getProjectPhases(project)) {
    if (phaseFilter && phaseFilter !== 'all' && phase.id !== phaseFilter) continue;
    const pd = project.phases[phase.id];
    for (const task of phase.tasks) {
      const det = pd?.taskDetails?.[task.id];
      cards.push({
        phaseId: phase.id,
        phaseName: phase.name,
        taskId: task.id,
        name: task.name,
        status: det?.taskStatus || 'todo',
        assigneeUserId: det?.assigneeUserId,
        dueDate: det?.dueDate,
      });
    }
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-3 pb-2">
        {COLUMNS.map((col) => {
          const colCards = cards.filter((c) => col.statuses.includes(c.status));
          return (
            <div
              key={col.key}
              className="flex w-72 shrink-0 flex-col rounded-[10px] border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <span className="h-[9px] w-[9px] rounded-full" style={{ background: col.tone }} />
                  {col.label}
                </span>
                <span className="num rounded-full border border-border bg-secondary px-2 py-px text-[11px] text-muted-foreground">
                  {colCards.length}
                </span>
              </div>
              <div className="max-h-[560px] space-y-2 overflow-y-auto bg-secondary/40 p-2">
                {colCards.map((c) => {
                  const badge = STATUS_BADGE[c.status];
                  const assigneeName = c.assigneeUserId != null ? nameById.get(c.assigneeUserId) : undefined;
                  const due = formatDue(c.dueDate);
                  return (
                    <div
                      key={`${c.phaseId}/${c.taskId}`}
                      className="rounded-[10px] border border-border bg-card p-3 text-sm shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-colors hover:border-[color:var(--acc-border)] hover:bg-secondary/40"
                    >
                      <div className="flex items-start gap-1.5">
                        {badge && (
                          <span
                            className="mt-0.5 shrink-0 rounded px-1.5 py-px text-[10px] font-medium leading-tight text-white"
                            style={{ background: badge.color }}
                          >
                            {badge.label}
                          </span>
                        )}
                        <span className="leading-snug text-foreground">{c.name}</span>
                      </div>
                      <div className="mt-1 text-[10px] num uppercase tracking-wider text-muted-foreground">{c.phaseName} · {c.taskId}</div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {assigneeName ? (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Avatar name={assigneeName} />
                            <span className="truncate text-[11px] text-muted-foreground">{assigneeName}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60">未指派</span>
                        )}
                        {due && <span className="num shrink-0 text-[11px] text-muted-foreground">{due}</span>}
                      </div>
                    </div>
                  );
                })}
                {colCards.length === 0 && (
                  <div className="py-6 text-center text-[11px] text-muted-foreground/60">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
