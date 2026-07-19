// 甘特时间轴脚手架（B8 收敛）：任务级甘特（TaskGanttView）与阶段级甘特（GanttView）
// 共用同一套 日期解析 / 月刻度 / 缩放换算 / 今天线 计算，避免两套实现各自漂移。
import { useMemo } from 'react';

export const DAY_MS = 86400000;

export function parseGanttDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export const formatGanttMonth = (d: Date) =>
  d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short' });

export function useGanttTimeline({
  totalStart,
  totalEnd,
  zoom,
  basePxPerDay,
  minBarPx,
  inclusiveEnd = false,
  clampLeft = false,
}: {
  totalStart: Date;
  totalEnd: Date;
  zoom: number;
  /** zoom=1 时每天的像素宽 */
  basePxPerDay: number;
  /** 条形最小宽度（像素） */
  minBarPx: number;
  /** 起止均含当天（任务条 +1 天宽度）还是半开区间（阶段条） */
  inclusiveEnd?: boolean;
  /** 条形左缘是否夹到 0（阶段条起点可能早于总起点） */
  clampLeft?: boolean;
}) {
  const totalDays = Math.max(
    1,
    Math.ceil((totalEnd.getTime() - totalStart.getTime()) / DAY_MS) + (inclusiveEnd ? 1 : 0),
  );
  const pxPerDay = basePxPerDay * zoom;
  const totalWidth = Math.round(totalDays * pxPerDay);

  const left = (d: Date) => {
    const x = Math.round(((d.getTime() - totalStart.getTime()) / DAY_MS) * pxPerDay);
    return clampLeft ? Math.max(0, x) : x;
  };
  const width = (s: Date, e: Date) =>
    Math.max(minBarPx, Math.round(((e.getTime() - s.getTime()) / DAY_MS + (inclusiveEnd ? 1 : 0)) * pxPerDay));

  const monthTicks = useMemo(() => {
    const ticks: { label: string; x: number }[] = [];
    const d = new Date(totalStart);
    d.setDate(1);
    if (d < totalStart) d.setMonth(d.getMonth() + 1);
    while (d <= totalEnd) {
      ticks.push({
        label: formatGanttMonth(d),
        x: Math.round(((d.getTime() - totalStart.getTime()) / DAY_MS) * pxPerDay),
      });
      d.setMonth(d.getMonth() + 1);
    }
    return ticks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalStart.getTime(), totalEnd.getTime(), pxPerDay]);

  const today = new Date();
  const todayOffsetDays = (today.getTime() - totalStart.getTime()) / DAY_MS;
  const todayX = Math.round(todayOffsetDays * pxPerDay);
  const showToday = todayOffsetDays >= 0 && todayOffsetDays <= totalDays + 7;

  return { totalDays, pxPerDay, totalWidth, left, width, monthTicks, todayX, showToday };
}
