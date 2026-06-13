// 顶栏通知铃铛：未读数轮询 + 下拉列表 + 已读。
import { useState } from 'react';
import { Bell, Check, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';

type NotificationRow = {
  id: number; type: string; title: string; body: string | null; read: boolean; createdAt: string | Date;
};

export function NotificationBell() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = trpc.notifications.unreadCount.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: true });
  const { data: list = [], isLoading } = trpc.notifications.list.useQuery(undefined, { enabled: open });

  const inval = () => { utils.notifications.unreadCount.invalidate(); utils.notifications.list.invalidate(); };
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: inval });
  const markAll = trpc.notifications.markAllRead.useMutation({ onSuccess: inval });

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative text-stone-400 hover:text-stone-700 transition-colors" title="通知">
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 bg-rose-500 text-white text-[9px] font-mono rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white border border-stone-200 shadow-lg z-40">
            <div className="flex items-center justify-between px-3 py-2 border-b border-stone-100 sticky top-0 bg-white">
              <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500">通知</span>
              {unread > 0 && (
                <button onClick={() => markAll.mutate()} className="text-[10px] font-mono text-amber-600 hover:text-amber-700 flex items-center gap-1">
                  <Check size={11} /> 全部已读
                </button>
              )}
            </div>
            {isLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="animate-spin text-amber-500" size={16} /></div>
            ) : list.length === 0 ? (
              <p className="text-xs text-stone-400 text-center py-6">暂无通知</p>
            ) : (
              (list as NotificationRow[]).map((n) => (
                <button
                  key={n.id}
                  onClick={() => { if (!n.read) markRead.mutate({ id: n.id }); }}
                  className={`w-full text-left px-3 py-2.5 border-b border-stone-50 hover:bg-stone-50 transition-colors ${n.read ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-stone-800">{n.title}</div>
                      {n.body && <div className="text-[11px] text-stone-500 truncate">{n.body}</div>}
                      <div className="text-[9px] font-mono text-stone-400 mt-0.5">{new Date(n.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
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
