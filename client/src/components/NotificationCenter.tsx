/**
 * NotificationCenter — In-app notification bell + dropdown panel.
 *
 * Features:
 * - Unread count badge on bell icon
 * - Dropdown panel with notification list
 * - Mark single / mark all as read
 * - Click notification to navigate
 * - Grouped by time (today, yesterday, earlier)
 * - Auto-refresh every 30s
 */

import { useState, useEffect, useRef } from 'react';
import { Bell, Check, CheckCheck, Trash2, X, AlertCircle, Clock, FileCheck, MessageSquare, Flag } from 'lucide-react';
import { trpc } from '@/lib/trpc';

// ── Notification Type Icons ──────────────────────────────────────────────────

function NotificationIcon({ type }: { type: string }) {
  if (type.startsWith('task_')) return <Clock size={14} className="text-blue-500" />;
  if (type.startsWith('issue_')) return <AlertCircle size={14} className="text-rose-500" />;
  if (type.startsWith('gate_')) return <Flag size={14} className="text-amber-500" />;
  if (type.startsWith('comment_')) return <MessageSquare size={14} className="text-indigo-500" />;
  if (type.startsWith('file_')) return <FileCheck size={14} className="text-emerald-500" />;
  return <Bell size={14} className="text-stone-400" />;
}

// ── Time Grouping ────────────────────────────────────────────────────────────

function getTimeGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays <= 7) return '本周';
  return '更早';
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}小时前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// ── Main Component ────────────────────────────────────────────────────────────

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Queries
  const unreadCountQuery = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30000, // Auto-refresh every 30s
  });
  const listQuery = trpc.notifications.list.useQuery(
    { limit: 50, unreadOnly: false },
    { enabled: isOpen }
  );

  // Mutations
  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      unreadCountQuery.refetch();
      listQuery.refetch();
    },
  });
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      unreadCountQuery.refetch();
      listQuery.refetch();
    },
  });
  const deleteMutation = trpc.notifications.delete.useMutation({
    onSuccess: () => {
      listQuery.refetch();
    },
  });

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const unreadCount = unreadCountQuery.data?.count ?? 0;
  const notifications = listQuery.data?.items ?? [];

  // Group notifications by time
  const grouped = notifications.reduce<Record<string, typeof notifications>>((acc, n) => {
    const group = getTimeGroup(n.createdAt as unknown as string);
    if (!acc[group]) acc[group] = [];
    acc[group].push(n);
    return acc;
  }, {});

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-stone-500 hover:text-stone-700 transition-colors"
        title="通知中心"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-rose-500 text-white text-[9px] font-mono font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-[380px] max-h-[500px] bg-white border border-stone-200 shadow-xl z-50 flex flex-col">
          {/* Panel Header */}
          <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between shrink-0">
            <div>
              <span className="font-serif text-sm text-stone-900">通知中心</span>
              {unreadCount > 0 && (
                <span className="ml-2 text-[10px] font-mono bg-rose-50 text-rose-600 px-1.5 py-0.5 border border-rose-200">
                  {unreadCount} 未读
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllReadMutation.mutate()}
                  className="text-[10px] font-mono text-stone-500 hover:text-stone-700 flex items-center gap-1 transition-colors"
                  title="全部标为已读"
                >
                  <CheckCheck size={12} />
                  全部已读
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="text-stone-400 hover:text-stone-700 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell size={24} className="text-stone-200 mx-auto mb-2" />
                <p className="text-xs text-stone-400 font-mono">暂无通知</p>
              </div>
            ) : (
              Object.entries(grouped).map(([group, items]) => (
                <div key={group}>
                  <div className="px-4 py-1.5 bg-stone-50 border-b border-stone-100">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{group}</span>
                  </div>
                  {items.map((n) => (
                    <div
                      key={n.id}
                      className={`px-4 py-3 border-b border-stone-100 flex items-start gap-3 hover:bg-stone-50 transition-colors cursor-pointer ${
                        !n.isRead ? 'bg-blue-50/30' : ''
                      }`}
                      onClick={() => {
                        if (!n.isRead) markReadMutation.mutate({ id: n.id });
                        if (n.link) {
                          window.location.hash = n.link;
                          setIsOpen(false);
                        }
                      }}
                    >
                      {/* Unread dot */}
                      <div className="shrink-0 mt-1.5">
                        {!n.isRead ? (
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                        ) : (
                          <div className="w-2 h-2" />
                        )}
                      </div>

                      {/* Icon */}
                      <div className="shrink-0 mt-0.5">
                        <NotificationIcon type={n.type} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs leading-tight ${!n.isRead ? 'text-stone-900 font-medium' : 'text-stone-600'}`}>
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-[10px] text-stone-400 mt-0.5 line-clamp-2">{n.body}</p>
                        )}
                        <span className="text-[9px] font-mono text-stone-300 mt-1 block">
                          {formatTime(n.createdAt as unknown as string)}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        {!n.isRead && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markReadMutation.mutate({ id: n.id });
                            }}
                            className="p-1 text-stone-400 hover:text-blue-500 transition-colors"
                            title="标为已读"
                          >
                            <Check size={11} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate({ id: n.id });
                          }}
                          className="p-1 text-stone-400 hover:text-rose-500 transition-colors"
                          title="删除"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationCenter;
