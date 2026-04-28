// Design: Industrial Precision - stone/amber color system
// GanttView: editable Gantt chart — double-click any phase bar to edit its dates
// Changes are immediately propagated via onUpdate → triggers auto-save in Home.tsx

import { useMemo, useRef, useState, useCallback } from 'react';
import {
  Flag, CalendarDays, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  Pencil, Check, X as XIcon, Lock,
} from 'lucide-react';
import { Project, SOP_PHASES, PhaseDate, computePhaseProgress, getPhaseStatus, getProjectPhases, SOPPhase } from '@/lib/data';

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
      <span className="text-[10px] font-mono text-stone-400 uppercase tracking-wider shrink-0">{label}</span>
      <input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="text-[11px] font-mono border border-amber-400 bg-amber-50 outline-none px-1.5 py-0.5 text-stone-800 w-32"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onClose(); }}
      />
      <button onClick={commit} className="p-0.5 text-emerald-600 hover:text-emerald-800 transition-colors">
        <Check size={13} />
      </button>
      <button onClick={onClose} className="p-0.5 text-stone-400 hover:text-stone-700 transition-colors">
        <XIcon size={13} />
      </button>
    </div>
  );
}

export function GanttView({ project, onUpdate, onPhaseClick, readOnly = false }: GanttViewProps) {
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

  // ── Compute phase bars ────────────────────────────────────────────────────
  const { bars, totalStart, totalEnd } = useMemo(() => {
    const projectStart = parseDate(project.startDate) || new Date();
    const projectEnd = parseDate(project.targetDate);

    const projectPhases = getProjectPhases(project);
    let cursor = new Date(projectStart);
    const bars: PhaseBar[] = projectPhases.map((phase) => {
      const custom = project.phaseDates?.[phase.id];
      let phaseStart: Date;
      let phaseEnd: Date;
      let isCustom = false;

      if (custom?.startDate && custom?.endDate) {
        phaseStart = parseDate(custom.startDate) || cursor;
        phaseEnd = parseDate(custom.endDate) || addDays(phaseStart, PHASE_DAYS[phase.id] ?? 30);
        isCustom = true;
        cursor = new Date(phaseEnd);
      } else {
        const days = PHASE_DAYS[phase.id] ?? 30;
        phaseStart = new Date(cursor);
        phaseEnd = addDays(cursor, days);
        cursor = new Date(phaseEnd);
      }

      return {
        phase,
        startDate: phaseStart,
        endDate: phaseEnd,
        progress: computePhaseProgress(project.phases[phase.id], phase.id),
        status: getPhaseStatus(project, phase.id),
        isCustom,
      };
    });

    const computedEnd = cursor;
    const totalEnd = projectEnd && projectEnd > computedEnd ? projectEnd : computedEnd;
    return { bars, totalStart: projectStart, totalEnd };
  }, [project]);

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
    <div className="bg-white border border-stone-200">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">甘特图</span>
            <span className="ml-3 text-[10px] font-mono text-stone-400">
              {formatDate(totalStart)} → {formatDate(totalEnd)}
            </span>
          </div>
          {!readOnly ? (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-2.5 py-1">
              <Pencil size={10} className="text-amber-600" />
              <span className="text-[10px] font-mono text-amber-700 uppercase tracking-wider">双击阶段条可编辑日期</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-stone-100 border border-stone-200 px-2.5 py-1">
              <Lock size={10} className="text-stone-400" />
              <span className="text-[10px] font-mono text-stone-400 uppercase tracking-wider">仅 Owner / 管理层 / PM 可修改阶段日期</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => scrollBy(-200)} className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors" title="向左滚动">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => scrollBy(200)} className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors" title="向右滚动">
            <ChevronRight size={15} />
          </button>
          <div className="w-px h-4 bg-stone-200 mx-1" />
          <button onClick={() => setZoom((z) => Math.min(4, +(z * 1.5).toFixed(2)))} className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors" title="放大">
            <ZoomIn size={15} />
          </button>
          <button onClick={() => setZoom((z) => Math.max(0.3, +(z / 1.5).toFixed(2)))} className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors" title="缩小">
            <ZoomOut size={15} />
          </button>
          <button
            onClick={() => { setZoom(1); setTimeout(scrollToToday, 50); }}
            className="ml-1 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-stone-500 border border-stone-300 hover:bg-stone-50 transition-colors flex items-center gap-1"
          >
            <CalendarDays size={11} />今天
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex overflow-hidden">
        {/* Fixed label column */}
        <div className="shrink-0 border-r border-stone-200" style={{ width: LABEL_WIDTH }}>
          <div className="h-8 border-b border-stone-200 bg-stone-50" />
          {bars.map(({ phase, status, isCustom }) => (
            <div
              key={phase.id}
              onClick={() => onPhaseClick?.(phase.id)}
              className={`flex items-center gap-2 px-3 border-b border-stone-100 cursor-pointer hover:bg-stone-50 transition-colors ${
                status === 'active' ? 'bg-amber-50/40' : ''
              }`}
              style={{ height: ROW_HEIGHT }}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: phase.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 leading-none">{phase.code}</div>
                <div className="text-xs font-medium text-stone-700 leading-tight truncate mt-0.5">{phase.nameEn}</div>
                {isCustom && (
                  <div className="text-[9px] font-mono text-amber-600 leading-none mt-0.5 uppercase tracking-wider">已自定义</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: Math.max(totalWidth, 400), position: 'relative' }}>
            {/* Month header */}
            <div className="h-8 border-b border-stone-200 bg-stone-50 relative" style={{ width: Math.max(totalWidth, 400) }}>
              {monthTicks.map((tick, i) => (
                <div key={i} className="absolute top-0 h-full flex items-center" style={{ left: tick.offsetPx }}>
                  <div className="h-full w-px bg-stone-200" />
                  <span className="text-[10px] font-mono text-stone-400 ml-1.5 whitespace-nowrap">{tick.label}</span>
                </div>
              ))}
              {showToday && (
                <div className="absolute top-0 h-full w-px bg-amber-400 z-10" style={{ left: todayPx }} />
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
                  className={`relative border-b border-stone-100 ${status === 'active' ? 'bg-amber-50/20' : 'bg-white'}`}
                  style={{ height: ROW_HEIGHT, width: Math.max(totalWidth, 400) }}
                >
                  {/* Month grid lines */}
                  {monthTicks.map((tick, i) => (
                    <div key={i} className="absolute top-0 h-full w-px bg-stone-100" style={{ left: tick.offsetPx }} />
                  ))}
                  {showToday && (
                    <div className="absolute top-0 h-full w-px bg-amber-400/50 z-10" style={{ left: todayPx }} />
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
                      <div className="absolute inset-0 flex items-center px-2 pointer-events-none">
                        <span className="text-[10px] font-mono text-white font-semibold drop-shadow-sm truncate">
                          {progress}%
                        </span>
                      </div>
                    )}
                    {/* Edit hint on hover */}
                    {!readOnly && (
                      <div className="absolute -top-5 left-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                        <span className="text-[9px] font-mono text-stone-500 bg-white border border-stone-200 px-1.5 py-0.5">
                          {formatDate(startDate)} → {formatDate(endDate)} · 双击编辑
                        </span>
                      </div>
                    )}
                    {/* Gate marker */}
                    <div className="absolute top-1/2 -translate-y-1/2 -right-0.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Flag size={12} className="text-stone-700" />
                    </div>
                    {/* Custom indicator */}
                    {isCustom && (
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full z-20" title="已自定义日期" />
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
                <div className="absolute top-8 bottom-0 z-20 pointer-events-none" style={{ left: targetPx }}>
                  <div className="w-px h-full" style={{ borderLeft: '2px dashed #f87171' }} />
                  <div className="absolute top-1 left-1 bg-rose-50 border border-rose-300 px-1.5 py-0.5 whitespace-nowrap">
                    <span className="text-[9px] font-mono text-rose-600 uppercase tracking-wider">目标</span>
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
          <div className="border-t border-amber-200 bg-amber-50/60 px-5 py-3">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: bar.phase.color }} />
                <span className="text-sm font-medium text-stone-900">{bar.phase.name}</span>
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-wider">{bar.phase.code}</span>
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
                  className="text-[10px] font-mono uppercase tracking-wider text-stone-500 hover:text-rose-600 border border-stone-300 hover:border-rose-300 px-2.5 py-1 transition-colors"
                >
                  重置为默认
                </button>
              )}
              <button
                onClick={() => { setEditingPhase(null); setEditingField(null); }}
                className="ml-auto text-[10px] font-mono uppercase tracking-wider text-stone-500 hover:text-stone-900 border border-stone-300 hover:border-stone-500 px-2.5 py-1 transition-colors flex items-center gap-1"
              >
                <Check size={11} />完成
              </button>
            </div>
            <div className="mt-2 text-[10px] font-mono text-amber-600">
              修改将自动保存 · 橙色圆点标记已自定义日期的阶段
            </div>
          </div>
        );
      })()}

      {/* Legend */}
      <div className="flex items-center gap-6 px-5 py-3 border-t border-stone-100 bg-stone-50 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-stone-400 opacity-80" />
          <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">已完成</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-amber-500 opacity-80" />
          <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">进行中</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-stone-200" />
          <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">待开始</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">已自定义日期</span>
        </div>
        {showToday && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-px border-t-2 border-amber-400" />
            <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">今天</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-px border-t-2 border-dashed border-rose-400" />
          <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">目标日期</span>
        </div>
      </div>
    </div>
  );
}
