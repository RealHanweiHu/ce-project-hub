// 顶栏通知铃铛：未读数轮询 + 下拉列表 + 已读。
import { useState } from 'react';
import { Bell, Check, Loader2, ClipboardCheck, Activity } from 'lucide-react';
import { trpc } from '@/lib/trpc';

type NotificationRow = {
  id: number; type: string; title: string; body: string | null; read: boolean; createdAt: string | Date;
  entityType?: string | null; entityId?: string | null;
};

export function NotificationBell({ onNavigate }: { onNavigate?: (projectId: string) => void } = {}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = trpc.notifications.unreadCount.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: true });
  const { data: list = [], isLoading } = trpc.notifications.list.useQuery(undefined, { enabled: open });
  const { data: pending = [] } = trpc.deliverableReviews.myPending.useQuery(undefined, { refetchInterval: 60_000, refetchOnWindowFocus: true });

  const totalBadge = unread + pending.length;

  const inval = () => { utils.notifications.unreadCount.invalidate(); utils.notifications.list.invalidate(); };
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: inval });
  const markAll = trpc.notifications.markAllRead.useMutation({ onSuccess: inval });

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative text-muted-foreground hover:text-foreground transition-colors" title="通知">
        <Bell size={16} />
        {totalBadge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 bg-[color:var(--destructive)] text-white text-[9px] rounded-full flex items-center justify-center">
            {totalBadge > 9 ? '9+' : totalBadge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white border border-border shadow-lg z-40">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-white">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">通知</span>
              {unread > 0 && (
                <button onClick={() => markAll.mutate()} className="text-[10px] text-[color:var(--warning)] hover:opacity-80 flex items-center gap-1">
                  <Check size={11} /> 全部已读
                </button>
              )}
            </div>

            {/* ── 待审交付物 ──────────────────────────────────────────── */}
            {pending.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[color:var(--warning-soft)] border-b border-[color:var(--warning)]">
                  <ClipboardCheck size={11} className="text-[color:var(--warning)]" />
                  <span className="text-[10px] uppercase tracking-widest text-[color:var(--warning)]">待你审核的交付物 ({pending.length})</span>
                </div>
                {pending.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      setOpen(false);
                      onNavigate?.(r.projectId);
                    }}
                    className="w-full text-left px-3 py-2 border-b border-[color:var(--warning)] hover:bg-[color:var(--warning-soft)] transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--warning)] mt-1.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{r.deliverableName}</div>
                        <div className="text-[10px] text-muted-foreground truncate">项目 {r.projectId} · {r.phaseId}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="animate-spin text-[color:var(--warning)]" size={16} /></div>
            ) : list.length === 0 && pending.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">暂无通知</p>
            ) : list.length === 0 ? null : (
              (list as NotificationRow[]).map((n) => (
                <button
                  key={n.id}
                  onClick={() => { if (!n.read) markRead.mutate({ id: n.id }); }}
                  className={`w-full text-left px-3 py-2.5 border-b border-border hover:bg-secondary transition-colors ${n.read ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {n.entityType === 'portfolio'
                      ? <Activity size={13} className="text-[color:var(--warning)] mt-0.5 shrink-0" />
                      : !n.read && <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--warning)] mt-1.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-xs font-medium text-foreground">{n.title}</div>
                        {n.entityType === 'portfolio' && (
                          <span className="text-[9px] bg-[color:var(--warning-soft)] text-[color:var(--warning)] border border-[color:var(--warning)] px-1 py-0.5">聚合</span>
                        )}
                      </div>
                      {n.body && <div className="text-[11px] text-muted-foreground truncate">{n.body}</div>}
                      <div className="text-[9px] text-muted-foreground mt-0.5">{new Date(n.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
