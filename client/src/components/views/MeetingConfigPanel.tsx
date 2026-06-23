// 项目周会编辑器：每个项目可各自设定周会(星期/时间/时长/启用)。
// 配了钉钉应用则建真日程+视频会议;否则按周推群提醒(后端自动降级)。
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { CalendarClock, Save } from 'lucide-react';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
type Cfg = { enabled: boolean; weekday: number; time: string; durationMin: number; title: string };
const DEFAULT: Cfg = { enabled: true, weekday: 3, time: '15:00', durationMin: 60, title: '项目周会' };

export function MeetingConfigPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data } = trpc.meetings.getConfig.useQuery({ projectId });
  const [draft, setDraft] = useState<Cfg | null>(null);
  const cfg = draft ?? (data as Cfg | null) ?? DEFAULT;
  const save = trpc.meetings.setConfig.useMutation({
    onSuccess: () => { utils.meetings.getConfig.invalidate({ projectId }); toast.success('周会已更新'); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="border border-border bg-card rounded-[11px] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={14} className="text-primary" />
        <h3 className="text-sm font-medium text-foreground flex-1">项目周会</h3>
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
          <Save size={12} />保存周会
        </button>
      )}
      <p className="text-[11px] text-muted-foreground">配了钉钉应用则建真日程+视频会议链接;否则按周推群提醒。每个项目可各自设定。</p>
    </div>
  );
}
