// 任务级甘特图(只读):从自动排期的任务起止日渲染任务条,按阶段分组,
// 高亮关键路径与逾期任务,给 PM 看真正的关键路径 / 延期 / 阶段风险。
import { useMemo, useRef, useState } from 'react';
import { Project, getProjectPhases } from '@/lib/data';
import { criticalPathTasksForProjectRows } from '@shared/schedule-graph';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, CalendarDays, AlertTriangle, Flame } from 'lucide-react';

function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const dayMs = 86400000;
const fmtMonth = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}`;
const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

interface TaskBar {
  phaseId: string; phaseColor: string; taskId: string; name: string;
  start: Date; due: Date; done: boolean; overdue: boolean; critical: boolean;
}
type Row = { kind: 'phase'; id: string; code: string; name: string; color: string; overdue: number } | { kind: 'task'; bar: TaskBar };

const ROW_H = 30;
const LABEL_W = 200;

export function TaskGanttView({ project, onTaskClick, phaseFilter }: { project: Project; onTaskClick?: (phaseId: string, taskId: string) => void; phaseFilter?: string }) {
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { rows, totalStart, totalEnd, critTotal } = useMemo(() => {
    const phases = getProjectPhases(project);
    // 与服务端排期同图源：把裁剪 skipped 行喂进运行态图，避免高亮已被豁免的链
    const graphRows = Object.values(project.phases ?? {}).flatMap((pd) =>
      Object.entries(pd?.taskDetails ?? {}).map(([taskId, detail]) => ({
        taskId,
        status: detail?.taskStatus ?? null,
      })),
    );
    const crit = criticalPathTasksForProjectRows(project, graphRows);
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const rows: Row[] = [];
    let minStart: Date | null = null, maxDue: Date | null = null;
    for (const phase of phases) {
      if (phaseFilter && phaseFilter !== 'all' && phase.id !== phaseFilter) continue;
      const pd = project.phases[phase.id];
      const bars: TaskBar[] = [];
      for (const t of phase.tasks) {
        const d = pd?.taskDetails?.[t.id];
        const s = parseDate(d?.startDate), e = parseDate(d?.dueDate);
        if (!s || !e) continue;
        const done = !!pd?.tasks?.[t.id];
        const overdue = !done && e < today0;
        bars.push({ phaseId: phase.id, phaseColor: phase.color, taskId: t.id, name: t.name, start: s, due: e, done, overdue, critical: crit.has(t.id) });
        if (!minStart || s < minStart) minStart = s;
        if (!maxDue || e > maxDue) maxDue = e;
      }
      if (bars.length) {
        rows.push({ kind: 'phase', id: phase.id, code: phase.code, name: phase.name, color: phase.color, overdue: bars.filter((b) => b.overdue).length });
        for (const b of bars) rows.push({ kind: 'task', bar: b });
      }
    }
    const fallbackStart = parseDate(project.startDate) || new Date();
    const totalStart = minStart || fallbackStart;
    const totalEnd = maxDue || new Date(totalStart.getTime() + 90 * dayMs);
    const critTotal = rows.filter((r) => r.kind === 'task' && r.bar.critical).length;
    return { rows, totalStart, totalEnd, critTotal };
  }, [project, phaseFilter]);

  const totalDays = Math.max(1, Math.ceil((totalEnd.getTime() - totalStart.getTime()) / dayMs) + 1);
  const pxPerDay = 6 * zoom;
  const totalWidth = Math.round(totalDays * pxPerDay);
  const left = (d: Date) => Math.round(((d.getTime() - totalStart.getTime()) / dayMs) * pxPerDay);
  const width = (s: Date, e: Date) => Math.max(4, Math.round(((e.getTime() - s.getTime()) / dayMs + 1) * pxPerDay));

  const monthTicks = useMemo(() => {
    const ticks: { label: string; x: number }[] = [];
    const d = new Date(totalStart); d.setDate(1);
    if (d < totalStart) d.setMonth(d.getMonth() + 1);
    while (d <= totalEnd) { ticks.push({ label: fmtMonth(d), x: left(d) }); d.setMonth(d.getMonth() + 1); }
    return ticks;
  }, [totalStart, totalEnd, pxPerDay]);

  const today = new Date();
  const todayX = left(today);
  const showToday = today >= totalStart && today.getTime() <= totalEnd.getTime() + 7 * dayMs;
  const scrollBy = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: 'smooth' });

  const taskRows = rows.filter((r) => r.kind === 'task') as Extract<Row, { kind: 'task' }>[];
  if (taskRows.length === 0) {
    return (
      <div className="rounded-[10px] border border-border bg-card p-10 text-center shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
        <CalendarDays size={28} className="mx-auto text-muted-foreground/60 mb-3" />
        <div className="text-sm text-foreground">暂无任务排期</div>
        <div className="text-xs text-muted-foreground mt-1">请先在「总揽」设置项目开始日期(并重新生成排期),任务级甘特图会按工期+依赖自动排布。</div>
      </div>
    );
  }
  const overdueTotal = taskRows.filter((r) => r.bar.overdue).length;

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">任务甘特图</span>
          <span className="num inline-flex items-center gap-1 text-[10px] text-[color:var(--destructive)]"><Flame size={11} />关键路径 {critTotal} 项</span>
          {overdueTotal > 0 && <span className="num inline-flex items-center gap-1 text-[10px] text-[color:var(--warning)]"><AlertTriangle size={11} />逾期 {overdueTotal} 项</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => scrollBy(-240)} className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" title="左"><ChevronLeft size={15} /></button>
          <button onClick={() => scrollBy(240)} className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" title="右"><ChevronRight size={15} /></button>
          <div className="w-px h-4 bg-border mx-1" />
          <button onClick={() => setZoom((z) => Math.min(4, +(z * 1.5).toFixed(2)))} className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" title="放大"><ZoomIn size={15} /></button>
          <button onClick={() => setZoom((z) => Math.max(0.3, +(z / 1.5).toFixed(2)))} className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" title="缩小"><ZoomOut size={15} /></button>
        </div>
      </div>

      <div className="flex overflow-hidden">
        {/* Label column */}
        <div className="shrink-0 border-r border-border" style={{ width: LABEL_W }}>
          <div className="h-8 border-b border-border bg-secondary" />
          {rows.map((r, i) => r.kind === 'phase' ? (
            <div key={`p-${r.id}`} className="flex items-center gap-2 px-3 border-b border-border bg-secondary" style={{ height: ROW_H }}>
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
              <span className="text-[11px] font-medium text-foreground truncate">{r.code} {r.name}</span>
              {r.overdue > 0 && <span className="num text-[9px] text-[color:var(--destructive)] ml-auto">逾期{r.overdue}</span>}
            </div>
          ) : (
            <div key={`t-${r.bar.taskId}-${i}`} onClick={() => onTaskClick?.(r.bar.phaseId, r.bar.taskId)}
              className="flex items-center gap-1.5 pl-6 pr-3 border-b border-border cursor-pointer hover:bg-secondary" style={{ height: ROW_H }}>
              {r.bar.critical && <Flame size={9} className="text-[color:var(--destructive)] shrink-0" />}
              <span className={`text-[11px] truncate ${r.bar.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{r.bar.name}</span>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: Math.max(totalWidth, 400), position: 'relative' }}>
            <div className="h-8 border-b border-border bg-secondary relative">
              {monthTicks.map((t, i) => (
                <div key={i} className="absolute top-0 h-full flex items-center" style={{ left: t.x }}>
                  <div className="h-full w-px bg-border" /><span className="num text-[10px] text-muted-foreground ml-1.5 whitespace-nowrap">{t.label}</span>
                </div>
              ))}
              {showToday && <div className="absolute top-0 h-full w-px bg-primary z-10" style={{ left: todayX }} />}
            </div>
            {rows.map((r, i) => (
              <div key={r.kind === 'phase' ? `pr-${r.id}` : `tr-${r.bar.taskId}-${i}`}
                className={`relative border-b ${r.kind === 'phase' ? 'border-border bg-secondary/60' : 'border-border bg-card'}`}
                style={{ height: ROW_H, width: Math.max(totalWidth, 400) }}>
                {monthTicks.map((t, j) => <div key={j} className="absolute top-0 h-full w-px bg-border" style={{ left: t.x }} />)}
                {showToday && <div className="absolute top-0 h-full w-px bg-primary/50 z-10" style={{ left: todayX }} />}
                {r.kind === 'task' && (
                  <div
                    onClick={() => onTaskClick?.(r.bar.phaseId, r.bar.taskId)}
                    title={`${r.bar.name} · ${fmt(r.bar.start)} → ${fmt(r.bar.due)}${r.bar.critical ? ' · 关键路径' : ''}${r.bar.overdue ? ' · 逾期' : ''}`}
                    className={`absolute cursor-pointer rounded-[4px] ${
                      r.bar.done ? 'bg-[color:var(--success)]'
                        : r.bar.overdue ? 'bg-[color:var(--destructive)]'
                        : r.bar.critical ? 'bg-primary' : 'bg-muted-foreground'
                    } ${r.bar.critical && !r.bar.done ? 'ring-1 ring-[color:var(--destructive)]' : ''}`}
                    style={{ left: left(r.bar.start), width: width(r.bar.start, r.bar.due), top: '50%', transform: 'translateY(-50%)', height: 12 }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 px-5 py-2 border-t border-border text-[10px] text-muted-foreground flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 bg-primary ring-1 ring-[color:var(--destructive)] inline-block" />关键路径</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 bg-[color:var(--destructive)] inline-block" />逾期</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 bg-[color:var(--success)] inline-block" />已完成</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 bg-muted-foreground inline-block" />普通</span>
        <span className="inline-flex items-center gap-1"><span className="w-px h-3 bg-primary inline-block" />今天</span>
      </div>
    </div>
  );
}
