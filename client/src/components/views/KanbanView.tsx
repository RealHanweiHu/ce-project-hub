/**
 * KanbanView — Drag-and-drop task board for PLM project management.
 *
 * Features:
 * - Group by status (todo/in_progress/blocked/done/cancelled)
 * - Group by assignee (each person gets a column)
 * - Drag tasks between columns to change status or reassign
 * - Visual indicators for priority, risk, overdue, approval
 * - Compact card design with key metadata
 */

import { useState, useRef, useCallback } from 'react';
import {
  GripVertical, User, Clock, AlertTriangle, Flag, Shield,
  CheckCircle2, Circle, Pause, XCircle, LayoutGrid,
} from 'lucide-react';
import type { SOPTask, TaskDetails, TaskStatus, TaskPriority, RiskLevel } from '@/lib/data';

// ── Types ────────────────────────────────────────────────────────────────────

interface KanbanTask {
  /** SOP task definition */
  task: SOPTask;
  /** Task details from DB */
  details: TaskDetails;
  /** Phase ID */
  phaseId: string;
  /** Composite key */
  key: string;
  /** Whether task is completed */
  completed: boolean;
}

interface KanbanViewProps {
  /** All tasks across phases */
  tasks: KanbanTask[];
  /** Callback when a task's status changes via drag */
  onStatusChange: (phaseId: string, taskId: string, newStatus: TaskStatus) => void;
  /** Callback when a task's assignee changes via drag (group by assignee mode) */
  onAssigneeChange?: (phaseId: string, taskId: string, newAssigneeId: number | null) => void;
  /** Available team members for assignee columns */
  members?: Array<{ id: number; name: string }>;
  /** Click handler for task card */
  onTaskClick?: (phaseId: string, taskId: string) => void;
}

// ── Status Column Config ─────────────────────────────────────────────────────

const STATUS_COLUMNS: Array<{
  id: TaskStatus;
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
}> = [
  { id: 'todo',        label: '待办',   icon: <Circle size={12} />,       color: 'text-stone-500', bg: 'bg-stone-50',   border: 'border-stone-200' },
  { id: 'in_progress', label: '进行中', icon: <Clock size={12} />,        color: 'text-blue-600',  bg: 'bg-blue-50',    border: 'border-blue-200' },
  { id: 'blocked',     label: '阻塞',   icon: <Pause size={12} />,        color: 'text-rose-600',  bg: 'bg-rose-50',    border: 'border-rose-200' },
  { id: 'done',        label: '已完成', icon: <CheckCircle2 size={12} />, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { id: 'cancelled',   label: '已取消', icon: <XCircle size={12} />,      color: 'text-stone-400', bg: 'bg-stone-50',   border: 'border-stone-200' },
];

const PRIORITY_CONFIG: Record<TaskPriority, { color: string; label: string }> = {
  low:      { color: 'text-stone-400', label: '低' },
  medium:   { color: 'text-blue-500',  label: '中' },
  high:     { color: 'text-orange-500', label: '高' },
  critical: { color: 'text-rose-600',  label: '紧急' },
};

const RISK_CONFIG: Record<RiskLevel, { color: string; show: boolean }> = {
  none:     { color: '', show: false },
  low:      { color: 'text-emerald-500', show: false },
  medium:   { color: 'text-amber-500', show: true },
  high:     { color: 'text-orange-600', show: true },
  critical: { color: 'text-rose-600', show: true },
};

// ── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onDragStart,
  onClick,
}: {
  task: KanbanTask;
  onDragStart: (e: React.DragEvent) => void;
  onClick?: () => void;
}) {
  const { task: sopTask, details, completed } = task;
  const priority = (details.taskPriority || 'medium') as TaskPriority;
  const risk = (details.riskLevel || 'none') as RiskLevel;
  const isOverdue = details.dueDate && new Date(details.dueDate) < new Date() && !completed;
  const prCfg = PRIORITY_CONFIG[priority];
  const riskCfg = RISK_CONFIG[risk];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`bg-white border border-stone-200 p-3 cursor-grab active:cursor-grabbing hover:border-stone-400 hover:shadow-sm transition-all group ${
        completed ? 'opacity-60' : ''
      }`}
    >
      {/* Header: priority flag + title */}
      <div className="flex items-start gap-2">
        <GripVertical size={12} className="text-stone-300 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {priority !== 'medium' && (
              <Flag size={10} className={prCfg.color} />
            )}
            {riskCfg.show && (
              <AlertTriangle size={10} className={riskCfg.color} />
            )}
            {isOverdue && (
              <span className="text-[8px] font-mono bg-rose-100 text-rose-600 px-1 py-0.5 border border-rose-200">逾期</span>
            )}
            {details.approvalStatus === 'pending' && (
              <Shield size={10} className="text-amber-500" />
            )}
          </div>
          <p className={`text-xs font-medium text-stone-800 leading-tight ${completed ? 'line-through text-stone-400' : ''}`}>
            {sopTask.name}
          </p>
        </div>
      </div>

      {/* Footer: assignee + due date */}
      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-stone-100">
        <div className="flex items-center gap-1.5">
          {sopTask.owner && (
            <div className="flex items-center gap-1 text-[10px] font-mono text-stone-400">
              <User size={9} />
              <span className="max-w-[60px] truncate">{sopTask.owner}</span>
            </div>
          )}
        </div>
        {details.dueDate && (
          <span className={`text-[10px] font-mono ${isOverdue ? 'text-rose-500 font-bold' : 'text-stone-400'}`}>
            {details.dueDate.slice(5)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Kanban Column ────────────────────────────────────────────────────────────

function KanbanColumn({
  id,
  label,
  icon,
  color,
  bg,
  border,
  tasks,
  onDrop,
  onDragOver,
  onTaskDragStart,
  onTaskClick,
  isDragOver,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  tasks: KanbanTask[];
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onTaskDragStart: (task: KanbanTask) => (e: React.DragEvent) => void;
  onTaskClick?: (phaseId: string, taskId: string) => void;
  isDragOver: boolean;
}) {
  return (
    <div
      className={`flex flex-col min-w-[240px] max-w-[300px] flex-1 border ${border} ${isDragOver ? 'ring-2 ring-stone-400 ring-offset-1' : ''} transition-all`}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {/* Column Header */}
      <div className={`${bg} px-3 py-2.5 border-b ${border} flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-2">
          <span className={color}>{icon}</span>
          <span className={`text-xs font-mono uppercase tracking-wider font-bold ${color}`}>{label}</span>
        </div>
        <span className="text-[10px] font-mono text-stone-400 bg-white px-1.5 py-0.5 border border-stone-200">
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)] bg-stone-50/30">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-[10px] font-mono text-stone-300 uppercase">
            拖拽任务到此列
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.key}
              task={task}
              onDragStart={onTaskDragStart(task)}
              onClick={onTaskClick ? () => onTaskClick(task.phaseId, task.task.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function KanbanView({ tasks, onStatusChange, onAssigneeChange, members = [], onTaskClick }: KanbanViewProps) {
  const [groupBy, setGroupBy] = useState<'status' | 'assignee'>('status');
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const draggedTaskRef = useRef<KanbanTask | null>(null);

  const handleDragStart = useCallback((task: KanbanTask) => (e: React.DragEvent) => {
    draggedTaskRef.current = task;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.key);
  }, []);

  const handleDragOver = useCallback((columnId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  }, []);

  const handleDrop = useCallback((columnId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverColumn(null);
    const task = draggedTaskRef.current;
    if (!task) return;

    if (groupBy === 'status') {
      const newStatus = columnId as TaskStatus;
      const currentStatus = (task.details.taskStatus || 'todo') as TaskStatus;
      if (newStatus !== currentStatus) {
        onStatusChange(task.phaseId, task.task.id, newStatus);
      }
    } else if (groupBy === 'assignee' && onAssigneeChange) {
      const newAssigneeId = columnId === 'unassigned' ? null : parseInt(columnId, 10);
      onAssigneeChange(task.phaseId, task.task.id, newAssigneeId);
    }

    draggedTaskRef.current = null;
  }, [groupBy, onStatusChange, onAssigneeChange]);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  // ── Group tasks by status ──────────────────────────────────────────────────
  const tasksByStatus = STATUS_COLUMNS.map((col) => ({
    ...col,
    tasks: tasks.filter((t) => {
      const status = (t.details.taskStatus || (t.completed ? 'done' : 'todo')) as TaskStatus;
      return status === col.id;
    }),
  }));

  // ── Group tasks by assignee ────────────────────────────────────────────────
  const tasksByAssignee = [
    {
      id: 'unassigned',
      label: '未分配',
      icon: <Circle size={12} />,
      color: 'text-stone-500',
      bg: 'bg-stone-50',
      border: 'border-stone-200',
      tasks: tasks.filter((t) => !t.details.assigneeUserId),
    },
    ...members.map((m) => ({
      id: String(m.id),
      label: m.name,
      icon: <User size={12} />,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      tasks: tasks.filter((t) => t.details.assigneeUserId === m.id),
    })),
  ];

  const columns = groupBy === 'status' ? tasksByStatus : tasksByAssignee;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutGrid size={16} className="text-stone-500" />
          <span className="font-serif text-lg text-stone-900">看板视图</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">
            {tasks.length} 任务
          </span>
        </div>

        {/* Group By Toggle */}
        <div className="flex items-center gap-1 border border-stone-200">
          <button
            onClick={() => setGroupBy('status')}
            className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-all ${
              groupBy === 'status'
                ? 'bg-stone-900 text-white'
                : 'bg-white text-stone-500 hover:bg-stone-50'
            }`}
          >
            按状态
          </button>
          <button
            onClick={() => setGroupBy('assignee')}
            className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-all ${
              groupBy === 'assignee'
                ? 'bg-stone-900 text-white'
                : 'bg-white text-stone-500 hover:bg-stone-50'
            }`}
          >
            按负责人
          </button>
        </div>
      </div>

      {/* Kanban Board */}
      <div
        className="flex gap-3 overflow-x-auto pb-4"
        onDragLeave={handleDragLeave}
      >
        {columns.map((col) => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            label={col.label}
            icon={col.icon}
            color={col.color}
            bg={col.bg}
            border={col.border}
            tasks={col.tasks}
            onDrop={handleDrop(col.id)}
            onDragOver={handleDragOver(col.id)}
            onTaskDragStart={handleDragStart}
            onTaskClick={onTaskClick}
            isDragOver={dragOverColumn === col.id}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] font-mono text-stone-400 border-t border-stone-200 pt-3">
        <span className="uppercase tracking-wider">图例:</span>
        <span className="flex items-center gap-1"><Flag size={9} className="text-orange-500" /> 高优先</span>
        <span className="flex items-center gap-1"><AlertTriangle size={9} className="text-rose-500" /> 高风险</span>
        <span className="flex items-center gap-1"><Shield size={9} className="text-amber-500" /> 待审批</span>
        <span className="flex items-center gap-1"><span className="bg-rose-100 text-rose-600 px-1 py-0.5 border border-rose-200">逾期</span></span>
      </div>
    </div>
  );
}

export default KanbanView;
