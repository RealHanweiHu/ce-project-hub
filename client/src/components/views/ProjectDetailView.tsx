// Design: Industrial Precision - stone/amber color system
// ProjectDetailView: phase navigation, Gantt chart tab, task checklist, task details, file upload

import { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft, CheckCircle2, Circle, ChevronRight,
  Upload, Download, Trash2, Paperclip, FileText, Image as ImageIcon,
  Edit3, Calendar, AlertTriangle, Target, Zap, BarChart2, ListChecks,
  Lock, ShieldAlert, Flag, Bug, GitBranch, Filter, Rocket, LayoutDashboard,
  Inbox, LayoutGrid, FolderOpen, Eye, X,
} from 'lucide-react';
import {
  Project, SOP_PHASES, PHASE_MAP, RISK_CONFIG,
  computePhaseProgress, computeOverallProgress, getPhaseStatus,
  isPhaseUnlocked, getBlockingGate, getProjectPhases,
  TaskDetails, FileAttachment, formatBytes,
} from '@/lib/data';
import { CATEGORY_MAP } from '@/lib/sop-templates';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { GateStandardPanel } from '@/components/shared/GateStandardPanel';
import { GanttView } from './GanttView';
import { IssueList } from './IssueList';
import { ChangeLog } from './ChangeLog';
import { Issue, GateReview, ChangeRecord } from '@/lib/data';
import { GateReviewModal, GateReviewBadge } from './GateReviewModal';
import { ReleaseDialog } from './ReleaseDialog';
import { BomPanel } from './BomPanel';
import { OverviewPanel } from './OverviewPanel';
import { RequirementPoolPanel } from './RequirementPoolPanel';
import { KanbanBoard } from './KanbanBoard';
import { FilesPanel } from './FilesPanel';
import { FilePreviewModal, canPreview } from './FilePreviewModal';
import { useProjectPermission } from '@/hooks/useProjectPermission';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { getTaskDeliverables } from '@shared/task-deliverables';
import { Users } from 'lucide-react';

const MAX_FILE_SIZE = 16 * 1024 * 1024;

interface ProjectDetailViewProps {
  project: Project;
  onUpdate: (project: Project) => void;
  onBack: () => void;
}

function EditableText({
  value, onChange, className = '', placeholder = '点击编辑', inputClassName = '',
}: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
        className={`bg-amber-50 border-b-2 border-amber-500 outline-none px-1 ${inputClassName || className}`}
        placeholder={placeholder}
      />
    );
  }
  return (
    <span
      onClick={() => { setDraft(value || ''); setEditing(true); }}
      className={`${className} cursor-text hover:bg-amber-50/40 rounded px-1 -mx-1 group inline-flex items-center gap-1`}
    >
      {value || <span className="text-stone-400 italic">{placeholder}</span>}
      <Edit3 size={11} className="inline-block ml-1.5 text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity" />
    </span>
  );
}

function EditableSelect({
  value, options, onChange, className = '',
}: {
  value: string; options: string[]; onChange: (v: string) => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        value={value}
        onChange={(e) => { onChange(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
        autoFocus
        className={`bg-amber-50 border-b-2 border-amber-500 outline-none px-1 ${className}`}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`${className} cursor-pointer hover:bg-amber-50/40 rounded px-1 -mx-1`}
    >
      {value}
    </span>
  );
}

function FileUploadArea({
  files, onAdd, onRemove, projectId, phaseId, taskId, readOnly = false,
}: {
  files: FileAttachment[];
  onAdd: (files: FileAttachment[]) => void;
  onRemove: (id: string) => void;
  projectId: string;
  phaseId?: string;
  taskId?: string;
  readOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);

  const handleFiles = async (fileList: FileList) => {
    if (readOnly) return;
    setError('');
    const newFiles: FileAttachment[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`文件 "${file.name}" 超出 ${formatBytes(MAX_FILE_SIZE)} 限制`);
        continue;
      }
      try {
        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', projectId);
        if (phaseId) formData.append('phaseId', phaseId);
        if (taskId) formData.append('taskId', taskId);
        const resp = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: resp.statusText }));
          setError(`上传 "${file.name}" 失败: ${(err as any).error || resp.statusText}`);
          continue;
        }
        const result = await resp.json() as {
          id: number; name: string; mimeType: string; size: number;
          storageKey: string; storageUrl: string;
        };
        newFiles.push({
          id: String(result.id),
          name: result.name,
          size: result.size,
          type: result.mimeType,
          uploadDate: new Date().toISOString().slice(0, 10),
          dataUrl: '',
          storageUrl: result.storageUrl,
          storageKey: result.storageKey,
        });
      } catch (e: any) {
        setError(`上传 "${file.name}" 失败: ${e.message || '网络错误'}`);
      } finally {
        setUploading(false);
      }
    }
    if (newFiles.length > 0) onAdd(newFiles);
  };

  const downloadFile = (file: FileAttachment) => {
    const url = file.storageUrl || file.dataUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = file.name; a.click();
  };
  const getIcon = (type: string) => type?.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />;

  return (
    <div>
      <div
        onClick={() => !readOnly && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!readOnly) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`border-2 border-dashed p-4 text-center transition-colors ${
          readOnly ? 'cursor-not-allowed border-stone-200 bg-stone-50 opacity-70' :
          dragOver ? 'cursor-pointer border-amber-500 bg-amber-50' : 'cursor-pointer border-stone-300 hover:border-stone-400'
        }`}
      >
        <input ref={inputRef} type="file" multiple onChange={(e) => handleFiles(e.target.files!)} className="hidden" disabled={uploading || readOnly} />
        <Upload size={18} className={`mx-auto mb-2 ${uploading ? 'text-amber-400 animate-pulse' : 'text-stone-400'}`} />
        <div className="text-sm text-stone-700">
          {readOnly ? '仅可查看附件' : uploading ? '上传中...' : <><span className="font-medium">点击上传</span>或拖拽文件</>}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mt-1">
          单个文件最大 {formatBytes(MAX_FILE_SIZE)} · 支持 PDF / 图片 / Office 文档
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5">{error}</div>}
      {files && files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {files.map((file) => {
            const previewable = canPreview(file);
            return (
            <div key={file.id} className="flex items-center gap-3 p-2.5 bg-white border border-stone-200 group">
              <span className="text-stone-500 shrink-0">{getIcon(file.type)}</span>
              <div
                className={`flex-1 min-w-0 ${previewable ? 'cursor-pointer' : ''}`}
                onClick={(e) => { if (previewable) { e.stopPropagation(); setPreviewFile(file); } }}
              >
                <div className={`text-sm text-stone-900 truncate ${previewable ? 'group-hover:text-amber-700' : ''}`}>{file.name}</div>
                <div className="text-[10px] font-mono text-stone-500">{formatBytes(file.size)}</div>
              </div>
              {previewable && (
                <button onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }} title="预览" className="p-1.5 text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors">
                  <Eye size={13} />
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); downloadFile(file); }} title="下载" className="p-1.5 text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors">
                <Download size={13} />
              </button>
              {!readOnly && (
                <button onClick={(e) => { e.stopPropagation(); if (confirm('删除文件？')) onRemove(file.id); }} className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            );
          })}
        </div>
      )}
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

// Role labels for visibleRoles selector
const ROLE_OPTIONS = [
  { value: 'rd_hw',  label: '硬件研发' },
  { value: 'rd_sw',  label: '软件研发' },
  { value: 'rd_mech', label: '结构/ID' },
  { value: 'qa',     label: '测试/品质' },
  { value: 'scm',    label: '供应链' },
  { value: 'pm',     label: '产品经理' },
  { value: 'manager', label: '管理层' },
  { value: 'owner',  label: '项目创建者' },
] as const;

/** 任务交付物清单：模板预置交付物 + 完成勾选（持久化到 project_tasks.deliverables） */
function DeliverablesChecklist({
  projectId, phaseId, taskId, items, status, canEdit,
}: {
  projectId: string;
  phaseId: string;
  taskId: string;
  items: string[];
  status: Record<string, boolean>;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [pending, setPending] = useState<string | null>(null);
  const mutation = trpc.tasks.setDeliverable.useMutation({
    onSettled: () => { utils.tasks.list.invalidate({ projectId }); setPending(null); },
  });
  const doneCount = items.filter((d) => status[d]).length;

  if (items.length === 0) return <div className="text-sm text-stone-400">无预置交付物</div>;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-stone-400">{doneCount}/{items.length} 完成</span>
        {doneCount === items.length && <span className="text-[10px] font-mono text-emerald-600">✓ 全部交付</span>}
      </div>
      {items.map((d) => {
        const done = !!status[d];
        return (
          <button
            key={d}
            disabled={!canEdit || pending === d}
            onClick={() => { setPending(d); mutation.mutate({ projectId, phaseId, taskId, name: d, done: !done }); }}
            className={`w-full flex items-start gap-2 text-left text-sm py-0.5 ${canEdit ? 'hover:bg-stone-50 cursor-pointer' : 'cursor-default'} ${pending === d ? 'opacity-50' : ''}`}
          >
            {done
              ? <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-600" />
              : <Circle size={15} className="shrink-0 mt-0.5 text-stone-300" />}
            <span className={done ? 'text-stone-400 line-through' : 'text-stone-700'}>{d}</span>
          </button>
        );
      })}
    </div>
  );
}

function TaskDetail({
  taskId, taskDetails, onUpdate, visibleRoles, onVisibleRolesChange, canEditRoles,
  projectId, phaseId, canEdit = true,
}: {
  taskId: string;
  taskDetails: TaskDetails;
  onUpdate: (details: TaskDetails) => void;
  visibleRoles?: string[];
  onVisibleRolesChange?: (roles: string[]) => void;
  canEditRoles?: boolean;
  projectId: string;
  phaseId?: string;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState(taskDetails?.instructions || '');
  const [dirty, setDirty] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();
  const deleteFileMutation = trpc.files.delete.useMutation({
    onSuccess: () => {
      // Invalidate files.list so useProjectData re-fetches the updated list
      utils.files.list.invalidate({ projectId });
    },
  });

  const handleChange = (val: string) => {
    if (!canEdit) return;
    setDraft(val); setDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onUpdate({ ...taskDetails, instructions: val }); setDirty(false);
    }, 800);
  };

  const handleBlur = () => {
    if (!canEdit) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (draft !== taskDetails?.instructions) { onUpdate({ ...taskDetails, instructions: draft }); setDirty(false); }
  };

  const handleRemoveFile = async (id: string) => {
    if (!canEdit) return;
    if (!confirm('确定删除此文件？该操作不可撤销。')) return;
    const numId = parseInt(id, 10);
    if (!isNaN(numId)) {
      // DB-backed file: delete via tRPC (removes DB row + invalidates S3 object)
      await deleteFileMutation.mutateAsync({ id: numId, projectId });
    } else {
      // Legacy local-only file: just remove from local state
      onUpdate({ ...taskDetails, files: (taskDetails?.files || []).filter((f) => f.id !== id) });
    }
  };

  // Task meta: users for assignee dropdown
  const { data: metaUsers = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const TASK_STATUS_OPTIONS = [
    { value: 'todo', label: '待开始' },
    { value: 'in_progress', label: '进行中' },
    { value: 'blocked', label: '阻塞' },
    { value: 'done', label: '已完成' },
    { value: 'skipped', label: '跳过' },
  ];
  const TASK_PRIORITY_OPTIONS = [
    { value: 'critical', label: 'P0 紧急' },
    { value: 'high', label: 'P1 高' },
    { value: 'medium', label: 'P2 中' },
    { value: 'low', label: 'P3 低' },
  ];

  return (
    <div className="mt-3 border-t border-stone-100 pt-3 space-y-3">
      {/* Task Meta Row: assignee / due date / status / priority */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">负责人</div>
          <select
            value={taskDetails?.assigneeUserId ?? ''}
            disabled={!canEdit}
            onChange={(e) => {
              const val = e.target.value;
              onUpdate({ ...taskDetails, assigneeUserId: val === '' ? null : Number(val) });
            }}
            className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 px-2 py-1 outline-none focus:border-amber-400 transition-colors"
          >
            <option value="">— 未指定 —</option>
            {metaUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.username}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">截止日期</div>
          <input
            type="date"
            value={taskDetails?.dueDate ?? ''}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...taskDetails, dueDate: e.target.value || null })}
            className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 px-2 py-1 outline-none focus:border-amber-400 transition-colors"
          />
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">状态</div>
          <select
            value={taskDetails?.taskStatus ?? 'todo'}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...taskDetails, taskStatus: e.target.value })}
            className="w-full text-xs bg-stone-50 border border-stone-200 px-2 py-1 outline-none focus:border-amber-400 transition-colors"
          >
            {TASK_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">优先级</div>
          <select
            value={taskDetails?.taskPriority ?? 'medium'}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...taskDetails, taskPriority: e.target.value })}
            className="w-full text-xs bg-stone-50 border border-stone-200 px-2 py-1 outline-none focus:border-amber-400 transition-colors"
          >
            {TASK_PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1.5">执行说明</div>
        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            disabled={!canEdit}
            rows={4}
            placeholder="记录执行说明、注意事项、进展备注..."
            className="w-full px-3 py-2 border border-stone-200 focus:border-stone-400 outline-none text-xs text-stone-700 resize-none transition-colors"
          />
          {dirty && <div className="absolute bottom-2 right-2 text-[9px] font-mono text-stone-400">保存中...</div>}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1.5 flex items-center gap-1.5">
          <Paperclip size={10} />附件
        </div>
        <FileUploadArea
          files={taskDetails?.files || []}
          onAdd={(newFiles) => {
            onUpdate({ ...taskDetails, files: [...(taskDetails?.files || []), ...newFiles] });
            // Invalidate files.list so useProjectData re-fetches the updated list from DB
            utils.files.list.invalidate({ projectId });
          }}
          onRemove={handleRemoveFile}
          projectId={projectId}
          phaseId={phaseId}
          taskId={taskId}
          readOnly={!canEdit}
        />
      </div>
      {/* Visible Roles Selector - only shown to canEditProjectInfo users */}
      {canEditRoles && onVisibleRolesChange && (
        <div className="border-t border-stone-100 pt-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-2 flex items-center gap-1.5">
            <Lock size={10} />可见岗位（空=所有人可见）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ROLE_OPTIONS.map(({ value, label }) => {
              const selected = (visibleRoles || []).includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    const current = visibleRoles || [];
                    const next = selected
                      ? current.filter((r) => r !== value)
                      : [...current, value];
                    onVisibleRolesChange(next);
                  }}
                  className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${
                    selected
                      ? 'bg-amber-500 text-stone-900 border-amber-500'
                      : 'bg-white text-stone-500 border-stone-200 hover:border-amber-400'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {(visibleRoles || []).length === 0 && (
            <p className="text-[10px] text-stone-400 mt-1">未选择岗位时所有成员均可见此任务</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
// ── PM Selector ──────────────────────────────────────────────────────────────
function PmSelector({
  pmUserId,
  onChange,
  disabled,
}: {
  pmUserId: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
}) {
  const { data: users = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, {
    staleTime: 60_000,
  });
  const selected = users.find((u) => u.id === pmUserId);
  const displayName = selected ? (selected.name || selected.username) : '—';

  if (disabled) {
    return <span className="text-xs text-stone-700">{displayName}</span>;
  }

  return (
    <select
      value={pmUserId ?? ''}
      onChange={(e) => {
        const val = e.target.value;
        onChange(val === '' ? null : Number(val));
      }}
      className="text-xs text-stone-700 bg-transparent border-none outline-none cursor-pointer hover:text-amber-600 transition-colors"
    >
      <option value="">— 未指定 —</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name || u.username}
        </option>
      ))}
    </select>
  );
}

export function ProjectDetailView({ project, onUpdate, onBack }: ProjectDetailViewProps) {
  const [activePhaseId, setActivePhaseId] = useState(project.currentPhase);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // 任务详情子窗口：Esc 关闭
  useEffect(() => {
    if (!selectedTaskId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedTaskId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTaskId]);
  const [mainTab, setMainTab] = useState<'overview' | 'tasks' | 'kanban' | 'requirements' | 'gantt' | 'issues' | 'changelog' | 'bom' | 'files'>('overview');
  const perms = useProjectPermission(project.id);
  const { user: currentUser } = useAuth();

  // Change Log helpers
  const changeLog: ChangeRecord[] = project.changeLog || [];
  const pendingChangeCount = changeLog.filter((r) => r.status === 'proposed').length;
  const updateChangeLog = (records: ChangeRecord[]) => {
    onUpdate({ ...project, changeLog: records });
  };

  const projectPhases = getProjectPhases(project);
  const phaseMap = Object.fromEntries(projectPhases.map((p) => [p.id, p]));
  const activePhase = phaseMap[activePhaseId] || PHASE_MAP[activePhaseId];
  const activePhaseData = project.phases[activePhaseId];
  const activeProgress = computePhaseProgress(activePhaseData, activePhaseId, activePhase);
  const overallProgress = computeOverallProgress(project);
  const risk = RISK_CONFIG[project.risk];
  const isCurrentPhaseUnlocked = isPhaseUnlocked(project, activePhaseId);
  const blockingGate = getBlockingGate(project, activePhaseId);
  const catConfig = project.category ? CATEGORY_MAP[project.category] : null;
  const visibleActiveTasks = activePhase?.tasks.filter((task) => {
    const effectiveRoles = project.taskVisibleRoles?.[task.id] ?? (task.visibleRoles || []);
    if (!effectiveRoles || effectiveRoles.length === 0) return true;
    if (perms.role === 'owner') return true;
    return effectiveRoles.includes(perms.role);
  }) || [];
  const selectedTask = selectedTaskId
    ? visibleActiveTasks.find((task) => task.id === selectedTaskId) || null
    : null;
  const selectedTaskDetails = selectedTask ? activePhaseData?.taskDetails?.[selectedTask.id] : undefined;
  const selectedTaskChecked = selectedTask ? Boolean(activePhaseData?.tasks?.[selectedTask.id]) : false;
  const selectedTaskIsGate = !!selectedTask && selectedTask.id === activePhase?.gateTaskId;
  const selectedTaskRoles = selectedTask
    ? project.taskVisibleRoles?.[selectedTask.id] ?? (selectedTask.visibleRoles || [])
    : [];
  const selectedTaskRoleLabels = selectedTaskRoles.length > 0
    ? selectedTaskRoles.map((role) => ROLE_OPTIONS.find((option) => option.value === role)?.label || role).join(' / ')
    : '所有项目成员';

  const updateField = (field: keyof Project, value: string) => onUpdate({ ...project, [field]: value });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateFieldAny = (field: keyof Project, value: any) => onUpdate({ ...project, [field]: value });

  const toggleTask = (taskId: string) => {
    // Gate lock check: if this phase is locked, disallow toggling
    if (!isPhaseUnlocked(project, activePhaseId)) return;
    if (!perms.canEditTasks) return;
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = {
      ...activePhaseData,
      tasks: { ...activePhaseData.tasks, [taskId]: !activePhaseData.tasks[taskId] },
    };
    const newProgress = computePhaseProgress(newProject.phases[activePhaseId], activePhaseId, activePhase);
    if (newProgress === 100) {
      const idx = projectPhases.findIndex((p) => p.id === activePhaseId);
      if (idx < projectPhases.length - 1 && activePhaseId === project.currentPhase) {
        newProject.currentPhase = projectPhases[idx + 1].id;
      }
    }
    onUpdate(newProject);
  };

  const updateTaskDetails = (taskId: string, details: TaskDetails) => {
    if (!perms.canEditTasks) return;
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = {
      ...activePhaseData,
      taskDetails: { ...activePhaseData.taskDetails, [taskId]: details },
    };
    onUpdate(newProject);
  };

  // When user clicks a phase bar in Gantt, switch to tasks tab and jump to that phase
  const handleGanttPhaseClick = (phaseId: string) => {
    setActivePhaseId(phaseId);
    setSelectedTaskId(null);
    setMainTab('tasks');
  };

  // Issue List helpers
  const activeIssues: Issue[] = activePhaseData?.issues || [];
  const openIssueCount = activeIssues.filter((i) => i.status === 'open' || i.status === 'in_progress').length;

  const updateIssues = (issues: Issue[]) => {
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = { ...activePhaseData, issues };
    onUpdate(newProject);
  };

  // Gate Review Modal state
  const [gateReviewPending, setGateReviewPending] = useState<{ phaseId: string } | null>(null);
  // MP Release dialog state
  const [releaseOpen, setReleaseOpen] = useState(false);

  const handleGateTaskToggle = (taskId: string) => {
    // If checking a gate task (not unchecking), show review modal
    const isChecking = !activePhaseData?.tasks[taskId];
    if (isChecking && taskId === activePhase?.gateTaskId) {
      setGateReviewPending({ phaseId: activePhaseId });
      return;
    }
    toggleTask(taskId);
  };

  const handleGateReviewConfirm = (review: GateReview) => {
    // Save review record + mark gate task as done + advance phase
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    const gateTaskId = activePhase?.gateTaskId || '';
    const prevReviews = activePhaseData?.gateReviews || [];
    // Only mark gate task done if decision is approved or conditional
    const shouldMarkDone = review.decision !== 'rejected';
    newProject.phases[activePhaseId] = {
      ...activePhaseData,
      tasks: shouldMarkDone
        ? { ...activePhaseData.tasks, [gateTaskId]: true }
        : activePhaseData.tasks,
      gateReviews: [...prevReviews, review],
    };
    // Advance to next phase if approved/conditional and this was current
    if (shouldMarkDone) {
      const idx = projectPhases.findIndex((p) => p.id === activePhaseId);
      if (idx < projectPhases.length - 1 && activePhaseId === project.currentPhase) {
        newProject.currentPhase = projectPhases[idx + 1].id;
      }
    }
    onUpdate(newProject);
    setGateReviewPending(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-mono text-stone-500 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft size={14} /> 返回项目列表
          </button>
          {perms.canGateReview && (
            <button
              onClick={() => setReleaseOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium bg-stone-900 hover:bg-stone-800 text-stone-50 px-3 py-1.5 transition-colors"
            >
              <Rocket size={13} /> 量产发布
            </button>
          )}
        </div>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <EditableText value={project.code} onChange={perms.canEditProjectInfo ? (v) => updateField('code', v) : () => {}} className="text-[10px] font-mono uppercase tracking-widest text-stone-400" />
              {catConfig && (
                <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 ${catConfig.color} ${catConfig.textColor} border ${catConfig.borderColor}`}>
                  {catConfig.badge}
                </span>
              )}
            </div>
            <h1 className="font-serif text-3xl lg:text-4xl text-stone-900 leading-tight">
              <EditableText
                value={project.name}
                onChange={perms.canEditProjectInfo ? (v) => updateField('name', v) : () => {}}
                className="font-serif text-3xl lg:text-4xl text-stone-900 leading-tight"
                inputClassName="font-serif text-3xl lg:text-4xl text-stone-900 leading-tight w-full"
              />
            </h1>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-xs text-stone-500">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">类型</span>
                <EditableSelect
                  value={project.type}
                  options={['汽车充气泵', '自行车充气泵', '户外充气泵', '车载吸尘器', '暴力风扇', '胎压计', '机械式打气筒', '组件']}
                  onChange={(v) => updateField('type', v)}
                  className="text-xs text-stone-700"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">PM</span>
                <PmSelector
                  pmUserId={project.pmUserId ?? null}
                  onChange={(id) => updateFieldAny('pmUserId', id)}
                  disabled={!perms.canEditProjectInfo}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar size={12} className="text-stone-400" />
                <EditableText value={project.startDate} onChange={(v) => updateField('startDate', v)} className="text-xs font-mono text-stone-700" placeholder="开始日期" />
                <span className="text-stone-300">→</span>
                <EditableText value={project.targetDate} onChange={(v) => updateField('targetDate', v)} className="text-xs font-mono text-stone-700" placeholder="目标日期" />
              </div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-stone-400" />
                <EditableSelect
                  value={risk.label + '风险'}
                  options={['低风险', '中风险', '高风险']}
                  onChange={(v) => updateField('risk', v === '低风险' ? 'low' : v === '中风险' ? 'medium' : 'high')}
                  className={`text-xs font-medium ${risk.color}`}
                />
              </div>
            </div>
          </div>
          {/* Overall Progress */}
          <div className="lg:w-48 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">整体进度</span>
              <span className="text-lg font-serif font-semibold text-stone-900">{overallProgress}%</span>
            </div>
            <ProgressBar value={overallProgress} color="bg-stone-900" height="h-2" />
          </div>
        </div>
      </div>

      {/* Main Tab Bar: Overview / Tasks / Issues / Gantt / Members */}
      <div className="flex items-center gap-0 border-b border-stone-200 overflow-x-auto">
        <button
          onClick={() => setMainTab('overview')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'overview'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <LayoutDashboard size={14} />
          总揽
        </button>
        <button
          onClick={() => setMainTab('tasks')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'tasks'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <ListChecks size={14} />
          任务清单
        </button>
        <button
          onClick={() => setMainTab('kanban')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
            mainTab === 'kanban'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <LayoutGrid size={14} />
          看板
        </button>
        <button
          onClick={() => setMainTab('requirements')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
            mainTab === 'requirements'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <Inbox size={14} />
          需求池
        </button>
        <button
          onClick={() => setMainTab('issues')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'issues'
              ? 'border-b-rose-600 text-rose-700'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <Bug size={14} />
          问题清单
          {openIssueCount > 0 && (
            <span className="text-[9px] font-mono bg-rose-100 text-rose-700 border border-rose-200 px-1.5 py-0.5 min-w-[18px] text-center">
              {openIssueCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setMainTab('gantt')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'gantt'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <BarChart2 size={14} />
          甘特图
        </button>
        <button
          onClick={() => setMainTab('bom')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
            mainTab === 'bom'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <ListChecks size={14} />
          BOM
        </button>
        <button
          onClick={() => setMainTab('files')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
            mainTab === 'files'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <FolderOpen size={14} />
          文件
        </button>
        <button
          onClick={() => setMainTab('changelog')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'changelog'
              ? 'border-b-amber-500 text-amber-700'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <GitBranch size={14} />
          变更记录
          {pendingChangeCount > 0 && (
            <span className="text-[9px] font-mono bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 min-w-[18px] text-center">
              {pendingChangeCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Issues Tab ────────────────────────────────────────────────────── */}
      {mainTab === 'issues' && (
        <div className="space-y-4">
          {/* Phase Navigation (compact) — 任何阶段都可记录问题 */}
          <div className="bg-white border border-stone-200 overflow-x-auto">
            <div className="flex min-w-max">
              {projectPhases.map((phase) => {
                const isActive = phase.id === activePhaseId;
                const phaseIssues = project.phases[phase.id]?.issues || [];
                const openCount = phaseIssues.filter((i) => i.status === 'open' || i.status === 'in_progress').length;
                return (
                  <button
                    key={phase.id}
                    onClick={() => setActivePhaseId(phase.id)}
                    className={`flex-1 min-w-[100px] p-3 text-left transition-all border-b-2 ${
                      isActive ? 'border-b-rose-600 bg-rose-50/30' : 'border-b-transparent hover:bg-stone-50'
                    }`}
                  >
                    <div className="text-[9px] font-mono uppercase tracking-widest text-stone-400 mb-0.5">{phase.code}</div>
                    <div className={`text-xs font-medium ${isActive ? 'text-rose-700' : 'text-stone-500'}`}>{phase.name}</div>
                    <div className="mt-1 flex items-center gap-1">
                      {openCount > 0 ? (
                        <span className="text-[9px] font-mono bg-rose-100 text-rose-700 border border-rose-200 px-1 py-0.5">
                          {openCount} 待处理
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono text-stone-300">{phaseIssues.length} 问题</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <IssueList
            phaseId={activePhaseId}
            phaseName={activePhase?.name || activePhaseId}
            issues={activeIssues}
            onUpdate={updateIssues}
            canEdit={perms.canEditIssues}
            currentUserId={currentUser?.id !== undefined ? String(currentUser.id) : undefined}
            canManage={perms.canManageMembers}
          />
        </div>
      )}

      {/* ── Requirement Pool Tab ─────────────────────────────────────────── */}
      {mainTab === 'kanban' && (
        <div className="p-6">
          <KanbanBoard project={project} onUpdate={onUpdate} canEdit={perms.canEditTasks} />
        </div>
      )}

      {mainTab === 'requirements' && (
        <div className="p-6">
          <RequirementPoolPanel
            projectId={project.id}
            phases={projectPhases}
            canEdit={perms.canEditRequirements}
          />
        </div>
      )}

       {/* ── Gantt Tab ─────────────────────────────────────────────────── */}
      {mainTab === 'gantt' && (
        <GanttView
          project={project}
          onUpdate={onUpdate}
          onPhaseClick={handleGanttPhaseClick}
          readOnly={!perms.canEditProjectInfo}
        />
      )}

      {/* ── Change Log Tab ──────────────────────────────────────────── */}
      {mainTab === 'changelog' && (
        <div className="p-6">
          <ChangeLog
            projectId={project.id}
            records={changeLog}
            onUpdate={updateChangeLog}
            canEdit={perms.canEditChangelog}
          />
        </div>
      )}

      {mainTab === 'bom' && (
        <div className="p-6">
          <BomPanel projectId={project.id} canEdit={perms.canEditProjectInfo} />
        </div>
      )}

      {/* ── Files Tab（权限范围内项目文件汇总）──────────────────────────── */}
      {mainTab === 'files' && (
        <div className="p-6">
          <FilesPanel project={project} role={perms.role} />
        </div>
      )}

      {/* ── Overview Tab（含 成员 / 字段）─────────────────────────────────── */}
      {mainTab === 'overview' && (
        <div className="p-6">
          <OverviewPanel
            project={project}
            onUpdate={onUpdate}
            canEdit={perms.canEditProjectInfo}
            canManageMembers={perms.canManageMembers}
            isAdmin={currentUser?.role === 'admin'}
          />
        </div>
      )}

      {/* ── Tasks Tab ─────────────────────────────────────────────────────── */}
      {mainTab === 'tasks' && (
        <>
          {/* Phase Navigation */}
          <div className="bg-white border border-stone-200 overflow-x-auto">
            <div className="flex min-w-max">
              {projectPhases.map((phase) => {
                const status = getPhaseStatus(project, phase.id);
                const isActive = phase.id === activePhaseId;
                const unlocked = isPhaseUnlocked(project, phase.id);
                return (
                  <button
                    key={phase.id}
                    onClick={() => {
                      setActivePhaseId(phase.id);
                      setSelectedTaskId(null);
                    }}
                    className={`flex-1 min-w-[80px] p-3 text-left transition-all border-b-2 relative ${
                      isActive
                        ? 'border-b-stone-900 bg-stone-50'
                        : 'border-b-transparent hover:bg-stone-50'
                    } ${!unlocked ? 'opacity-60' : ''}`}
                  >
                    <div className="text-[9px] font-mono uppercase tracking-widest text-stone-400 mb-0.5">{phase.code}</div>
                    <div className={`text-xs font-medium ${isActive ? 'text-stone-900' : 'text-stone-500'}`}>
                      {phase.nameEn}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      {!unlocked ? (
                        <Lock size={10} className="text-stone-400 shrink-0" />
                      ) : status === 'completed' ? (
                        <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                      ) : status === 'active' ? (
                        <Zap size={10} className="text-amber-500 shrink-0" />
                      ) : (
                        <Circle size={10} className="text-stone-300 shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Task List */}
            <div className="lg:col-span-2 space-y-3">
              {/* Phase Header */}
              <div className="bg-white border border-stone-200 p-5" style={{ borderLeftWidth: 4, borderLeftColor: activePhase?.color }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">{activePhase?.code}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-300">·</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{activePhase?.duration}</span>
                    </div>
                    <h2 className="font-serif text-2xl text-stone-900">{activePhase?.name}</h2>
                    <p className="text-sm text-stone-500 mt-1">{activePhase?.desc}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="text-2xl font-serif font-semibold text-stone-900">{activeProgress}%</div>
                    <div className="text-[10px] font-mono text-stone-400">完成</div>
                  </div>
                </div>
                <ProgressBar value={activeProgress} color="bg-amber-500" height="h-1.5" />
                <div className="mt-3 flex items-center gap-1.5">
                  <Target size={12} className="text-amber-600" />
                  <span className="text-xs font-medium text-stone-700">Gate: {activePhase?.gate}</span>
                </div>
              </div>

              {/* Gate Lock Banner */}
              {!isCurrentPhaseUnlocked && blockingGate && (
                <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 border-l-4 border-l-rose-500">
                  <ShieldAlert size={18} className="text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold text-rose-800 mb-0.5">此阶段已锁定</div>
                    <div className="text-xs text-rose-700">
                      请先完成 <span className="font-mono font-semibold">{blockingGate.phaseName}</span> 的
                      Gate 评审任务：<span className="font-medium">「{blockingGate.gateTaskName}」</span>，
                      通过后此阶段将自动解锁。
                    </div>
                  </div>
                </div>
              )}

              {/* Role-based task filter notice */}
              {perms.role !== 'owner' && !perms.isLoading && (() => {
                const totalTasks = activePhase?.tasks.length || 0;
                const hiddenCount = totalTasks - visibleActiveTasks.length;
                if (hiddenCount === 0) return null;
                return (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 text-xs text-amber-700">
                    <Filter size={11} className="shrink-0" />
                    <span>已按您的岗位角色过滤，当前显示 <strong>{visibleActiveTasks.length}</strong> 项相关任务（共 {totalTasks} 项，隐藏 {hiddenCount} 项非本岗位任务）</span>
                  </div>
                );
              })()}

              {/* Tasks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {visibleActiveTasks.map((task) => {
                  const checked = activePhaseData?.tasks[task.id] || false;
                  const details = activePhaseData?.taskDetails?.[task.id];
                  const hasInstructions = !!(details?.instructions || '').trim();
                  const fileCount = (details?.files || []).length;
                  const isGateTask = task.id === activePhase.gateTaskId;
                  const locked = !isCurrentPhaseUnlocked;
                  const selected = selectedTaskId === task.id;
                  const status = checked ? 'done' : (details?.taskStatus || 'todo');

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`border transition-all cursor-pointer min-h-[118px] ${
                        locked
                          ? 'border-stone-200 bg-stone-50/30 opacity-60'
                        : isGateTask
                          ? checked
                            ? 'border-l-4 border-l-emerald-500 border-stone-200 bg-emerald-50/30'
                            : 'border-l-4 border-l-amber-500 border-amber-200 bg-amber-50/30'
                          : checked
                          ? 'border-l-2 border-l-stone-900 border-stone-200 bg-stone-50/50'
                          : 'border-stone-200 bg-white'
                      } ${selected ? 'ring-2 ring-amber-300 border-amber-300' : 'hover:border-stone-400 hover:bg-stone-50/50'}`}
                    >
                      {/* Gate Task Label */}
                      {isGateTask && (
                        <div className={`flex items-center gap-1.5 px-3 pt-2 pb-0 ${
                          checked ? 'text-emerald-700' : 'text-amber-700'
                        }`}>
                          <Flag size={10} />
                          <span className="text-[9px] font-mono uppercase tracking-widest font-semibold">
                            Gate 评审 · 通过后解锁下一阶段
                          </span>
                        </div>
                      )}

                      <div className="flex items-start gap-3 p-3 group">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!locked) {
                              isGateTask ? handleGateTaskToggle(task.id) : toggleTask(task.id);
                            }
                          }}
                          className={`mt-0.5 shrink-0 ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                          title={locked ? '此阶段已锁定，请先完成前置 Gate 评审' : isGateTask && !checked ? '点击完成 Gate 评审并填写评审记录' : undefined}
                        >
                          {locked ? (
                            <Lock size={18} className="text-stone-300" />
                          ) : checked ? (
                            <CheckCircle2 size={18} className={isGateTask ? 'text-emerald-600' : 'text-stone-900'} />
                          ) : (
                            <Circle size={18} className={`${isGateTask ? 'text-amber-400 hover:text-amber-600' : 'text-stone-300 hover:text-stone-500'} transition-colors`} />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${
                              locked ? 'text-stone-400' : checked ? 'text-stone-500 line-through' : isGateTask ? 'text-stone-900 font-semibold' : 'text-stone-900'
                            }`}>
                              {task.name}
                            </span>
                            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{task.id}</span>
                            {!locked && hasInstructions && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-600 flex items-center gap-0.5">
                                <Edit3 size={9} /> 已批注
                              </span>
                            )}
                            {!locked && fileCount > 0 && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 flex items-center gap-0.5">
                                <Paperclip size={9} /> {fileCount}
                              </span>
                            )}
                          </div>
                          <p className={`text-xs mt-1 ${locked || checked ? 'text-stone-400' : 'text-stone-500'}`}>
                            {task.desc}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 border border-stone-200 bg-stone-50 px-1.5 py-0.5">
                              {status === 'done' ? '已完成' :
                                status === 'in_progress' ? '进行中' :
                                status === 'blocked' ? '阻塞' :
                                status === 'skipped' ? '跳过' : '待开始'}
                            </span>
                            {details?.taskPriority && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 border border-stone-200 bg-stone-50 px-1.5 py-0.5">
                                {details.taskPriority}
                              </span>
                            )}
                            {selected && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5">
                                详情已打开
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight size={16} className={`shrink-0 mt-0.5 transition-colors ${selected ? 'text-amber-600' : 'text-stone-300 group-hover:text-stone-500'}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Side Panel: 阶段备注 + 全阶段进度 */}
            <div className="space-y-4 lg:sticky lg:top-24 self-start">
              {/* 任务详情子窗口（点击任务弹出） */}
              {selectedTask && (
                <div
                  className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-stone-900/40 backdrop-blur-sm p-4 sm:p-8"
                  onClick={() => setSelectedTaskId(null)}
                >
                  <div
                    className="relative w-full max-w-2xl h-fit my-auto bg-white border border-stone-200 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => setSelectedTaskId(null)}
                      className="absolute top-3.5 right-3.5 z-10 p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
                      title="关闭 (Esc)"
                    >
                      <X size={18} />
                    </button>
                    <div className="max-h-[86vh] overflow-y-auto p-6">
                    <div className="flex items-start justify-between gap-3 pr-8">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{selectedTask.id}</span>
                          {selectedTaskIsGate && (
                            <span className="text-[9px] font-mono uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5">
                              Gate
                            </span>
                          )}
                          {selectedTaskChecked && (
                            <span className="text-[9px] font-mono uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5">
                              Done
                            </span>
                          )}
                        </div>
                        <h3 className="font-serif text-xl leading-tight text-stone-900">{selectedTask.name}</h3>
                        <p className="text-sm text-stone-500 mt-1 leading-relaxed">{selectedTask.desc}</p>
                      </div>
                    </div>

                    {!isCurrentPhaseUnlocked && (
                      <div className="mt-4 flex items-start gap-2 border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        <Lock size={13} className="shrink-0 mt-0.5" />
                        <span>此阶段被前置 Gate 锁定，当前任务详情仅可查看。</span>
                      </div>
                    )}

                    <div className="mt-4 border-t border-stone-100 pt-4 space-y-4">
                      <div>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-2">
                          <Users size={11} />
                          职责
                        </div>
                        <div className="space-y-1.5 text-xs text-stone-600">
                          <div className="flex gap-2">
                            <span className="w-16 shrink-0 font-mono text-stone-400">责任角色</span>
                            <span className="text-stone-800">{selectedTask.owner || '未指定'}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="w-16 shrink-0 font-mono text-stone-400">可见岗位</span>
                            <span className="text-stone-800">{selectedTaskRoleLabels}</span>
                          </div>
                          {selectedTaskIsGate && activePhase?.gateStandard?.responsibleRoles?.length > 0 && (
                            <div className="pt-1">
                              <div className="font-mono text-stone-400 mb-1">Gate 责任分工</div>
                              <div className="space-y-1">
                                {activePhase.gateStandard.responsibleRoles.map((role, i) => (
                                  <div key={i} className="flex items-start gap-2 text-stone-700">
                                    <span className="text-stone-300 mt-0.5">▸</span>
                                    <span>{role}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-2">
                          <Target size={11} />
                          交付物
                        </div>
                        <DeliverablesChecklist
                          projectId={project.id}
                          phaseId={activePhaseId}
                          taskId={selectedTask.id}
                          items={
                            selectedTaskIsGate && activePhase?.gateStandard?.requiredDeliverables?.length
                              ? activePhase.gateStandard.requiredDeliverables
                              : getTaskDeliverables(selectedTask.id, activePhase?.deliverables || [])
                          }
                          status={selectedTaskDetails?.deliverables || {}}
                          canEdit={perms.canEditTasks && isCurrentPhaseUnlocked}
                        />
                      </div>
                    </div>

                    {selectedTask.guide && (
                      <div className="mt-4 p-3 border-l-2 border-amber-500 bg-amber-50">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-1.5">操作指南</div>
                        <pre className="text-xs text-stone-700 whitespace-pre-wrap font-sans leading-relaxed">{selectedTask.guide}</pre>
                      </div>
                    )}

                    {selectedTaskIsGate && activePhase?.gateStandard && (
                      <div className="mt-4 p-3 border-l-2 border-l-stone-900 bg-stone-50">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-2">Gate 管理标准</div>
                        <GateStandardPanel standard={activePhase.gateStandard} compact evidenceHint />
                      </div>
                    )}

                    <TaskDetail
                      taskId={selectedTask.id}
                      taskDetails={selectedTaskDetails || { instructions: '', files: [] }}
                      onUpdate={(details) => updateTaskDetails(selectedTask.id, details)}
                      visibleRoles={selectedTaskRoles}
                      onVisibleRolesChange={(roles) => {
                        onUpdate({
                          ...project,
                          taskVisibleRoles: {
                            ...(project.taskVisibleRoles || {}),
                            [selectedTask.id]: roles,
                          },
                        });
                      }}
                      canEditRoles={perms.canEditProjectInfo}
                      canEdit={perms.canEditTasks && isCurrentPhaseUnlocked}
                      projectId={project.id}
                      phaseId={activePhaseId}
                    />

                    {selectedTaskIsGate && (() => {
                      const reviews = activePhaseData?.gateReviews || [];
                      const latest = reviews[reviews.length - 1];
                      if (selectedTaskChecked && latest) {
                        return (
                          <div className={`mt-4 border p-3 ${
                            latest.decision === 'approved' ? 'border-emerald-200 bg-emerald-50/50' :
                            latest.decision === 'conditional' ? 'border-amber-200 bg-amber-50/50' :
                            'border-rose-200 bg-rose-50/50'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">评审记录</span>
                                {reviews.length > 1 && (
                                  <span className="text-[9px] font-mono text-stone-400 bg-stone-100 px-1.5 py-0.5 border border-stone-200">
                                    共 {reviews.length} 次
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => setGateReviewPending({ phaseId: activePhaseId })}
                                className="text-[10px] font-mono text-stone-400 hover:text-stone-700 transition-colors"
                              >
                                查看历史
                              </button>
                            </div>
                            <GateReviewBadge review={latest} />
                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-stone-600">
                              <div><span className="font-mono text-stone-400">参与人：</span>{latest.participants}</div>
                              {latest.conditions && (
                                <div className="col-span-2"><span className="font-mono text-stone-400">条件：</span>{latest.conditions}</div>
                              )}
                              {latest.notes && (
                                <div className="col-span-2 mt-1 text-stone-500 italic">{latest.notes}</div>
                              )}
                            </div>
                          </div>
                        );
                      }
                      if (selectedTaskChecked && !latest) {
                        return (
                          <button
                            onClick={() => setGateReviewPending({ phaseId: activePhaseId })}
                            className="mt-4 w-full text-xs font-mono text-amber-600 border border-dashed border-amber-300 py-2 hover:bg-amber-50 transition-colors"
                          >
                            + 补充填写 Gate 评审记录
                          </button>
                        );
                      }
                      return null;
                    })()}
                    </div>{/* /scroll-body */}
                  </div>{/* /modal-panel */}
                </div>
              )}

              {/* Phase Notes */}
              <div className="bg-white border border-stone-200 p-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-3">阶段备注</div>
                <textarea
                  value={activePhaseData?.notes || ''}
                  onChange={(e) => {
                    const newProject = { ...project };
                    newProject.phases = { ...project.phases };
                    newProject.phases[activePhaseId] = { ...activePhaseData, notes: e.target.value };
                    onUpdate(newProject);
                  }}
                  rows={5}
                  placeholder="记录阶段备注、决策记录、风险说明..."
                  className="w-full text-xs text-stone-700 border border-stone-200 focus:border-stone-400 outline-none px-3 py-2 resize-none transition-colors"
                />
              </div>

              {/* Phase Progress Summary */}
              <div className="bg-white border border-stone-200 p-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-3">全阶段进度</div>
                <div className="space-y-3">
                  {projectPhases.map((phase) => {
                    const pd = project.phases[phase.id];
                    const prog = computePhaseProgress(pd, phase.id);
                    const status = getPhaseStatus(project, phase.id);
                    return (
                      <div
                        key={phase.id}
                        className="cursor-pointer"
                        onClick={() => {
                          setActivePhaseId(phase.id);
                          setSelectedTaskId(null);
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: phase.color }} />
                            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">{phase.code}</span>
                          </div>
                          <span className="text-[10px] font-mono text-stone-500">{prog}%</span>
                        </div>
                        <ProgressBar
                          value={prog}
                          color={status === 'completed' ? 'bg-emerald-500' : status === 'active' ? 'bg-amber-500' : 'bg-stone-200'}
                          height="h-1"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Gate Review Modal ──────────────────────────────────────────────── */}
      {gateReviewPending && (
          <GateReviewModal
          open={!!gateReviewPending}
          phaseId={gateReviewPending.phaseId}
          phaseName={activePhase?.name || gateReviewPending.phaseId}
          gateName={activePhase?.gate || 'Gate 评审'}
          gateStandard={activePhase?.gateStandard}
          existingReviews={activePhaseData?.gateReviews}
          onConfirm={perms.canGateReview ? handleGateReviewConfirm : () => {}}
          onCancel={() => setGateReviewPending(null)}
          readOnly={!perms.canGateReview}
        />
      )}
      {releaseOpen && (
        <ReleaseDialog
          projectId={project.id}
          open={releaseOpen}
          onOpenChange={setReleaseOpen}
          onReleased={() => { setReleaseOpen(false); onBack(); }}
        />
      )}
    </div>
  );
}
