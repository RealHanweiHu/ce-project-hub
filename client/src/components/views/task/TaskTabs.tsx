// Task-detail modal — 活动 / 流转 / 状态审批 三个标签页内容。
// 评论 tab 仍由 ProjectDetailView 直接挂 CommentThread，不在此文件。
// 这些组件只读地消费 trpc.tasks.activity，并把 userId 解析为人名。
import { trpc } from '@/lib/trpc';
import { Check, X as XIcon, Clock, RotateCcw, Send, FileEdit } from 'lucide-react';
import { useState } from 'react';

// ── 共享：activity 行类型 ─────────────────────────────────────────────────────
interface ActivityRow {
  action: string;
  userId: number | null;
  meta: Record<string, any> | null;
  createdAt: string | Date;
}

type UserLite = { id: number; name?: string | null; username?: string | null };

function resolveName(userId: number | null | undefined, users: UserLite[]): string {
  if (userId == null) return '系统';
  const u = users.find((x) => x.id === userId);
  return u?.name || u?.username || `用户#${userId}`;
}

function relativeTime(ts: string | Date): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return d.toLocaleDateString('zh-CN');
}

const ACTION_LABELS: Record<string, string> = {
  'task.complete': '标记完成',
  'task.uncomplete': '取消完成/撤回',
  'task.submit_approval': '提交审批',
  'task.approve': '审批通过',
  'task.reject': '审批驳回',
  'task.update_meta': '更新属性',
  'task.update_deliverable': '交付物变更',
  'task.update_instructions': '编辑执行说明',
  'task.update_visible_roles': '调整可见岗位',
};

const STATUS_ACTIONS = new Set([
  'task.complete',
  'task.uncomplete',
  'task.submit_approval',
  'task.approve',
  'task.reject',
]);

// ── 活动 tab：全部活动时间线（只读） ─────────────────────────────────────────
export function TaskActivityTab({
  projectId, phaseId, taskId, users,
}: {
  projectId: string; phaseId: string; taskId: string; users: UserLite[];
}) {
  const { data: rows = [], isLoading } = trpc.tasks.activity.useQuery(
    { projectId, phaseId, taskId },
    { staleTime: 10_000 },
  ) as { data: ActivityRow[] | undefined; isLoading: boolean };

  if (isLoading) return <div className="text-xs text-muted-foreground py-3">加载中…</div>;
  if (rows.length === 0) return <div className="text-xs text-muted-foreground py-3">暂无活动记录。</div>;

  return (
    <ul className="space-y-3 py-1">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start gap-2.5 text-xs">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--acc-border)]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-medium text-foreground">{resolveName(r.userId, users)}</span>
              <span className="text-muted-foreground">{ACTION_LABELS[r.action] ?? r.action}</span>
              <span className="text-[10px] text-muted-foreground">· {relativeTime(r.createdAt)}</span>
            </div>
            {r.meta?.note && (
              <div className="mt-0.5 text-muted-foreground italic">「{r.meta.note}」</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── 流转 tab：状态时间线（仅完成/取消/提交/通过/驳回） ────────────────────────
function statusActionIcon(action: string) {
  switch (action) {
    case 'task.complete': return <Check size={12} className="text-emerald-600" />;
    case 'task.uncomplete': return <RotateCcw size={12} className="text-muted-foreground" />;
    case 'task.submit_approval': return <Send size={12} className="text-[color:var(--warning)]" />;
    case 'task.approve': return <Check size={12} className="text-emerald-600" />;
    case 'task.reject': return <XIcon size={12} className="text-rose-600" />;
    default: return <FileEdit size={12} className="text-muted-foreground" />;
  }
}

export function TaskFlowTab({
  projectId, phaseId, taskId, users,
}: {
  projectId: string; phaseId: string; taskId: string; users: UserLite[];
}) {
  const { data: rows = [], isLoading } = trpc.tasks.activity.useQuery(
    { projectId, phaseId, taskId },
    { staleTime: 10_000 },
  ) as { data: ActivityRow[] | undefined; isLoading: boolean };

  const flow = rows.filter((r) => STATUS_ACTIONS.has(r.action));

  if (isLoading) return <div className="text-xs text-muted-foreground py-3">加载中…</div>;
  if (flow.length === 0) return <div className="text-xs text-muted-foreground py-3">暂无状态流转。</div>;

  return (
    <ol className="relative py-1">
      {flow.map((r, i) => {
        const fromTo = r.meta?.from && r.meta?.to ? `${r.meta.from} → ${r.meta.to}` : null;
        return (
          <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
            {i < flow.length - 1 && (
              <span className="absolute left-[9px] top-5 bottom-0 w-px bg-border" />
            )}
            <span className="relative z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border bg-card">
              {statusActionIcon(r.action)}
            </span>
            <div className="min-w-0 flex-1 text-xs">
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-medium text-foreground">{ACTION_LABELS[r.action] ?? r.action}</span>
                {fromTo && <span className="text-[10px] text-muted-foreground">{fromTo}</span>}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {resolveName(r.userId, users)} · {relativeTime(r.createdAt)}
              </div>
              {r.meta?.note && (
                <div className="mt-0.5 text-muted-foreground italic">「{r.meta.note}」</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── 状态审批 tab：当前审批态 + 裁决（审批人/管理员）+ 历史 ──────────────────────
const APPROVAL_STATUS_LABEL: Record<string, string> = {
  none: '未启用',
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
};

const APPROVAL_STATUS_CLASS: Record<string, string> = {
  none: 'bg-secondary text-muted-foreground border-border',
  pending: 'bg-[color:var(--acc-soft)] text-[color:var(--warning)] border-[color:var(--acc-border)]',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function TaskApprovalTab({
  projectId, phaseId, taskId, users,
  approvalStatus, approverUserId, approvalNote,
  canDecide,
}: {
  projectId: string; phaseId: string; taskId: string; users: UserLite[];
  approvalStatus: string;
  approverUserId: number | null | undefined;
  approvalNote: string | null | undefined;
  canDecide: boolean;
}) {
  const utils = trpc.useUtils();
  const [note, setNote] = useState('');
  const decide = trpc.tasks.decideApproval.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate({ projectId });
      utils.projects.get.invalidate({ id: projectId });
      utils.tasks.activity.invalidate({ projectId, phaseId, taskId });
      setNote('');
    },
  });

  const { data: rows = [] } = trpc.tasks.activity.useQuery(
    { projectId, phaseId, taskId },
    { staleTime: 10_000 },
  ) as { data: ActivityRow[] | undefined };

  const history = rows.filter((r) =>
    r.action === 'task.submit_approval' || r.action === 'task.approve' || r.action === 'task.reject',
  );

  const status = approvalStatus || 'none';

  return (
    <div className="space-y-4 py-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded border px-2 py-0.5 ${APPROVAL_STATUS_CLASS[status] ?? APPROVAL_STATUS_CLASS.none}`}>
          {APPROVAL_STATUS_LABEL[status] ?? status}
        </span>
        <span className="text-muted-foreground">审批人：{resolveName(approverUserId ?? null, users)}</span>
      </div>

      {approvalNote && (
        <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
          最新批注：「{approvalNote}」
        </div>
      )}

      {/* 裁决区：仅 pending 且当前用户为审批人或管理员 */}
      {status === 'pending' && canDecide && (
        <div className="rounded-md border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            <Clock size={11} className="text-[color:var(--warning)]" />审批裁决
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="审批意见（可选）…"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-[color:var(--acc-border)] resize-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ projectId, phaseId, taskId, decision: 'approved', note: note || null })}
              className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              <Check size={12} />通过
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ projectId, phaseId, taskId, decision: 'rejected', note: note || null })}
              className="flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-50"
            >
              <XIcon size={12} />驳回
            </button>
          </div>
        </div>
      )}

      {status === 'pending' && !canDecide && (
        <div className="text-xs text-muted-foreground">等待审批人裁决中，你无裁决权限。</div>
      )}

      {/* 审批历史 */}
      {history.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">审批历史</div>
          <ul className="space-y-2">
            {history.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0">{statusActionIcon(r.action)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-foreground">{ACTION_LABELS[r.action] ?? r.action}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {resolveName(r.userId, users)} · {relativeTime(r.createdAt)}
                    </span>
                  </div>
                  {r.meta?.note && <div className="text-muted-foreground italic">「{r.meta.note}」</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
