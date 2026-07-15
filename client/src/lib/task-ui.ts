// 任务状态 / 优先级的展示口径（标签 + 配色）全站唯一定义。
// 列表 / 看板 / 甘特 / 任务详情共用，避免各视图自带一套映射后文案与颜色漂移。
import type { TaskStatus, TaskPriority } from '@shared/const';

export type TaskTone = { color: string; bg: string; border: string };

export const TASK_STATUS_UI: Record<TaskStatus, { label: string; tone: TaskTone }> = {
  todo:        { label: '待开始',  tone: { color: 'var(--secondary-foreground)', bg: 'var(--secondary)', border: 'var(--border)' } },
  in_progress: { label: '进行中',  tone: { color: 'var(--primary)', bg: 'var(--acc-soft)', border: 'var(--acc-border)' } },
  blocked:     { label: '已阻塞',  tone: { color: 'var(--destructive)', bg: 'color-mix(in srgb, var(--destructive) 10%, transparent)', border: 'color-mix(in srgb, var(--destructive) 30%, transparent)' } },
  done:        { label: '已完成',  tone: { color: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 12%, transparent)', border: 'color-mix(in srgb, var(--success) 30%, transparent)' } },
  skipped:     { label: '已跳过',  tone: { color: 'var(--muted-foreground)', bg: 'var(--secondary)', border: 'var(--border)' } },
  pending_approval: { label: '待审批', tone: { color: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 14%, transparent)', border: 'color-mix(in srgb, var(--warning) 32%, transparent)' } },
};

export const TASK_PRIORITY_UI: Record<TaskPriority, { label: string; tone: TaskTone; dot: string }> = {
  critical: { label: '紧急', tone: { color: 'var(--destructive)', bg: 'color-mix(in srgb, var(--destructive) 10%, transparent)', border: 'color-mix(in srgb, var(--destructive) 30%, transparent)' }, dot: 'var(--destructive)' },
  high:     { label: '高',   tone: { color: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 12%, transparent)', border: 'color-mix(in srgb, var(--warning) 30%, transparent)' }, dot: 'var(--warning)' },
  medium:   { label: '中',   tone: { color: 'var(--primary)', bg: 'var(--acc-soft)', border: 'var(--acc-border)' }, dot: 'var(--primary)' },
  low:      { label: '低',   tone: { color: 'var(--muted-foreground)', bg: 'var(--secondary)', border: 'var(--border)' }, dot: 'var(--muted-foreground)' },
};

/** 任务详情等处的优先级下拉选项（P0-P3 前缀是任务域惯用叫法） */
export const TASK_PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'critical', label: 'P0 紧急' },
  { value: 'high', label: 'P1 高' },
  { value: 'medium', label: 'P2 中' },
  { value: 'low', label: 'P3 低' },
];
