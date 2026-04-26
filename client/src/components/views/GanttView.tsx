// Design: Industrial Precision - stone/amber color system
// GanttView: horizontal Gantt chart showing project phases on a timeline
// Computes phase date ranges from project.startDate + SOP phase durations

import { useMemo, useRef, useState } from 'react';
import { Flag, CalendarDays, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { Project, SOP_PHASES, PHASE_MAP, computePhaseProgress, getPhaseStatus } from '@/lib/data';

// ── Duration helpers ──────────────────────────────────────────────────────────
// Map each SOP phase to a nominal number of days (midpoint of range)
const PHASE_DAYS: Record<string, number> = {
  concept:  21,   // 2-4 weeks → 3 weeks
  planning: 90,   // 3-4 months → ~3 months
  design:   63,   // 6-12 weeks → ~9 weeks
  evt:      35,   // 4-6 weeks → 5 weeks
  dvt:      42,   // 4-8 weeks → 6 weeks
  pvt:      35,   // 3-6 weeks → 5 weeks
  mp:       60,   // ongoing → show 2 months
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

function formatDate(d: Date): string {
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short' });
}

interface PhaseBar {
  phase: (typeof SOP_PHASES)[0];
  startDate: Date;
  endDate: Date;
  progress: number;
  status: 'completed' | 'active' | 'pending';
}

interface GanttViewProps {
  project: Project;
  onPhaseClick?: (phaseId: string) => void;
}

export function GanttView({ project, onPhaseClick }: GanttViewProps) {
  const [zoom, setZoom] = useState(1); // 1 = default, 0.5 = zoomed out, 2 = zoomed in
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Compute phase bars ────────────────────────────────────────────────────
  const { bars, totalStart, totalEnd } = useMemo(() => {
    const start = parseDate(project.startDate) || new Date();
    const end = parseDate(project.targetDate);

    // Compute start/end for each phase sequentially
    let cursor = new Date(start);
    const bars: PhaseBar[] = SOP_PHASES.map((phase) => {
      const days = PHASE_DAYS[phase.id] ?? 30;
      const phaseStart = new Date(cursor);
      const phaseEnd = addDays(cursor, days);
      cursor = new Date(phaseEnd);

      return {
        phase,
        startDate: phaseStart,
        endDate: phaseEnd,
        progress: computePhaseProgress(project.phases[phase.id], phase.id),
        status: getPhaseStatus(project, phase.id),
      };
    });

    // If project has a target date, scale the last bar to fit
    const computedEnd = cursor;
    const totalEnd = end && end > computedEnd ? end : computedEnd;

    return { bars, totalStart: start, totalEnd };
  }, [project]);

  // ── Timeline grid ─────────────────────────────────────────────────────────
  const totalDays = Math.max(
    1,
    Math.ceil((totalEnd.getTime() - totalStart.getTime()) / (1000 * 60 * 60 * 24))
  );

  // Base pixels per day, scaled by zoom
  const BASE_PX_PER_DAY = 4;
  const pxPerDay = BASE_PX_PER_DAY * zoom;
  const totalWidth = Math.round(totalDays * pxPerDay);

  // Generate month tick marks
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

  // Today marker
  const today = new Date();
  const todayOffsetDays = (today.getTime() - totalStart.getTime()) / (1000 * 60 * 60 * 24);
  const todayPx = Math.round(todayOffsetDays * pxPerDay);
  const showToday = todayOffsetDays >= 0 && todayOffsetDays <= totalDays;

  // ── Bar position helpers ──────────────────────────────────────────────────
  const barLeft = (d: Date) =>
    Math.max(0, Math.round(((d.getTime() - totalStart.getTime()) / (1000 * 60 * 60 * 24)) * pxPerDay));
  const barWidth = (s: Date, e: Date) =>
    Math.max(8, Math.round(((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) * pxPerDay));

  // ── Scroll helpers ────────────────────────────────────────────────────────
  const scrollBy = (px: number) => {
    scrollRef.current?.scrollBy({ left: px, behavior: 'smooth' });
  };

  // Scroll to today on mount
  const scrollToToday = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayPx - 120);
    }
  };

  const ROW_HEIGHT = 44;
  const LABEL_WIDTH = 140;

  return (
    <div className="bg-white border border-stone-200">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">甘特图</span>
          <span className="ml-3 text-[10px] font-mono text-stone-400">
            {formatDate(totalStart)} → {formatDate(totalEnd)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scrollBy(-200)}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            title="向左滚动"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => scrollBy(200)}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            title="向右滚动"
          >
            <ChevronRight size={15} />
          </button>
          <div className="w-px h-4 bg-stone-200 mx-1" />
          <button
            onClick={() => setZoom((z) => Math.min(4, +(z * 1.5).toFixed(2)))}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            title="放大"
          >
            <ZoomIn size={15} />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.3, +(z / 1.5).toFixed(2)))}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            title="缩小"
          >
            <ZoomOut size={15} />
          </button>
          <button
            onClick={() => { setZoom(1); setTimeout(scrollToToday, 50); }}
            className="ml-1 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-stone-500 border border-stone-300 hover:bg-stone-50 transition-colors flex items-center gap-1"
            title="跳到今天"
          >
            <CalendarDays size={11} />
            今天
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex overflow-hidden">
        {/* Fixed label column */}
        <div className="shrink-0 border-r border-stone-200" style={{ width: LABEL_WIDTH }}>
          {/* Header spacer */}
          <div className="h-8 border-b border-stone-200 bg-stone-50" />
          {bars.map(({ phase, status }) => (
            <div
              key={phase.id}
              onClick={() => onPhaseClick?.(phase.id)}
              className={`flex items-center gap-2 px-3 border-b border-stone-100 cursor-pointer hover:bg-stone-50 transition-colors ${
                status === 'active' ? 'bg-amber-50/40' : ''
              }`}
              style={{ height: ROW_HEIGHT }}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: phase.color }} />
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 leading-none">
                  {phase.code}
                </div>
                <div className="text-xs font-medium text-stone-700 leading-tight truncate mt-0.5">
                  {phase.nameEn}
                </div>
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
                <div
                  key={i}
                  className="absolute top-0 h-full flex items-center"
                  style={{ left: tick.offsetPx }}
                >
                  <div className="h-full w-px bg-stone-200" />
                  <span className="text-[10px] font-mono text-stone-400 ml-1.5 whitespace-nowrap">
                    {tick.label}
                  </span>
                </div>
              ))}
              {/* Today marker in header */}
              {showToday && (
                <div
                  className="absolute top-0 h-full w-px bg-amber-400 z-10"
                  style={{ left: todayPx }}
                />
              )}
            </div>

            {/* Rows */}
            {bars.map(({ phase, startDate, endDate, progress, status }) => {
              const left = barLeft(startDate);
              const width = barWidth(startDate, endDate);

              return (
                <div
                  key={phase.id}
                  className={`relative border-b border-stone-100 ${
                    status === 'active' ? 'bg-amber-50/20' : 'bg-white'
                  }`}
                  style={{ height: ROW_HEIGHT, width: Math.max(totalWidth, 400) }}
                >
                  {/* Month grid lines */}
                  {monthTicks.map((tick, i) => (
                    <div
                      key={i}
                      className="absolute top-0 h-full w-px bg-stone-100"
                      style={{ left: tick.offsetPx }}
                    />
                  ))}

                  {/* Today line */}
                  {showToday && (
                    <div
                      className="absolute top-0 h-full w-px bg-amber-400/50 z-10"
                      style={{ left: todayPx }}
                    />
                  )}

                  {/* Phase bar */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 cursor-pointer group"
                    style={{ left, width }}
                    onClick={() => onPhaseClick?.(phase.id)}
                    title={`${phase.name}: ${formatDate(startDate)} → ${formatDate(endDate)}`}
                  >
                    {/* Background track */}
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
                    {/* Label inside bar (only if wide enough) */}
                    {width > 60 && (
                      <div className="absolute inset-0 flex items-center px-2 pointer-events-none">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-white font-semibold drop-shadow-sm truncate">
                          {progress}%
                        </span>
                      </div>
                    )}
                    {/* Gate marker at end */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -right-0.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Flag size={12} className="text-stone-700" />
                    </div>
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
                <div
                  className="absolute top-8 bottom-0 z-20 pointer-events-none"
                  style={{ left: targetPx }}
                >
                  <div className="w-px h-full bg-rose-400 border-dashed" style={{ borderLeft: '2px dashed #f87171' }} />
                  <div className="absolute top-1 left-1 bg-rose-50 border border-rose-300 px-1.5 py-0.5 whitespace-nowrap">
                    <span className="text-[9px] font-mono text-rose-600 uppercase tracking-wider">目标</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

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
        {showToday && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-px bg-amber-400 border-t-2 border-amber-400" />
            <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">今天</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-px border-t-2 border-dashed border-rose-400" />
          <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider">目标日期</span>
        </div>
        <div className="ml-auto text-[10px] font-mono text-stone-400">
          点击阶段条可跳转至任务列表
        </div>
      </div>
    </div>
  );
}
