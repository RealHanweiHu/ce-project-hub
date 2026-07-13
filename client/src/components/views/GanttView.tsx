// Linear redesign — GanttView (per-project editable Gantt chart)
// Double-click any phase bar to edit its dates; changes propagate via onUpdate → auto-save.

import { useMemo, useRef, useState, useCallback } from 'react';
import {
  Flag, CalendarDays, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  Pencil, Check, X as XIcon, Lock,
} from 'lucide-react';
import { Project, PhaseDate, getPhaseProgress, getPhaseStatus, getProjectPhases, SOPPhase } from '@/lib/data';

// ── Duration defaults (days) ──────────────────────────────────────────────────
const PHASE_DAYS: Record<string, number> = {
  concept:  21,
  planning: 90,
  design:   63,
  evt:      35,
  dvt:      42,
  pvt:      35,
  mp:       60,
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseDate(str: string): Date | null {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short' });
}

interface PhaseBar {
  phase: SOPPhase;
  startDate: Date;
  endDate: Date;
  progress: number;
  status: 'completed' | 'active' | 'pending';
  isCustom: boolean; // whether dates come from phaseDates override
}

interface GanttViewProps {
  project: Project;
  onUpdate: (project: Project) => void;
  onPhaseClick?: (phaseId: string) => void;
  readOnly?: boolean;
  phaseFilter?: string;
}

// ── Inline date editor ────────────────────────────────────────────────────────
function DateEditor({
  label, value, onChange, onClose,
}: {
  label: string; value: string; onChange: (v: string) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => { onChange(draft); onClose(); };
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-32 rounded-[6px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] px-1.5 py-0.5 text-[11px] text-foreground outline-none num"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onClose(); }}
      />
      <button onClick={commit} className="p-0.5 text-[color:var(--success)] transition-colors hover:opacity-80">
        <Check size={13} />
      </button>
      <button onClick={onClose} className="p-0.5 text-muted-foreground transition-colors hover:text-foreground">
        <XIcon size={13} />
      </button>
    </div>
  );
}

export function GanttView({ project, onUpdate, onPhaseClick, readOnly = false, phaseFilter }: GanttViewProps) {
  const [zoom, setZoom] = useState(1);
  const [editingPhase, setEditingPhase] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'start' | 'end' | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Close any open editor panel when readOnly becomes true (e.g. permissions resolved)
  const prevReadOnly = useRef(readOnly);
  if (readOnly && !prevReadOnly.current && editingPhase) {
    setEditingPhase(null);
    setEditingField(null);
  }
  prevReadOnly.current = readOnly;

    // ── Compute phase bars ────────────────────────────────────────────
  const { bars, totalStart, totalEnd } = useMemo(() => {
    const projectStart = parseDate(project.startDate) || new Date();
    const projectEnd = parseDate(project.targetDate);

    const projectPhases = getProjectPhases(project);

    // Split phases into custom (have explicit dates) and default (need proportional allocation)
    const hasCustomDate = (phaseId: string) =>
      !!(project.phaseDates?.[phaseId]?.startDate && project.phaseDates?.[phaseId]?.endDate);

    // Sum of default weights for non-custom phases
    const totalDefaultWeight = projectPhases.reduce((sum, p) =>
      hasCustomDate(p.id) ? sum : sum + (PHASE_DAYS[p.id] ?? 30), 0);

    // Total project duration in days (if both dates set)
    const projectTotalDays = projectEnd
      ? Math.max(1, Math.ceil((projectEnd.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24)))
      : null;

    // Days consumed by custom-dated phases
    const customConsumedDays = projectPhases.reduce((sum, p) => {
      if (!hasCustomDate(p.id)) return sum;
      const s = parseDate(project.phaseDates![p.id].startDate);
      const e = parseDate(project.phaseDates![p.id].endDate);
      return s && e ? sum + Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24))) : sum;
    }, 0);

    // Remaining days available for non-custom phases
    const remainingDays = projectTotalDays
      ? Math.max(1, projectTotalDays - customConsumedDays)
      : null;

    // Scale factor: only apply when project has an end date and remaining days differ from defaults
    const scaleFactor = remainingDays && totalDefaultWeight > 0
      ? remainingDays / totalDefaultWeight
      : 1;

    let cursor = new Date(projectStart);
    const allBars: PhaseBar[] = projectPhases.map((phase) => {
      const custom = project.phaseDates?.[phase.id];
      let phaseStart: Date;
      let phaseEnd: Date;
      let isCustom = false;

      if (custom?.startDate && custom?.endDate) {
        // Custom dates: use exactly as specified
        phaseStart = parseDate(custom.startDate) || cursor;
        phaseEnd = parseDate(custom.endDate) || addDays(phaseStart, PHASE_DAYS[phase.id] ?? 30);
        isCustom = true;
        cursor = new Date(phaseEnd);
      } else {
        // Proportional allocation: scale default weight by remaining project time
        const defaultDays = PHASE_DAYS[phase.id] ?? 30;
        const scaledDays = Math.max(1, Math.round(defaultDays * scaleFactor));
        phaseStart = new Date(cursor);
        phaseEnd = addDays(cursor, scaledDays);
        cursor = new Date(phaseEnd);
      }

      return {
        phase,
        startDate: phaseStart,
        endDate: phaseEnd,
        progress: getPhaseProgress(project, phase.id),
        status: getPhaseStatus(project, phase.id),
        isCustom,
      };
    });

    // Clamp totalEnd to projectEnd when all phases fit within the project window
    const computedEnd = cursor;
    const fullTotalEnd = projectEnd
      ? (computedEnd > projectEnd ? computedEnd : projectEnd)
      : computedEnd;
    const bars = phaseFilter && phaseFilter !== 'all'
      ? allBars.filter((bar) => bar.phase.id === phaseFilter)
      : allBars;

    if (phaseFilter && phaseFilter !== 'all' && bars.length > 0) {
      const filteredStart = bars.reduce((min, bar) => bar.startDate < min ? bar.startDate : min, bars[0].startDate);
      const filteredEnd = bars.reduce((max, bar) => bar.endDate > max ? bar.endDate : max, bars[0].endDate);
      return { bars, totalStart: filteredStart, totalEnd: filteredEnd };
    }

    return { bars, totalStart: projectStart, totalEnd: fullTotalEnd };
  }, [project, phaseFilter]);

  // ── Timeline grid ─────────────────────────────────────────────────────────
  const totalDays = Math.max(
    1,
    Math.ceil((totalEnd.getTime() - totalStart.getTime()) / (1000 * 60 * 60 * 24))
  );

  const BASE_PX_PER_DAY = 4;
  const pxPerDay = BASE_PX_PER_DAY * zoom;
  const totalWidth = Math.round(totalDays * pxPerDay);

  const monthTicks = useMemo(() => {
    const ticks: { label: string; offsetPx: number }[] = [];
    const d = new Date(totalStart);
    d.setDate(1);
    if (d < totalStart) d.setMonth(d.getMonth() + 1);
    while (d <= totalEnd) {
      const offsetDays = (d.getTime() - totalStart.getTime()) / (1000 * 60 * 60 * 24);
      ticks.push({ label: formatMonth(d), offsetPx: Math.round(offsetDays * pxPerDay) });
      d.setMonth(d.getMonth() + 1);
    }
    return ticks;
  }, [totalStart, totalEnd, pxPerDay]);

  const today = new Date();
  const todayOffsetDays = (today.getTime() - totalStart.getTime()) / (1000 * 60 * 60 * 24);
  const todayPx = Math.round(todayOffsetDays * pxPerDay);
  const showToday = todayOffsetDays >= 0 && todayOffsetDays <= totalDays + 7;

  const barLeft = (d: Date) =>
    Math.max(0, Math.round(((d.getTime() - totalStart.getTime()) / (1000 * 60 * 60 * 24)) * pxPerDay));
  const barWidth = (s: Date, e: Date) =>
    Math.max(8, Math.round(((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) * pxPerDay));

  const scrollBy = (px: number) => scrollRef.current?.scrollBy({ left: px, behavior: 'smooth' });
  const scrollToToday = () => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, todayPx - 120);
  };

  // ── Date update handler ───────────────────────────────────────────────────
  const handleDateChange = useCallback(
    (phaseId: string, field: 'startDate' | 'endDate', value: string) => {
      const existing = project.phaseDates?.[phaseId];
      // Find the bar to get current computed dates as fallback
      const bar = bars.find((b) => b.phase.id === phaseId);
      const fallbackStart = bar ? toISODate(bar.startDate) : project.startDate;
      const fallbackEnd = bar ? toISODate(bar.endDate) : project.targetDate;

      const updated: PhaseDate = {
        startDate: field === 'startDate' ? value : (existing?.startDate || fallbackStart),
        endDate: field === 'endDate' ? value : (existing?.endDate || fallbackEnd),
      };
      onUpdate({
        ...project,
        phaseDates: { ...(project.phaseDates || {}), [phaseId]: updated },
      });
    },
    [project, bars, onUpdate]
  );

  const clearCustomDates = (phaseId: string) => {
    const newDates = { ...(project.phaseDates || {}) };
    delete newDates[phaseId];
    onUpdate({ ...project, phaseDates: newDates });
  };

  const ROW_HEIGHT = 52;
  const LABEL_WIDTH = 148;

  return (
    <div className="rounded-[10px] border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">甘特图</span>
            <span className="ml-3 text-[10px] text-muted-foreground num">
              {formatDate(totalStart)} → {formatDate(totalEnd)}
            </span>
          </div>
          {!readOnly ? (
            <div className="flex items-center gap-1.5 rounded-[6px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] px-2.5 py-1">
              <Pencil size={10} className="text-primary" />
              <span className="text-[10px] uppercase tracking-wide text-primary">双击阶段条可编辑日期</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-[6px] border border-border bg-secondary px-2.5 py-1">
              <Lock size={10} className="text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">仅 Owner / 管理层 / PM 可修改阶段日期</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => scrollBy(-200)} className="rounded-[6px] p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="向左滚动">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => scrollBy(200)} className="rounded-[6px] p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="向右滚动">
            <ChevronRight size={15} />
          </button>
          <div className="mx-1 h-4 w-px bg-border" />
          <button onClick={() => setZoom((z) => Math.min(4, +(z * 1.5).toFixed(2)))} className="rounded-[6px] p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="放大">
            <ZoomIn size={15} />
          </button>
          <button onClick={() => setZoom((z) => Math.max(0.3, +(z / 1.5).toFixed(2)))} className="rounded-[6px] p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="缩小">
            <ZoomOut size={15} />
          </button>
          <button
            onClick={() => { setZoom(1); setTimeout(scrollToToday, 50); }}
            className="ml-1 flex items-center gap-1 rounded-[6px] border border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-secondary"
          >
            <CalendarDays size={11} />今天
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex overflow-hidden">
        {/* Fixed label column */}
        <div className="shrink-0 border-r border-border" style={{ width: LABEL_WIDTH }}>
          <div className="h-8 border-b border-border bg-secondary" />
          {bars.map(({ phase, status, isCustom }) => (
            <div
              key={phase.id}
              onClick={() => onPhaseClick?.(phase.id)}
              className={`flex cursor-pointer items-center gap-2 border-b border-border px-3 transition-colors hover:bg-secondary ${
                status === 'active' ? 'bg-[color:var(--acc-soft)]/60' : ''
              }`}
              style={{ height: ROW_HEIGHT }}
            >
              <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: phase.color }} />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase leading-none tracking-wide text-muted-foreground">{phase.code}</div>
                <div className="mt-0.5 truncate text-xs font-medium leading-tight text-[color:var(--secondary-foreground)]">{phase.nameEn}</div>
                {isCustom && (
                  <div className="mt-0.5 text-[9px] uppercase leading-none tracking-wide text-primary">已自定义</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: Math.max(totalWidth, 400), position: 'relative' }}>
            {/* Month header */}
            <div className="relative h-8 border-b border-border bg-secondary" style={{ width: Math.max(totalWidth, 400) }}>
              {monthTicks.map((tick, i) => (
                <div key={i} className="absolute top-0 flex h-full items-center" style={{ left: tick.offsetPx }}>
                  <div className="h-full w-px bg-border" />
                  <span className="ml-1.5 whitespace-nowrap text-[10px] text-muted-foreground num">{tick.label}</span>
                </div>
              ))}
              {showToday && (
                <div className="absolute top-0 z-10 h-full w-px bg-primary" style={{ left: todayPx }} />
              )}
            </div>

            {/* Rows */}
            {bars.map(({ phase, startDate, endDate, progress, status, isCustom }) => {
              const left = barLeft(startDate);
              const width = barWidth(startDate, endDate);
              const isEditing = editingPhase === phase.id;

              return (
                <div
                  key={phase.id}
                  className={`relative border-b border-border ${status === 'active' ? 'bg-[color:var(--acc-soft)]/30' : 'bg-card'}`}
                  style={{ height: ROW_HEIGHT, width: Math.max(totalWidth, 400) }}
                >
                  {/* Month grid lines */}
                  {monthTicks.map((tick, i) => (
                    <div key={i} className="absolute top-0 h-full w-px bg-border" style={{ left: tick.offsetPx }} />
                  ))}
                  {showToday && (
                    <div className="absolute top-0 z-10 h-full w-px bg-primary/50" style={{ left: todayPx }} />
                  )}

                  {/* Phase bar */}
                  <div
                    className={`absolute group ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    style={{ left, width, top: '50%', transform: 'translateY(-50%)' }}
                    onDoubleClick={() => {
                      if (readOnly) return;
                      setEditingPhase(phase.id);
                      setEditingField('start');
                    }}
                    onClick={() => !isEditing && onPhaseClick?.(phase.id)}
                    title={readOnly
                      ? `${phase.name}: ${formatDate(startDate)} → ${formatDate(endDate)}`
                      : `双击编辑 · ${phase.name}: ${formatDate(startDate)} → ${formatDate(endDate)}`
                    }
                  >
                    {/* Track */}
                    <div
                      className="h-7 w-full rounded-sm opacity-20"
                      style={{ backgroundColor: phase.color }}
                    />
                    {/* Progress fill */}
                    <div
                      className="absolute top-0 left-0 h-7 rounded-sm transition-all duration-500"
                      style={{
                        backgroundColor: phase.color,
                        width: `${progress}%`,
                        opacity: status === 'pending' ? 0.3 : 0.85,
                      }}
                    />
                    {/* Progress label */}
                    {width > 50 && (
                      <div className="pointer-events-none absolute inset-0 flex items-center px-2">
                        <span className="truncate text-[10px] font-semibold text-white drop-shadow-sm num">
                          {progress}%
                        </span>
                      </div>
                    )}
                    {/* Edit hint on hover */}
                    {!readOnly && (
                      <div className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="rounded-[5px] border border-border bg-card px-1.5 py-0.5 text-[9px] text-muted-foreground num">
                          {formatDate(startDate)} → {formatDate(endDate)} · 双击编辑
                        </span>
                      </div>
                    )}
                    {/* Gate marker */}
                    <div className="absolute -right-0.5 top-1/2 z-20 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                      <Flag size={12} className="text-foreground" />
                    </div>
                    {/* Custom indicator */}
                    {isCustom && (
                      <div className="absolute -right-1 -top-1 z-20 h-2 w-2 rounded-full bg-primary" title="已自定义日期" />
                    )}
                  </div>
                </div>
              );
            })}

            {/* Target date marker */}
            {project.targetDate && (() => {
              const targetDate = parseDate(project.targetDate);
              if (!targetDate) return null;
              const targetDays = (targetDate.getTime() - totalStart.getTime()) / (1000 * 60 * 60 * 24);
              if (targetDays < 0 || targetDays > totalDays + 30) return null;
              const targetPx = Math.round(targetDays * pxPerDay);
              return (
                <div className="pointer-events-none absolute bottom-0 top-8 z-20" style={{ left: targetPx }}>
                  <div className="h-full w-px" style={{ borderLeft: '2px dashed var(--destructive)' }} />
                  <div className="absolute left-1 top-1 whitespace-nowrap rounded-[5px] border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 px-1.5 py-0.5">
                    <span className="text-[9px] uppercase tracking-wide text-[color:var(--destructive)]">目标</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Inline Date Editor Panel - only shown when not readOnly */}
      {!readOnly && editingPhase && (() => {
        const bar = bars.find((b) => b.phase.id === editingPhase);
        if (!bar) return null;
        const custom = project.phaseDates?.[editingPhase];
        const currentStart = custom?.startDate || toISODate(bar.startDate);
        const currentEnd = custom?.endDate || toISODate(bar.endDate);
        return (
          <div className="border-t border-[color:var(--acc-border)] bg-[color:var(--acc-soft)]/70 px-5 py-3">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: bar.phase.color }} />
                <span className="text-sm font-medium text-foreground">{bar.phase.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{bar.phase.code}</span>
              </div>
              <DateEditor
                label="开始"
                value={currentStart}
                onChange={(v) => handleDateChange(editingPhase, 'startDate', v)}
                onClose={() => {}}
              />
              <DateEditor
                label="结束"
                value={currentEnd}
                onChange={(v) => handleDateChange(editingPhase, 'endDate', v)}
                onClose={() => {}}
              />
              {bar.isCustom && (
                <button
                  onClick={() => clearCustomDates(editingPhase)}
                  className="rounded-[6px] border border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-[color:var(--destructive)]/40 hover:text-[color:var(--destructive)]"
                >
                  重置为默认
                </button>
              )}
              <button
                onClick={() => { setEditingPhase(null); setEditingField(null); }}
                className="ml-auto flex items-center gap-1 rounded-[6px] border border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
              >
                <Check size={11} />完成
              </button>
            </div>
            <div className="mt-2 text-[10px] text-primary">
              修改将自动保存 · 高亮圆点标记已自定义日期的阶段
            </div>
          </div>
        );
      })()}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-6 border-t border-border bg-secondary px-5 py-3">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-muted-foreground opacity-80" />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">已完成</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-primary opacity-80" />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">进行中</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-[color:var(--secondary)]" />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">待开始</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">已自定义日期</span>
        </div>
        {showToday && (
          <div className="flex items-center gap-1.5">
            <div className="h-px w-3 border-t-2 border-primary" />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">今天</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="h-px w-3 border-t-2 border-dashed border-[color:var(--destructive)]" />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">目标日期</span>
        </div>
      </div>
    </div>
  );
}
