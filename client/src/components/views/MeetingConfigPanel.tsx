// 项目周会编辑器：每个项目可各自设定周会(星期/时间/时长/启用)。
// 配了钉钉应用则建真日程+视频会议;否则按周推群提醒(后端自动降级)。
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { AlertTriangle, Ban, BellRing, CalendarClock, CheckCircle2, Clock3, Save } from 'lucide-react';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
type Cfg = { enabled: boolean; weekday: number; time: string; durationMin: number; title: string };
type SyncStatus = 'not_synced' | 'pending' | 'synced' | 'group_fallback' | 'failed' | 'canceled';
type ConfigResponse = {
  config: Cfg | null;
  syncStatus: SyncStatus;
  lastError: string | null;
  lastSyncedAt: string | Date | null;
  eventId: string | null;
};
const DEFAULT: Cfg = { enabled: true, weekday: 3, time: '15:00', durationMin: 60, title: '项目周会' };

function statusMeta(status: SyncStatus) {
  switch (status) {
    case 'synced':
      return { label: '已同步钉钉', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' };
    case 'group_fallback':
      return { label: '群提醒', className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' };
    case 'failed':
      return { label: '同步失败', className: 'border-destructive/30 bg-destructive/10 text-destructive' };
    case 'canceled':
      return { label: '已停用', className: 'border-muted-foreground/25 bg-muted text-muted-foreground' };
    case 'pending':
      return { label: '同步中', className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' };
    default:
      return { label: '未同步', className: 'border-muted-foreground/25 bg-muted text-muted-foreground' };
  }
}

function statusIcon(status: SyncStatus) {
  const className = 'size-3';
  if (status === 'synced') return <CheckCircle2 className={className} />;
  if (status === 'group_fallback') return <BellRing className={className} />;
  if (status === 'failed') return <AlertTriangle className={className} />;
  if (status === 'canceled') return <Ban className={className} />;
  if (status === 'pending') return <Clock3 className={className} />;
  return <CalendarClock className={className} />;
}

function formatSyncedAt(value: ConfigResponse['lastSyncedAt']) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function MeetingConfigPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data } = trpc.meetings.getConfig.useQuery({ projectId });
  const [draft, setDraft] = useState<Cfg | null>(null);
  const payload = data as ConfigResponse | undefined;
  const cfg = draft ?? payload?.config ?? DEFAULT;
  const syncStatus = payload?.syncStatus ?? 'not_synced';
  const meta = statusMeta(syncStatus);
  const syncedAt = formatSyncedAt(payload?.lastSyncedAt ?? null);
  const retryLabel = syncStatus === 'failed' || syncStatus === 'group_fallback' || syncStatus === 'not_synced';
  const save = trpc.meetings.setConfig.useMutation({
    onSuccess: (result) => {
      utils.meetings.getConfig.invalidate({ projectId });
      if (result.syncStatus === 'failed') toast.warning('周会已保存，钉钉同步失败');
      else if (result.syncStatus === 'group_push') toast.success('周会已更新，已发群提醒');
      else toast.success('周会已更新');
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="border border-border bg-card rounded-[11px] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={14} className="text-primary" />
        <h3 className="text-sm font-medium text-foreground flex-1">项目周会</h3>
        <span className={`inline-flex items-center gap-1 rounded-[7px] border px-2 py-1 text-[11px] ${meta.className}`}>
          {statusIcon(syncStatus)}{meta.label}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" disabled={!canEdit} checked={cfg.enabled} onChange={(e) => setDraft({ ...cfg, enabled: e.target.checked })} className="accent-[color:var(--primary)]" />启用
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <select disabled={!canEdit} value={cfg.weekday} onChange={(e) => setDraft({ ...cfg, weekday: Number(e.target.value) })} className="border border-border rounded-[7px] px-2 py-1.5 bg-card">
          {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
        </select>
        <input type="time" disabled={!canEdit} value={cfg.time} onChange={(e) => setDraft({ ...cfg, time: e.target.value })} className="border border-border rounded-[7px] px-2 py-1.5 bg-card num" />
        <input type="number" disabled={!canEdit} value={cfg.durationMin} min={15} step={15} onChange={(e) => setDraft({ ...cfg, durationMin: Number(e.target.value) })} className="border border-border rounded-[7px] px-2 py-1.5 bg-card num" title="时长(分钟)" />
        <input type="text" disabled={!canEdit} value={cfg.title} onChange={(e) => setDraft({ ...cfg, title: e.target.value })} className="border border-border rounded-[7px] px-2 py-1.5 bg-card" />
      </div>
      {canEdit && (
        <button disabled={save.isPending} onClick={() => save.mutate({ projectId, config: cfg })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider rounded-[7px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-colors">
          <Save size={12} />{retryLabel ? '重试同步' : '保存周会'}
        </button>
      )}
      {(syncedAt || payload?.lastError) && (
        <p className="text-[11px] text-muted-foreground">
          {syncedAt ? `最近同步 ${syncedAt}` : null}
          {payload?.lastError ? `${syncedAt ? ' · ' : ''}${payload.lastError}` : null}
        </p>
      )}
    </div>
  );
}
