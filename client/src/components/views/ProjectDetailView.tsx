// Linear redesign — 项目详情 Project Detail
// Phase 1: VISUAL ONLY. Header / P1–P7 stepper / tab bar / task list restyled to the
// Linear indigo-zinc system. All data wiring, mutations (advance-stage / task toggle /
// gate review / deliverable review) and tab state are preserved unchanged.
// ProjectDetailView: phase navigation, Gantt chart tab, task checklist, task details, file upload

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  ArrowLeft, CheckCircle2, Circle, ChevronRight,
  Upload, Download, Trash2, Paperclip, FileText, Image as ImageIcon,
  Edit3, Calendar, AlertTriangle, Target, Zap, ListChecks,
  Lock, ShieldAlert, Flag, Bug, GitBranch, Filter, Rocket, LayoutDashboard,
  FolderOpen, Eye, X, Clock, Settings,
} from 'lucide-react';
import { TaskActivityTab, TaskFlowTab, TaskApprovalTab } from './task/TaskTabs';
import {
  Project, SOP_PHASES, PHASE_MAP, HEALTH_CONFIG,
  computePhaseProgress, computeOverallProgress, getPhaseStatus,
  isPhaseUnlocked, getBlockingGate, getProjectPhases,
  TaskDetails, FileAttachment, formatBytes, SOPTask, SOPPhase,
} from '@/lib/data';
import { CATEGORY_MAP } from '@/lib/sop-templates';
import { LinearCard, StatusDot, LinearBar, SegToggle } from '@/components/linear/primitives';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { GateStandardPanel } from '@/components/shared/GateStandardPanel';
import { GanttView } from './GanttView';
import { TaskGanttView } from './TaskGanttView';
import { IssueList } from './IssueList';
import { ChangeLog } from './ChangeLog';
import { Issue, GateReview, ChangeRecord } from '@/lib/data';
import { GateReviewModal, GateReviewBadge } from './GateReviewModal';
import { ReleaseDialog } from './ReleaseDialog';
import { BomPanel } from './BomPanel';
import { OverviewPanel } from './OverviewPanel';
import { ProjectDashboard } from './project-overview/ProjectDashboard';
import { ProjectSettingsDrawer } from './project-overview/ProjectSettingsDrawer';
import { RequirementPoolPanel } from './RequirementPoolPanel';
import { KanbanBoard } from './KanbanBoard';
import { FilesPanel } from './FilesPanel';
import { RisksPanel } from './RisksPanel';
import { FilePreviewModal, canPreview } from './FilePreviewModal';
import { MetricsView } from './MetricsView';
import { RescheduleConfirmDialog } from './RescheduleConfirmDialog';
import { CommentThread } from '@/components/CommentThread';
import { useProjectPermission } from '@/hooks/useProjectPermission';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { getTaskDeliverables } from '@shared/task-deliverables';
import { FILE_TYPES } from '@shared/file-types';
import { canRoleContributeToDeliverable, canRoleReviewDeliverables, preferredDeliverableReviewerRoles } from '@shared/deliverable-permissions';
import { Users } from 'lucide-react';

const MAX_FILE_SIZE = 16 * 1024 * 1024;

interface ProjectDetailViewProps {
  project: Project;
  onUpdate: (project: Project) => void;
  onBack: () => void;
  /** Deep-link: open at this phase (defaults to currentPhase). */
  initialPhaseId?: string;
  /** Deep-link: auto-open this task's detail on mount. */
  initialTaskId?: string;
  /** Deep-link: open a specific top-level tab on mount. Accepts legacy tab ids
   *  (e.g. 'issues' | 'changelog' | 'metrics') which are normalized internally. */
  initialTab?: LegacyMainTab;
}

type ProjectMainTab = 'overview' | 'tasks' | 'reviews' | 'materials' | 'activity';

// Sub-view types for the consolidated tabs.
type TaskSubView = 'list' | 'kanban' | 'gantt' | 'metrics';
type ReviewSubView = 'issues' | 'risks' | 'requirements' | 'gate';
type MaterialSubView = 'bom' | 'files';

// Legacy tab values (from old deep-links / setMainTab calls) → new 5-tab model.
type LegacyMainTab =
  | ProjectMainTab
  | 'metrics' | 'kanban' | 'requirements' | 'gantt' | 'issues' | 'changelog' | 'bom' | 'files';

// Normalize any (possibly legacy) tab value into the new 5-tab model so old
// deep-links keep landing on the right tab.
function normalizeMainTab(tab?: LegacyMainTab | null): ProjectMainTab {
  switch (tab) {
    case 'metrics':
    case 'kanban':
    case 'gantt':
    case 'tasks':
      return 'tasks';
    case 'requirements':
    case 'issues':
    case 'reviews':
      return 'reviews';
    case 'bom':
    case 'files':
    case 'materials':
      return 'materials';
    case 'changelog':
    case 'activity':
      return 'activity';
    case 'overview':
    default:
      return 'overview';
  }
}

// Which task sub-view a legacy tab maps to (for deep-links into 度量/看板/甘特).
function taskSubViewForLegacy(tab?: LegacyMainTab | null): TaskSubView {
  switch (tab) {
    case 'metrics': return 'metrics';
    case 'kanban': return 'kanban';
    case 'gantt': return 'gantt';
    default: return 'list';
  }
}

// Which review sub-view a legacy tab maps to (for deep-links into 需求池/问题).
function reviewSubViewForLegacy(tab?: LegacyMainTab | null): ReviewSubView {
  switch (tab) {
    case 'requirements': return 'requirements';
    default: return 'issues';
  }
}

// Which material sub-view a legacy tab maps to (for deep-links into 文件).
function materialSubViewForLegacy(tab?: LegacyMainTab | null): MaterialSubView {
  return tab === 'files' ? 'files' : 'bom';
}

const EXECUTION_ROLES = new Set(['rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'pe', 'mfg', 'sales', 'cert', 'battery_safety']);

// Role default expressed as a legacy tab so the same role→landing semantics carry
// over; callers normalize it (and derive the matching sub-view) via the mappers above.
function defaultTabForRole(role?: string | null): LegacyMainTab {
  if (role === 'qa') return 'issues';
  if (role === 'scm') return 'bom';
  if (role === 'sales') return 'requirements';
  if (role === 'cert' || role === 'battery_safety') return 'files';
  if (role === 'rd_hw' || role === 'rd_sw' || role === 'rd_mech' || role === 'pe' || role === 'mfg') return 'tasks';
  return 'overview';
}

function isExecutionRole(role?: string | null) {
  return !!role && EXECUTION_ROLES.has(role);
}

const RISK_OVERRIDE_OPTIONS: Array<{ value: Project['risk']; description: string }> = [
  { value: 'low', description: '正常推进' },
  { value: 'medium', description: '需关注' },
  { value: 'high', description: '需介入' },
];

function issueStatusLabel(status: string) {
  if (status === 'resolved') return '待复测';
  if (status === 'closed') return '复测通过';
  if (status === 'open') return '待处理';
  if (status === 'in_progress') return '处理中';
  if (status === 'wont_fix') return '不修复';
  return status;
}

function categoryForRole(role?: string | null): Issue['category'] {
  if (role === 'rd_sw') return 'software';
  if (role === 'rd_hw') return 'hardware';
  if (role === 'rd_mech') return 'mechanical';
  if (role === 'qa') return 'reliability';
  if (role === 'cert' || role === 'battery_safety') return 'safety';
  return 'other';
}

function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type RelatedIssueDisplay = Issue & { duplicateCount?: number; duplicateIds?: string[] };

function dedupeRelatedIssues(issues: Issue[]): RelatedIssueDisplay[] {
  const map = new Map<string, RelatedIssueDisplay>();
  for (const issue of issues) {
    const key = [
      issue.relatedTaskId ?? '',
      issue.title.trim().toLowerCase(),
      issue.severity,
      issue.status,
      issue.category,
    ].join('|');
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...issue, duplicateCount: 1, duplicateIds: [issue.id] });
      continue;
    }
    existing.duplicateCount = (existing.duplicateCount ?? 1) + 1;
    existing.duplicateIds = [...(existing.duplicateIds ?? [existing.id]), issue.id];
  }
  return Array.from(map.values());
}

function EditableText({
  value, onChange, className = '', placeholder = '点击编辑', inputClassName = '', readOnly = false,
}: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; inputClassName?: string; readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  // 无编辑权限：纯展示，不进入编辑态，避免「看似可编辑、改完 blur 丢弃/报权限错」
  if (readOnly) {
    return <span className={className}>{value || <span className="text-muted-foreground italic">{placeholder}</span>}</span>;
  }

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
        className={`bg-[color:var(--acc-soft)] border-b-2 border-primary outline-none px-1 ${inputClassName || className}`}
        placeholder={placeholder}
      />
    );
  }
  return (
    <span
      onClick={() => { setDraft(value || ''); setEditing(true); }}
      className={`${className} cursor-text hover:bg-[color:var(--acc-soft)] rounded px-1 -mx-1 group inline-flex items-center gap-1`}
    >
      {value || <span className="text-muted-foreground italic">{placeholder}</span>}
      <Edit3 size={11} className="inline-block ml-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
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
        className={`bg-[color:var(--acc-soft)] border-b-2 border-primary outline-none px-1 ${className}`}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`${className} cursor-pointer hover:bg-[color:var(--acc-soft)] rounded px-1 -mx-1`}
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
  const [selectedType, setSelectedType] = useState('');
  const [version, setVersion] = useState('');

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
        formData.append('fileType', selectedType);
        formData.append('fileVersion', version);
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
          fileType?: string | null; fileVersion?: string | null;
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
          fileType: result.fileType ?? null,
          fileVersion: result.fileVersion ?? null,
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
      {!readOnly && (
        <div className="flex items-center gap-2 mb-2">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="text-xs rounded-md bg-transparent px-1.5 py-1 text-foreground outline-none hover:bg-secondary focus:bg-secondary transition-colors"
          >
            <option value="">未分类</option>
            {FILE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            maxLength={32}
            placeholder="版本 如 V1.0 / T1 / Rev.B"
            className="flex-1 text-xs rounded-md bg-transparent px-1.5 py-1 text-foreground outline-none border-b border-transparent hover:border-border focus:border-[color:var(--acc-border)] transition-colors"
          />
        </div>
      )}
      <div
        onClick={() => !readOnly && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!readOnly) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`rounded-md border border-dashed p-3 text-center transition-colors ${
          readOnly ? 'cursor-not-allowed border-border/60 bg-secondary/50 opacity-70' :
          dragOver ? 'cursor-pointer border-primary bg-[color:var(--acc-soft)]' : 'cursor-pointer border-border/70 hover:border-[color:var(--acc-border)] hover:bg-secondary/50'
        }`}
      >
        <input ref={inputRef} type="file" multiple onChange={(e) => handleFiles(e.target.files!)} className="hidden" disabled={uploading || readOnly} />
        <Upload size={18} className={`mx-auto mb-2 ${uploading ? 'text-primary animate-pulse' : 'text-muted-foreground'}`} />
        <div className="text-sm text-foreground">
          {readOnly ? '仅可查看附件' : uploading ? '上传中...' : <><span className="font-medium">点击上传</span>或拖拽文件</>}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
          单个文件最大 {formatBytes(MAX_FILE_SIZE)} · 支持 PDF / 图片 / Office 文档
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5">{error}</div>}
      {files && files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {files.map((file) => {
            const previewable = canPreview(file);
            return (
            <div key={file.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary/60 transition-colors group">
              <span className="text-muted-foreground shrink-0">{getIcon(file.type)}</span>
              <div
                className={`flex-1 min-w-0 ${previewable ? 'cursor-pointer' : ''}`}
                onClick={(e) => { if (previewable) { e.stopPropagation(); setPreviewFile(file); } }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-sm text-foreground truncate ${previewable ? 'group-hover:text-primary' : ''}`}>{file.name}</span>
                  {file.fileType && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{file.fileType}</span>}
                  {file.fileVersion && <span className="shrink-0 text-[10px] num text-primary">{file.fileVersion}</span>}
                </div>
                <div className="text-[10px] num text-muted-foreground">{formatBytes(file.size)}</div>
              </div>
              {previewable && (
                <button onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }} title="预览" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  <Eye size={13} />
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); downloadFile(file); }} title="下载" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <Download size={13} />
              </button>
              {!readOnly && (
                <button onClick={(e) => { e.stopPropagation(); if (confirm('删除文件？')) onRemove(file.id); }} className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-[color:var(--destructive-soft)] transition-colors">
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
  { value: 'pe',     label: 'PE 工艺' },
  { value: 'mfg',    label: 'MFG 生产' },
  { value: 'sales',  label: '销售/渠道' },
  { value: 'cert',   label: '认证' },
  { value: 'battery_safety', label: '电池安全' },
  { value: 'pm',     label: '产品经理' },
  { value: 'manager', label: '管理层' },
  { value: 'owner',  label: '项目创建者' },
] as const;

// O(1) role → label lookup (ROLE_OPTIONS is static, so this Map is module-level too).
const ROLE_LABEL_BY_VALUE = new Map<string, string>(ROLE_OPTIONS.map((o) => [o.value, o.label]));

function canSubmitDeliverableFromUi({
  deliverableName,
  role,
  canEditTasks,
  canEditProjectInfo,
  isTaskAssignee,
  taskVisibleRoles,
}: {
  deliverableName: string;
  role: string;
  canEditTasks: boolean;
  canEditProjectInfo: boolean;
  isTaskAssignee: boolean;
  taskVisibleRoles: string[];
}) {
  if (canEditProjectInfo || canEditTasks) return true;
  if (!role || role === 'viewer') return false;
  if (isTaskAssignee) return true;
  if (taskVisibleRoles.length > 0 && taskVisibleRoles.includes(role)) return true;
  return canRoleContributeToDeliverable(role, deliverableName);
}

// Static task-status / priority configs — hoisted out of TaskDetail so they aren't
// re-created every render (no closure dependencies).
const TASK_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  todo: { label: '待开始', className: 'bg-secondary text-muted-foreground border-border' },
  in_progress: { label: '进行中', className: 'bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]' },
  blocked: { label: '阻塞', className: 'bg-red-50 text-red-700 border-red-200' },
  done: { label: '已完成', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  skipped: { label: '跳过', className: 'bg-secondary text-muted-foreground border-border' },
  pending_approval: { label: '待审批', className: 'bg-[color:var(--acc-soft)] text-[color:var(--warning)] border-[color:var(--acc-border)]' },
};
const TASK_PRIORITY_OPTIONS = [
  { value: 'critical', label: 'P0 紧急' },
  { value: 'high', label: 'P1 高' },
  { value: 'medium', label: 'P2 中' },
  { value: 'low', label: 'P3 低' },
];

function isProductDefinitionTask(taskId: string) {
  return taskId.startsWith('pd_');
}

function handoffTaskTitle(taskId: string, details?: TaskDetails) {
  const firstLine = (details?.instructions || '').split('\n').map((line) => line.trim()).find(Boolean);
  if (firstLine?.startsWith('#')) return firstLine.replace(/^#+\s*/, '');
  const role = taskId.replace(/^pd_/, '');
  const label = ROLE_OPTIONS.find((option) => option.value === role)?.label || role;
  return `产品定义交接 - ${label}`;
}

function handoffTaskOwner(taskId: string, roles: string[]) {
  const role = roles.find((item) => !['pm', 'manager', 'owner'].includes(item)) ?? taskId.replace(/^pd_/, '');
  return ROLE_OPTIONS.find((option) => option.value === role)?.label || role;
}

function getPhaseWithHandoffTasks(phase: SOPPhase | undefined, phaseData: { taskDetails?: Record<string, TaskDetails> } | undefined, project: Project): SOPPhase | undefined {
  if (!phase) return phase;
  const existing = new Set(phase.tasks.map((task) => task.id));
  const customTasks: SOPTask[] = Object.entries(phaseData?.taskDetails ?? {})
    .filter(([taskId]) => isProductDefinitionTask(taskId) && !existing.has(taskId))
    .map(([taskId, details]) => {
      const roles = project.taskVisibleRoles?.[taskId] ?? [];
      return {
        id: taskId,
        name: handoffTaskTitle(taskId, details),
        desc: '来自产品定义交接清单，请按已确认 PRD 快照承接本角色规格与变更输入。',
        owner: handoffTaskOwner(taskId, roles),
        guide: details.instructions || '',
        visibleRoles: roles,
      };
    });
  if (customTasks.length === 0) return phase;
  return { ...phase, tasks: [...phase.tasks, ...customTasks] };
}

/** Gate 就绪检查：任务/问题本地聚合，交付物只使用服务端审核通过集合。 */
interface GateReadiness {
  tasksDone: number; tasksTotal: number;
  delivDone: number; delivTotal: number;
  openP0P1: number; fileCount: number;
  signoffRoles: string[]; blockers: string[]; ready: boolean;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeGateReadiness(phase: any, phaseData: any, submittedDeliverables?: string[], satisfiedSet?: string[]): GateReadiness {
  const allTasks: Array<{ id: string }> = phase?.tasks ?? [];
  const tasks = allTasks.filter((t) => t.id !== phase?.gateTaskId);
  const tasksDone = tasks.filter((t) => phaseData?.tasks?.[t.id]).length;
  let delivDone = 0, delivTotal = 0;
  if (submittedDeliverables) {
    delivTotal = submittedDeliverables.length;
    const satisfiedNames = new Set(satisfiedSet ?? []);
    delivDone = submittedDeliverables.filter((name) => satisfiedNames.has(name)).length;
  } else {
    for (const t of tasks) {
      const names = getTaskDeliverables(t.id, phase?.deliverables ?? []);
      const status: Record<string, boolean> = phaseData?.taskDetails?.[t.id]?.deliverables ?? {};
      delivTotal += names.length;
      delivDone += names.filter((n) => status[n]).length;
    }
  }
  const issues = phaseData?.issues ?? [];
  const openP0P1 = issues.filter((i: { severity: string; status: string }) =>
    (i.severity === 'P0' || i.severity === 'P1') && (i.status === 'open' || i.status === 'in_progress')).length;
  let fileCount = 0;
  for (const t of tasks) fileCount += (phaseData?.taskDetails?.[t.id]?.files ?? []).length;
  const blockers: string[] = [];
  if (openP0P1 > 0) blockers.push(`${openP0P1} 个未关闭的 P0/P1 问题`);
  if (tasksDone < tasks.length) blockers.push(`${tasks.length - tasksDone} 项任务未完成`);
  if (delivTotal > 0 && delivDone < delivTotal) blockers.push(`交付物未齐(${delivDone}/${delivTotal})`);
  return { tasksDone, tasksTotal: tasks.length, delivDone, delivTotal, openP0P1, fileCount, signoffRoles: phase?.gateStandard?.responsibleRoles ?? [], blockers, ready: blockers.length === 0 };
}

type GateReadinessSummary = {
  ready: boolean;
  blockerCount: number;
  dimensions: Array<{ dimension: string; ok: boolean; summary: string; blockers: string[] }>;
} | null | undefined;

type ReleasePrecheckSummary = {
  canRelease: boolean;
  canForceRelease: boolean;
  blockers: string[];
  releaseGate: { decision: string | null; gateName?: string | null } | null;
} | null | undefined;

function ProjectFocusBand({
  phaseName,
  activeProgress,
  gateName,
  readiness,
  openIssueCount,
  pendingChangeCount,
  releasePrecheck,
  canReleaseAction,
  onTasks,
  onGate,
  onIssues,
  onChanges,
  onRelease,
}: {
  phaseName: string;
  activeProgress: number;
  gateName: string;
  readiness: GateReadinessSummary;
  openIssueCount: number;
  pendingChangeCount: number;
  releasePrecheck: ReleasePrecheckSummary;
  canReleaseAction: boolean;
  onTasks: () => void;
  onGate: () => void;
  onIssues: () => void;
  onChanges: () => void;
  onRelease: () => void;
}) {
  const gateBlocked = readiness ? !readiness.ready : false;
  const firstGateBlocker = readiness?.dimensions.find((dim) => !dim.ok)?.summary;
  const releaseBlocked = releasePrecheck ? !releasePrecheck.canRelease && !releasePrecheck.canForceRelease : false;
  const releaseLabel = !releasePrecheck
    ? '预检中'
    : releasePrecheck.canRelease
      ? '可发布'
      : releasePrecheck.canForceRelease
        ? '需强制发布'
        : `${releasePrecheck.blockers.length} 项阻断`;
  const releaseTone = !releasePrecheck
    ? 'text-muted-foreground'
    : releasePrecheck.canRelease
      ? 'text-emerald-700'
      : releasePrecheck.canForceRelease
        ? 'text-primary'
        : 'text-rose-700';
  const issueChangeLabel = openIssueCount > 0 || pendingChangeCount > 0
    ? `${openIssueCount} 问题 · ${pendingChangeCount} 变更`
    : '暂无开放项';

  return (
    <LinearCard className="overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border">
        <FocusItem
          icon={<Target size={15} />}
          label="当前阶段"
          value={phaseName}
          detail={`${activeProgress}% 完成`}
          tone={activeProgress >= 100 ? 'text-emerald-700' : 'text-foreground'}
          actionLabel="处理任务"
          onAction={onTasks}
        />
        <FocusItem
          icon={<Flag size={15} />}
          label="Gate"
          value={gateBlocked ? `${readiness?.blockerCount ?? 0} 项未就绪` : readiness?.ready ? '已就绪' : gateName}
          detail={gateBlocked ? firstGateBlocker ?? gateName : gateName}
          tone={gateBlocked ? 'text-primary' : readiness?.ready ? 'text-emerald-700' : 'text-foreground'}
          actionLabel="查看 Gate"
          onAction={onGate}
        />
        <FocusItem
          icon={<Bug size={15} />}
          label="问题与变更"
          value={issueChangeLabel}
          detail={openIssueCount > 0 ? '开放问题需要先收口' : pendingChangeCount > 0 ? '有待决变更' : '无开放问题或待决变更'}
          tone={openIssueCount > 0 ? 'text-rose-700' : pendingChangeCount > 0 ? 'text-primary' : 'text-emerald-700'}
          actionLabel={openIssueCount > 0 ? '处理问题' : pendingChangeCount > 0 ? '看变更' : '查看问题'}
          onAction={openIssueCount > 0 ? onIssues : pendingChangeCount > 0 ? onChanges : onIssues}
        />
        <FocusItem
          icon={<Rocket size={15} />}
          label="量产发布"
          value={releaseLabel}
          detail={releaseBlocked ? releasePrecheck?.blockers[0] ?? '发布条件未满足' : releasePrecheck?.releaseGate?.decision === 'conditional' ? '有条件通过需留痕' : '发布前置条件'}
          tone={releaseTone}
          actionLabel={canReleaseAction ? '打开预检' : '仅可查看'}
          onAction={onRelease}
          disabled={!canReleaseAction}
        />
      </div>
    </LinearCard>
  );
}

function FocusItem({
  icon,
  label,
  value,
  detail,
  tone,
  actionLabel,
  onAction,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  tone: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="min-h-[116px] p-4 flex flex-col justify-between gap-3 bg-card">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="text-muted-foreground">{icon}</span>
          {label}
        </div>
        <div className={`mt-2 text-lg font-semibold leading-tight ${tone}`}>{value}</div>
        <div className="mt-1 max-h-8 overflow-hidden text-xs text-muted-foreground leading-snug">{detail}</div>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className="self-start text-[11px] uppercase tracking-wider text-muted-foreground rounded-md border border-border px-2 py-1 hover:border-[color:var(--acc-border)] hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function ReadinessRow({ label, ok, detail, soft }: { label: string; ok: boolean; detail: React.ReactNode; soft?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="flex items-center gap-1.5">
        {ok ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertTriangle size={14} className={soft ? 'text-primary' : 'text-rose-500'} />}
        <span className="text-foreground">{label}</span>
      </span>
      <span className={`text-xs num ${ok ? 'text-muted-foreground' : soft ? 'text-primary' : 'text-rose-600'}`}>{detail}</span>
    </div>
  );
}

/**
 * Gate 交付物资源库手工增删面板（仅 PM/admin 可见）
 * - 从资源库选择并添加交付物
 * - 对手工添加项提供"移除"，对模板/归集项提供"排除"
 */
// ── DeliverableReviewControls ─────────────────────────────────────────────────
/** 每条 gate 交付物的审核态徽标 + 提交/通过/驳回操作 */
function pickDeliverableReviewer(
  deliverableName: string,
  members: Array<{ userId: number; role: string; isOwner?: boolean | null }>,
) {
  const rolePreference = preferredDeliverableReviewerRoles(deliverableName);
  return rolePreference
    .map((role) => members.find((member) => member.role === role))
    .find(Boolean);
}

function DeliverableEvidenceUploadButton({
  projectId,
  phaseId,
  taskId,
  deliverableName,
  hasFile,
  onUploaded,
}: {
  projectId: string;
  phaseId: string;
  taskId?: string;
  deliverableName: string;
  hasFile: boolean;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) return;
    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`文件 "${file.name}" 超出 ${formatBytes(MAX_FILE_SIZE)} 限制`);
          continue;
        }
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', projectId);
        formData.append('phaseId', phaseId);
        if (taskId) formData.append('taskId', taskId);
        formData.append('deliverableName', deliverableName);
        const resp = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: resp.statusText }));
          toast.error(`上传 "${file.name}" 失败: ${(err as any).error || resp.statusText}`);
          continue;
        }
        uploaded += 1;
      }
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? '证据已上传' : `已上传 ${uploaded} 个证据文件`);
        onUploaded();
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={uploading}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="text-[10px] rounded px-1.5 py-0.5 bg-secondary text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
      >
        {uploading ? '上传中' : hasFile ? '补充证据' : '上传证据'}
      </button>
    </>
  );
}

function DeliverableReviewControls({
  projectId, phaseId, deliverableNames, canEditTasks, canSubmitDeliverable, currentUserId, isAdmin,
  gateTaskId, pmUserId,
}: {
  projectId: string;
  phaseId: string;
  deliverableNames: string[];
  canEditTasks: boolean;
  canSubmitDeliverable: (deliverableName: string) => boolean;
  currentUserId: number | undefined;
  isAdmin: boolean;
  gateTaskId?: string;
  pmUserId: number | null;
}) {
  const utils = trpc.useUtils();
  const { data: reviewList = [] } = trpc.deliverableReviews.list.useQuery({ projectId });
  const { data: members = [] } = trpc.members.list.useQuery({ projectId });
  // files for this phase to detect "has file" — no taskId filter, so it matches
  // the server's getReviewSatisfiedSet which scopes by projectId+phaseId only.
  const { data: files = [] } = trpc.files.list.useQuery({ projectId, phaseId });

  const [reviewerSelections, setReviewerSelections] = useState<Record<string, number | ''>>({}); // deliverableName → selected reviewerUserId
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({}); // deliverableName → note draft
  const [rejectOpen, setRejectOpen] = useState<Record<string, boolean>>({}); // deliverableName → note input open

  const submitMut = trpc.deliverableReviews.submit.useMutation({
    onSuccess: () => {
      utils.deliverableReviews.list.invalidate({ projectId });
      utils.deliverableReviews.myPending.invalidate();
      if (gateTaskId) utils.gateReviews.readiness.invalidate({ projectId, phaseId });
    },
    onError: (err) => toast.error(err.message),
  });

  const reviewMut = trpc.deliverableReviews.review.useMutation({
    onSuccess: () => {
      utils.deliverableReviews.list.invalidate({ projectId });
      utils.deliverableReviews.myPending.invalidate();
      if (gateTaskId) utils.gateReviews.readiness.invalidate({ projectId, phaseId });
    },
    onError: (err) => toast.error(err.message),
  });

  if (deliverableNames.length === 0) return null;

  // build a lookup: deliverableName → review record
  const reviewByName = new Map(
    reviewList.filter((r) => r.phaseId === phaseId).map((r) => [r.deliverableName, r])
  );

  // file set for this phase
  const uploadedNames = new Set(files.map((f) => (f as { deliverableName?: string | null }).deliverableName).filter((n): n is string => !!n));

  // Type-aware reviewer default, then PM/Owner fallback.
  const reviewableMembers = members.filter((m) => canRoleReviewDeliverables(m.role) || m.isOwner);
  const pmMember = reviewableMembers.find((m) => m.userId === pmUserId) ?? reviewableMembers.find((m) => m.role === 'pm' || m.isOwner);

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">审核状态</div>
      {deliverableNames.map((name) => {
        const record = reviewByName.get(name);
        const hasFile = uploadedNames.has(name);

        // reviewer name helper
        const reviewerMember = record ? members.find((m) => m.userId === record.reviewerUserId) : undefined;
        const reviewerName = reviewerMember ? (reviewerMember.userName ?? reviewerMember.userEmail ?? `用户${record!.reviewerUserId}`) : (record ? `用户${record.reviewerUserId}` : '');

        // can the current user act as reviewer?
        const isReviewer = !!record && (isAdmin || record.reviewerUserId === currentUserId);
        const canSubmitName = canSubmitDeliverable(name);

        // reviewer select state for submit
        const defaultReviewer = pickDeliverableReviewer(name, reviewableMembers) ?? pmMember;
        const selReviewer = reviewerSelections[name] !== undefined ? reviewerSelections[name] : (defaultReviewer?.userId ?? '');

        return (
          <div key={name} className="space-y-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground min-w-0 truncate">{name}</span>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                {/* Status badge */}
                {!record && hasFile && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                    已上传
                  </span>
                )}
                {record?.status === 'pending' && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[color:var(--acc-soft)] text-primary border border-[color:var(--acc-border)]">
                    待审 · {reviewerName}
                  </span>
                )}
                {record?.status === 'approved' && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                    通过 · {reviewerName}
                  </span>
                )}
                {record?.status === 'rejected' && (
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 cursor-help"
                    title={record.reviewNote ? `驳回意见：${record.reviewNote}` : '驳回'}
                  >
                    驳回{record.reviewNote ? ' ⓘ' : ''}
                  </span>
                )}

                {canSubmitName && record?.status !== 'approved' && (
                  <DeliverableEvidenceUploadButton
                    projectId={projectId}
                    phaseId={phaseId}
                    taskId={gateTaskId}
                    deliverableName={name}
                    hasFile={hasFile}
                    onUploaded={() => {
                      utils.files.list.invalidate({ projectId, phaseId });
                      if (gateTaskId) utils.gateReviews.readiness.invalidate({ projectId, phaseId });
                    }}
                  />
                )}

                {/* Submit action: deliverable evidence submitter && (no record || rejected) */}
                {canSubmitName && hasFile && (!record || record.status === 'rejected') && (
                  <div className="flex items-center gap-1">
                    <select
                      value={selReviewer}
                      onChange={(e) => setReviewerSelections((prev) => ({ ...prev, [name]: e.target.value === '' ? '' : Number(e.target.value) }))}
                      className="text-[10px] rounded border border-border bg-card text-muted-foreground px-1 py-0.5 focus:outline-none focus:border-[color:var(--acc-border)]"
                    >
                      <option value="">— 选审核人 —</option>
                      {reviewableMembers.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.userName ?? m.userEmail ?? `用户${m.userId}`} · {ROLE_LABEL_BY_VALUE.get(m.role) ?? m.role}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={submitMut.isPending}
                      onClick={() => {
                        const rv = selReviewer === '' ? undefined : Number(selReviewer);
                        submitMut.mutate({ projectId, phaseId, deliverableName: name, reviewerUserId: rv });
                      }}
                      className="text-[10px] rounded px-1.5 py-0.5 bg-[color:var(--acc-soft)] text-primary border border-[color:var(--acc-border)] hover:opacity-80 disabled:opacity-50 transition-colors"
                    >
                      提交审核
                    </button>
                  </div>
                )}

                {/* Approve/Reject actions: reviewer & status=pending */}
                {isReviewer && record?.status === 'pending' && (
                  <div className="flex items-center gap-1">
                    <button
                      disabled={reviewMut.isPending}
                      onClick={() => reviewMut.mutate({ projectId, phaseId, deliverableName: name, decision: 'approved' })}
                      className="text-[10px] rounded px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                    >
                      通过
                    </button>
                    <button
                      disabled={reviewMut.isPending}
                      onClick={() => setRejectOpen((prev) => ({ ...prev, [name]: !prev[name] }))}
                      className="text-[10px] rounded px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100 disabled:opacity-50 transition-colors"
                    >
                      驳回
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Reject note input */}
            {rejectOpen[name] && isReviewer && record?.status === 'pending' && (
              <div className="flex items-center gap-1.5 pl-2">
                <input
                  type="text"
                  value={rejectNote[name] ?? ''}
                  onChange={(e) => setRejectNote((prev) => ({ ...prev, [name]: e.target.value }))}
                  placeholder="填写驳回意见（可选）"
                  className="flex-1 text-xs border border-rose-200 bg-rose-50 px-2 py-0.5 focus:outline-none focus:border-rose-400"
                />
                <button
                  disabled={reviewMut.isPending}
                  onClick={() => {
                    reviewMut.mutate({
                      projectId, phaseId, deliverableName: name,
                      decision: 'rejected', note: rejectNote[name] || null,
                    });
                    setRejectOpen((prev) => ({ ...prev, [name]: false }));
                  }}
                  className="text-[10px] rounded px-1.5 py-0.5 bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 transition-colors"
                >
                  确认驳回
                </button>
                <button
                  onClick={() => setRejectOpen((prev) => ({ ...prev, [name]: false }))}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GateDeliverableOverridePanel({
  projectId, phaseId, effectiveDeliverables, canEdit,
}: {
  projectId: string;
  phaseId: string;
  /** 当前 gate 的有效交付物列表 */
  effectiveDeliverables: string[];
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [selectValue, setSelectValue] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const { data: library = [] } = trpc.tailoring.deliverableLibrary.useQuery({ projectId });
  const { data: overrides = [] } = trpc.tailoring.deliverableOverrides.useQuery({ projectId });

  const overrideMut = trpc.tailoring.setDeliverableOverride.useMutation({
    onError: (e) => {
      // 服务端仅允许 PM/管理员裁剪；失败要给出可读提示而不是静默不变
      toast.error(e.data?.code === 'FORBIDDEN' ? '仅项目 PM 或管理员可调整流程裁剪' : `裁剪失败：${e.message}`);
    },
    onSettled: () => {
      utils.tailoring.effectiveProcess.invalidate({ projectId });
      utils.tailoring.deliverableOverrides.invalidate({ projectId });
      setPending(null);
    },
  });

  if (!canEdit) return null;

  // 当前 gate 阶段的 override 集合（action → Set<deliverableName>）
  const addedNames = new Set(
    overrides
      .filter((o) => o.nodePhaseId === phaseId && o.action === 'add')
      .map((o) => o.deliverableName)
  );
  const removedNames = new Set(
    overrides
      .filter((o) => o.nodePhaseId === phaseId && o.action === 'remove')
      .map((o) => o.deliverableName)
  );
  // 排除项的豁免理由（存量 grandfather 或手动豁免时记录），用于展示审计痕迹
  const reasonByName = new Map(
    overrides
      .filter((o) => o.nodePhaseId === phaseId && o.action === 'remove' && o.reason)
      .map((o) => [o.deliverableName, o.reason as string])
  );

  const effectiveSet = new Set(effectiveDeliverables);

  // 资源库中未在有效集合中的条目（可添加）
  const addableItems = library.filter((name) => !effectiveSet.has(name));

  const handleAdd = (name: string) => {
    if (!name) return;
    setPending(name);
    setSelectValue('');
    overrideMut.mutate({ projectId, nodePhaseId: phaseId, deliverableName: name, action: 'add' });
  };

  const handleRemoveOverride = (name: string, action: 'clear' | 'remove') => {
    // 排除(豁免)必备交付物时要求记录理由，留审计痕迹（撤销/添加不需要）
    let reason: string | null = null;
    if (action === 'remove') {
      const input = window.prompt(`排除（豁免）「${name}」的理由（必填，将记录在案）：`, '');
      if (input == null) return;            // 取消
      if (!input.trim()) { toast.error('请填写豁免理由'); return; }
      reason = input.trim();
    }
    setPending(name);
    overrideMut.mutate({ projectId, nodePhaseId: phaseId, deliverableName: name, action, reason });
  };

  // 只要有可添加条目、有手动项或有已排除项，就渲染面板
  const hasContent =
    addableItems.length > 0 ||
    effectiveDeliverables.some((name) => addedNames.has(name)) ||
    removedNames.size > 0;

  if (!hasContent) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">资源库管理</div>

      {/* 从资源库添加 */}
      {addableItems.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select
            value={selectValue}
            onChange={(e) => { setSelectValue(e.target.value); handleAdd(e.target.value); }}
            disabled={overrideMut.isPending}
            className="flex-1 text-xs rounded border border-border bg-card text-foreground px-1.5 py-1 focus:outline-none focus:border-[color:var(--acc-border)] min-w-0"
          >
            <option value="">＋ 从资源库添加…</option>
            {addableItems.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}

      {/* 手工添加的项（action=add）→ 可移除（clear） */}
      {effectiveDeliverables.filter((name) => addedNames.has(name)).map((name) => (
        <div key={name} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 min-w-0">
            <span className="text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5 shrink-0">手动添加</span>
            <span className="truncate">{name}</span>
          </span>
          <button
            disabled={pending === name || overrideMut.isPending}
            onClick={() => handleRemoveOverride(name, 'clear')}
            className="shrink-0 text-[10px] text-muted-foreground hover:text-rose-500 disabled:opacity-40 transition-colors"
            title="撤销添加"
          >
            × 移除
          </button>
        </div>
      ))}

      {/* 模板/归集项（非手动添加）→ 可排除（remove） */}
      {effectiveDeliverables.filter((name) => !addedNames.has(name)).map((name) => (
        <div key={name} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate min-w-0">{name}</span>
          <button
            disabled={pending === name || overrideMut.isPending}
            onClick={() => handleRemoveOverride(name, 'remove')}
            className="shrink-0 text-[10px] text-muted-foreground hover:text-rose-500 disabled:opacity-40 transition-colors"
            title="从本阶段排除此交付物"
          >
            × 排除
          </button>
        </div>
      ))}

      {/* 已被排除/豁免的项（action=remove）→ 显示理由并提供恢复 */}
      {Array.from(removedNames).map((name) => (
        <div key={name} className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="flex items-center gap-1 min-w-0">
              <span className="text-[9px] text-muted-foreground bg-secondary border border-border rounded px-1 py-0.5 shrink-0">已豁免</span>
              <span className="truncate line-through">{name}</span>
            </span>
            {reasonByName.has(name) && (
              <span className="text-[10px] text-muted-foreground/80 pl-1 line-clamp-2">理由：{reasonByName.get(name)}</span>
            )}
          </span>
          <button
            disabled={pending === name || overrideMut.isPending}
            onClick={() => handleRemoveOverride(name, 'clear')}
            className="shrink-0 text-[10px] text-muted-foreground hover:text-primary disabled:opacity-40 transition-colors"
            title="恢复此交付物"
          >
            ↩ 恢复
          </button>
        </div>
      ))}
    </div>
  );
}

/** 任务交付物清单：模板预置交付物 + 完成勾选（持久化到 project_tasks.deliverables） */
function DeliverablesChecklist({
  projectId, phaseId, taskId, items, status, canEdit, carried,
}: {
  projectId: string;
  phaseId: string;
  taskId: string;
  items: string[];
  status: Record<string, boolean>;
  canEdit: boolean;
  /** 归集项映射：deliverableName → 来源阶段名 */
  carried?: Record<string, string>;
}) {
  const utils = trpc.useUtils();
  const [pending, setPending] = useState<string | null>(null);
  const mutation = trpc.tasks.setDeliverable.useMutation({
    onSettled: () => { utils.tasks.list.invalidate({ projectId }); setPending(null); },
  });
  const doneCount = items.filter((d) => status[d]).length;

  if (items.length === 0) return <div className="text-sm text-muted-foreground">无预置交付物</div>;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] num text-muted-foreground">{doneCount}/{items.length} 完成</span>
        {doneCount === items.length && <span className="text-[10px] text-emerald-600">✓ 全部交付</span>}
      </div>
      {items.map((d) => {
        const done = !!status[d];
        const fromPhase = carried?.[d];
        return (
          <button
            key={d}
            disabled={!canEdit || pending === d}
            onClick={() => { setPending(d); mutation.mutate({ projectId, phaseId, taskId, name: d, done: !done }); }}
            className={`w-full flex items-start gap-2 text-left text-sm py-0.5 ${canEdit ? 'hover:bg-secondary cursor-pointer' : 'cursor-default'} ${pending === d ? 'opacity-50' : ''}`}
          >
            {done
              ? <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-600" />
              : <Circle size={15} className="shrink-0 mt-0.5 text-muted-foreground" />}
            <span className="flex items-center gap-1.5 min-w-0">
              <span className={done ? 'text-muted-foreground line-through' : 'text-foreground'}>{d}</span>
              {fromPhase && (
                <span className="shrink-0 text-[9px] text-primary bg-[color:var(--acc-soft)] border border-[color:var(--acc-border)] rounded px-1 py-0.5 leading-none">
                  来自 {fromPhase}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TaskDetail({
  taskId, taskDetails, onUpdate, visibleRoles, onVisibleRolesChange, canEditRoles,
  projectId, phaseId, canEdit = true, compact = false, layout = 'full',
  currentUserId, canEditPriority, canUploadFiles,
}: {
  taskId: string;
  taskDetails: TaskDetails;
  onUpdate: (details: TaskDetails) => void;
  visibleRoles?: string[];
  onVisibleRolesChange?: (roles: string[]) => void;
  /** canEditProjectInfo (PM/管理层): 可改可见岗位 + 负责人改派给任意成员 */
  canEditRoles?: boolean;
  /** 当前登录用户 id — 用于「认领给自己」 */
  currentUserId?: number;
  /** 优先级可改 = canEditProjectInfo（管理/PM）。其余只读展示。默认沿用 canEdit。 */
  canEditPriority?: boolean;
  /** 文件上传/删除可改 = 负责人本人 || canEditProjectInfo。默认沿用 canEdit。 */
  canUploadFiles?: boolean;
  projectId: string;
  phaseId?: string;
  canEdit?: boolean;
  compact?: boolean;
  /** 'full' = legacy single column. 'sidebar' = 属性栏(meta/附件/可见岗位/审批配置). 'main' = 执行说明 only. */
  layout?: 'full' | 'sidebar' | 'main';
}) {
  const [draft, setDraft] = useState(taskDetails?.instructions || '');
  const [dirty, setDirty] = useState(false);
  const [pendingReschedule, setPendingReschedule] = useState<{ taskId: string; startDate: string; newDue: string } | null>(null);
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
    if (!filesEditable) return;
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

  // Task meta: users for assignee name resolution (covers any historical assignee)
  const { data: metaUsers = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  // Assignee dropdown is scoped to project members (owner included), not the whole org.
  const { data: projectMembers = [] } = trpc.members.list.useQuery(
    { projectId },
    { staleTime: 60_000, enabled: !!projectId },
  );
  // O(1) user lookup by id (replaces repeated metaUsers.find(...) scans).
  const metaUserById = useMemo(() => new Map(metaUsers.map((u) => [u.id, u])), [metaUsers]);
  const assignableUsers = projectMembers.map((m) => {
    const u = metaUserById.get(m.userId);
    return {
      id: m.userId,
      name: m.userName || u?.name || u?.username || `用户#${m.userId}`,
    };
  });
  // Persist task meta (assignee / dueDate / priority) directly — same reliable path as
  // deliverables/files. The previous full-project diff route silently dropped these edits.
  const setMetaMut = trpc.tasks.setMeta.useMutation({
    onSettled: () => {
      utils.tasks.list.invalidate({ projectId });
      utils.projects.get.invalidate({ id: projectId });
      utils.projects.list.invalidate();
      utils.projects.portfolio.invalidate();
    },
  });
  const saveMeta = (patch: { assigneeUserId?: number | null; dueDate?: string | null; priority?: string }) => {
    if (!canEdit || !phaseId) return;
    setMetaMut.mutate({ projectId, phaseId, taskId, ...(patch as any) });
  };
  // 逐任务审批闸门配置（需审批 + 审批人）。仅可编辑项目信息者（canEditRoles）可改。
  const setApprovalMut = trpc.tasks.setApprovalConfig.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate({ projectId });
      utils.projects.get.invalidate({ id: projectId });
    },
  });
  const requiresApproval = !!taskDetails?.requiresApproval;
  const approverUserId = taskDetails?.approverUserId ?? null;
  const saveApprovalConfig = (next: { requiresApproval: boolean; approverUserId: number | null }) => {
    if (!phaseId) return;
    setApprovalMut.mutate({ projectId, phaseId, taskId, ...next });
  };
  const taskStatus = taskDetails?.taskStatus ?? 'todo';
  const taskStatusCfg = TASK_STATUS_CONFIG[taskStatus] ?? TASK_STATUS_CONFIG.todo;
  // 权限收口：优先级仅管理/PM 可改；附件上传/删除限负责人或管理/PM。
  // 未显式传入时（如 legacy 'full' 布局）沿用 canEdit，行为不回归。
  const priorityEditable = (canEditPriority ?? canEdit) && canEdit;
  const filesEditable = (canUploadFiles ?? canEdit) && canEdit;

  // ── Reschedule confirm dialog (shared across layouts) ──────────────────────
  const rescheduleDialog = pendingReschedule ? (
    <RescheduleConfirmDialog
      projectId={projectId}
      taskId={pendingReschedule.taskId}
      startDate={pendingReschedule.startDate}
      newDue={pendingReschedule.newDue}
      onClose={() => setPendingReschedule(null)}
      onDone={() => {
        setPendingReschedule(null);
        void utils.tasks.list.invalidate({ projectId });
        void utils.projects.get.invalidate({ id: projectId });
        void utils.projects.list.invalidate();
        void utils.projects.portfolio.invalidate();
      }}
    />
  ) : null;

  // ── 执行说明 block (lives in left main column) ──────────────────────────────
  const instructionsBlock = (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">执行说明</div>
      <div className="relative">
        <textarea
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          disabled={!canEdit}
          rows={4}
          placeholder="记录执行说明、注意事项、进展备注..."
          className="w-full px-3 py-2 rounded-md bg-secondary/40 border-b border-transparent hover:border-border focus:border-[color:var(--acc-border)] focus:bg-secondary/60 outline-none text-xs text-foreground resize-none transition-colors"
        />
        {dirty && <div className="absolute bottom-2 right-2 text-[9px] text-muted-foreground">保存中...</div>}
      </div>
    </div>
  );

  // ── 附件 block (right sidebar) ──────────────────────────────────────────────
  const attachmentsBlock = (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
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
        readOnly={!filesEditable}
      />
    </div>
  );

  // ── 可见岗位（可见性）block — 现位于「任务设置」弹层内。
  // 可编辑：canEditRoles（canEditProjectInfo）。否则只读展示已选岗位 / 「空 = 所有人可见」。
  const visibleRolesBlock = compact ? null : (() => {
    const roles = visibleRoles || [];
    const editable = canEditRoles && !!onVisibleRolesChange;
    return (
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
          <Lock size={10} />可见岗位（可见性）
        </div>
        {editable ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_OPTIONS.map(({ value, label }) => {
                const selected = roles.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      const next = selected
                        ? roles.filter((r) => r !== value)
                        : [...roles, value];
                      onVisibleRolesChange!(next);
                    }}
                    className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                      selected
                        ? 'bg-primary text-white border-primary'
                        : 'bg-card text-muted-foreground border-border hover:border-[color:var(--acc-border)]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {roles.length === 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">空 = 所有人可见（未选择岗位时所有成员均可见此任务）</p>
            )}
          </>
        ) : (
          <div className="text-[11px] text-foreground">
            {roles.length === 0
              ? <span className="text-muted-foreground">空 = 所有人可见</span>
              : roles.map((r) => ROLE_LABEL_BY_VALUE.get(r) ?? r).join(' / ')}
          </div>
        )}
      </div>
    );
  })();

  // ── 需审批 + 审批人 block. 编辑权限 = canEditTasks（与后端 setApprovalConfig 对齐）。
  const approvalConfigBlock = (() => {
    if (!canEdit) {
      // Read-only for non-editors: show only when 需审批 is on.
      if (!requiresApproval) return null;
      const approver = approverUserId != null ? metaUserById.get(approverUserId) : undefined;
      const approverName = approver?.name ?? approver?.username ?? '未指定';
      return (
        <div className="text-[11px] text-muted-foreground">
          需审批：是 · 审批人：<span className="text-foreground">{approverName}</span>
        </div>
      );
    }
    const canEnable = approverUserId != null;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">需审批</div>
          <button
            type="button"
            disabled={setApprovalMut.isPending || (!requiresApproval && !canEnable)}
            onClick={() => saveApprovalConfig({ requiresApproval: !requiresApproval, approverUserId })}
            title={!requiresApproval && !canEnable ? '请先选择审批人' : undefined}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              requiresApproval ? 'bg-primary' : 'bg-secondary border border-border'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                requiresApproval ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`}
            />
          </button>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">审批人</div>
          <select
            value={approverUserId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              const nextApprover = val === '' ? null : Number(val);
              // Clearing the approver while 需审批 is on would be invalid — turn off 需审批.
              saveApprovalConfig({
                requiresApproval: nextApprover == null ? false : requiresApproval,
                approverUserId: nextApprover,
              });
            }}
            className="w-full text-xs text-foreground bg-secondary rounded-md border border-border px-2 py-1 outline-none focus:border-[color:var(--acc-border)] transition-colors"
          >
            <option value="">— 未指定 —</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          {!requiresApproval && !canEnable && (
            <p className="text-[10px] text-muted-foreground mt-1">请先选择审批人后再开启「需审批」</p>
          )}
        </div>
      </div>
    );
  })();

  // ── 「任务设置」⚙ 弹层：可见岗位（可见性） + 需审批/审批人 ───────────────────
  // 触发按钮放在 sidebar 属性栏头部；Radix Popover 自带点击外部 / Esc 关闭。
  const hasSettingsContent = !!visibleRolesBlock || !!approvalConfigBlock;
  const taskSettingsPopover = (!compact && hasSettingsContent) ? (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="任务设置（可见性 / 需审批）"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:border-[color:var(--acc-border)] transition-colors"
        >
          <Settings size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-3 text-sm">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">任务设置</div>
        {visibleRolesBlock}
        {approvalConfigBlock && (
          <div className="border-t border-border pt-3">{approvalConfigBlock}</div>
        )}
      </PopoverContent>
    </Popover>
  ) : null;

  // ── meta grid (assignee / due / status / priority) ─────────────────────────
  const metaGrid = (
    <>
      {/* Task Meta Row: assignee / due date / status / priority.
          Execution roles (compact) see these read-only rather than hidden — P0-2. */}
      {compact ? (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">负责人</div>
          <div className="flex h-[30px] items-center px-1.5 text-xs text-foreground">
            {(() => {
              const a = taskDetails?.assigneeUserId != null ? metaUserById.get(taskDetails.assigneeUserId) : undefined;
              return a?.name ?? a?.username ?? '— 未指定 —';
            })()}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">截止日期</div>
          <div className="flex h-[30px] items-center px-1.5 text-xs text-foreground">
            {taskDetails?.dueDate ?? '— 未排期 —'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">状态</div>
          <div className="flex h-[30px] items-center gap-1.5 px-1.5 text-xs">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${taskStatusCfg.className}`}>{taskStatusCfg.label}</span>
            <span className="text-[10px] text-muted-foreground">自动</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">优先级</div>
          <div className="flex h-[30px] items-center px-1.5 text-xs text-foreground">
            {TASK_PRIORITY_OPTIONS.find((o) => o.value === (taskDetails?.taskPriority ?? 'medium'))?.label ?? '—'}
          </div>
        </div>
      </div>
      ) : (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">负责人</div>
          {canEditRoles ? (
            // PM / 管理层：可改派给任意成员。
            <select
              value={taskDetails?.assigneeUserId ?? ''}
              disabled={!canEdit}
              onChange={(e) => {
                const val = e.target.value;
                saveMeta({ assigneeUserId: val === '' ? null : Number(val) });
              }}
              className="w-full text-xs text-foreground bg-transparent rounded-md px-1.5 py-1 outline-none border-b border-transparent hover:border-border focus:border-[color:var(--acc-border)] transition-colors"
            >
              <option value="">— 未指定 —</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          ) : (canEdit && currentUserId != null) ? (
            // 任务编辑者（非 PM）：仅可「认领给自己」/「取消认领」，不可指派他人。
            (() => {
              const assignedToSelf = taskDetails?.assigneeUserId === currentUserId;
              const assignee = taskDetails?.assigneeUserId != null ? metaUserById.get(taskDetails.assigneeUserId) : undefined;
              const assigneeName = assignee?.name ?? assignee?.username;
              return (
                <div className="flex h-[30px] items-center justify-between gap-2 px-1.5 text-xs text-foreground">
                  <span className="truncate">{assigneeName ?? '— 未指定 —'}</span>
                  {assignedToSelf ? (
                    <button
                      type="button"
                      disabled={setMetaMut.isPending}
                      onClick={() => saveMeta({ assigneeUserId: null })}
                      className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      取消认领
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={setMetaMut.isPending}
                      onClick={() => saveMeta({ assigneeUserId: currentUserId })}
                      className="shrink-0 text-[10px] text-primary hover:underline disabled:opacity-50"
                    >
                      指给自己
                    </button>
                  )}
                </div>
              );
            })()
          ) : (
            // 无编辑权限：只读负责人。
            <div className="flex h-[30px] items-center px-1.5 text-xs text-foreground">
              {(() => {
                const a = taskDetails?.assigneeUserId != null ? metaUserById.get(taskDetails.assigneeUserId) : undefined;
                return a?.name ?? a?.username ?? '— 未指定 —';
              })()}
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">截止日期</div>
          {/* 自动排期：截止日期只读展示，不再提供日期选择器。 */}
          <div className="flex h-[30px] items-center px-1.5 text-xs text-foreground">
            {taskDetails?.dueDate ?? '未排期 (自动排期)'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">状态</div>
          <div className="flex h-[30px] items-center gap-1.5 px-1.5 text-xs">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${taskStatusCfg.className}`}>{taskStatusCfg.label}</span>
            <span className="text-[10px] text-muted-foreground">自动</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">优先级</div>
          {priorityEditable ? (
            <select
              value={taskDetails?.taskPriority ?? 'medium'}
              onChange={(e) => saveMeta({ priority: e.target.value })}
              className="w-full text-xs text-foreground bg-transparent rounded-md px-1.5 py-1 outline-none border-b border-transparent hover:border-border focus:border-[color:var(--acc-border)] transition-colors"
            >
              {TASK_PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            // 仅管理/PM 可改优先级：其余只读展示标签。
            <div className="flex h-[30px] items-center px-1.5 text-xs text-foreground">
              {TASK_PRIORITY_OPTIONS.find((o) => o.value === (taskDetails?.taskPriority ?? 'medium'))?.label ?? '—'}
            </div>
          )}
        </div>
      </div>
      )}
    </>
  );

  // ── 'main' layout: 执行说明 only (left column). ─────────────────────────────
  if (layout === 'main') {
    return (
      <div className="space-y-3">
        {instructionsBlock}
        {rescheduleDialog}
      </div>
    );
  }

  // ── 'sidebar' layout: 任务设置⚙(可见性/需审批) + meta + 附件 (right column). ──
  if (layout === 'sidebar') {
    return (
      <div className="space-y-3">
        {taskSettingsPopover && (
          <div className="flex justify-end">{taskSettingsPopover}</div>
        )}
        {metaGrid}
        {attachmentsBlock}
        {rescheduleDialog}
      </div>
    );
  }

  // ── 'full' layout (legacy single-column fallback). ──────────────────────────
  return (
    <div className="mt-3 border-t border-border pt-3 space-y-3">
      {metaGrid}
      {instructionsBlock}
      {attachmentsBlock}
      {approvalConfigBlock}
      {visibleRolesBlock}
      {rescheduleDialog}
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
    return <span className="text-xs text-foreground">{displayName}</span>;
  }

  return (
    <select
      value={pmUserId ?? ''}
      onChange={(e) => {
        const val = e.target.value;
        onChange(val === '' ? null : Number(val));
      }}
      className="text-xs text-foreground bg-transparent border-none outline-none cursor-pointer hover:text-primary transition-colors"
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

// ── P1–P7 Phase Stepper ───────────────────────────────────────────────────────
// Linear-style horizontal stepper: done phases get a filled indigo dot + check,
// the current phase a ringed dot, future phases a plain numbered dot. Clicking a
// node jumps the task view to that phase (presentation-only; no data mutation).
function PhaseStepper({
  phases, currentPhaseId, activePhaseId, onSelect, getStatus,
}: {
  phases: SOPPhase[];
  currentPhaseId: string;
  activePhaseId: string;
  onSelect: (id: string) => void;
  getStatus: (id: string) => 'completed' | 'active' | string;
}) {
  return (
    <div className="flex items-center rounded-[11px] border border-border bg-secondary px-4 py-3.5 overflow-x-auto">
      {phases.map((phase, i) => {
        const status = getStatus(phase.id);
        const done = status === 'completed';
        const isCurrent = phase.id === currentPhaseId;
        const isActive = phase.id === activePhaseId;
        const last = i === phases.length - 1;
        return (
          <div key={phase.id} className={`flex items-center ${last ? '' : 'flex-1'} min-w-fit`}>
            <button
              type="button"
              onClick={() => onSelect(phase.id)}
              className="flex flex-col items-center gap-1.5 shrink-0"
              title={`${phase.code} · ${phase.name}`}
            >
              <span
                className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors ${
                  done
                    ? 'border-primary bg-primary text-white'
                    : isCurrent
                      ? 'border-primary text-primary shadow-[0_0_0_4px_var(--acc-soft)]'
                      : 'border-border bg-card text-muted-foreground'
                }`}
              >
                {done ? (
                  <CheckCircle2 size={13} className="text-white" strokeWidth={3} />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`text-[11.5px] font-semibold whitespace-nowrap transition-colors ${
                  isActive ? 'text-primary' : done || isCurrent ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {phase.code}
              </span>
            </button>
            {!last && (
              <span className={`h-0.5 flex-1 mx-2.5 mb-6 min-w-[16px] ${done ? 'bg-primary' : 'bg-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ProjectDetailView({ project, onUpdate, onBack, initialPhaseId, initialTaskId, initialTab }: ProjectDetailViewProps) {
  const [activePhaseId, setActivePhaseId] = useState(initialPhaseId ?? project.currentPhase);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null);
  // 任务详情子窗口：Esc 关闭
  useEffect(() => {
    if (!selectedTaskId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedTaskId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTaskId]);
  const [mainTab, setMainTab] = useState<ProjectMainTab>(
    initialTab ? normalizeMainTab(initialTab) : (initialTaskId ? 'tasks' : 'overview'),
  );
  // Sub-view toggles for the consolidated tabs (seeded from any legacy deep-link).
  const [taskView, setTaskView] = useState<TaskSubView>(taskSubViewForLegacy(initialTab));
  const [reviewsView, setReviewsView] = useState<ReviewSubView>(reviewSubViewForLegacy(initialTab));
  const [materialsView, setMaterialsView] = useState<MaterialSubView>(materialSubViewForLegacy(initialTab));
  // Deep-linked into a task/tab → land there; don't let the role-default override it.
  const roleDefaultAppliedRef = useRef(!!initialTaskId || !!initialTab);
  const issueDeepLinkPhaseAppliedRef = useRef(false);
  const [ganttMode, setGanttMode] = useState<'task' | 'phase'>('task');
  // 任务 tab 的阶段筛选器：'all' 看全部，或某 phaseId 只看该阶段（统一作用看板/列表/甘特）。
  const [taskPhaseFilter, setTaskPhaseFilter] = useState<string>('all');
  const perms = useProjectPermission(project.id);
  const { user: currentUser } = useAuth();
  // 任务详情弹窗：左栏底部四标签
  const [taskTab, setTaskTab] = useState<'comments' | 'activity' | 'flow' | 'approval'>('comments');
  // 活动/流转/审批标签里把 userId 解析为人名用
  const { data: detailUsers = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const detailUtils = trpc.useUtils();
  const confirmGateMutation = trpc.gateReviews.confirmAndAdvance.useMutation();
  // 撤回待审批：直接以 completed=false 调用，避免本地 toggle 误发 completed=true（=重复提交）。
  const withdrawApprovalMut = trpc.tasks.setCompleted.useMutation({
    onSuccess: () => {
      detailUtils.tasks.list.invalidate({ projectId: project.id });
      detailUtils.projects.get.invalidate({ id: project.id });
    },
    onError: (e) => {
      toast.error(e.data?.code === 'FORBIDDEN' ? '没有撤回此任务的权限' : `撤回失败：${e.message}`);
    },
  });
  const withdrawTaskApproval = (taskId: string) => {
    // 无编辑权者点了也会被服务端拒；提前拦一下给出明确反馈
    if (!canActOnTask(taskId)) { toast.error('没有撤回此任务的权限（仅任务负责人或对应岗位）'); return; }
    withdrawApprovalMut.mutate({ projectId: project.id, phaseId: activePhaseId, taskId, completed: false });
  };
  const { data: effectiveProcess } = trpc.tailoring.effectiveProcess.useQuery(
    { projectId: project.id },
    { staleTime: 5_000 }
  );

  // Server-side gate readiness (review-aware) for the active phase — used to make
  // the inline gate panel's deliverables dimension consistent with the server.
  const { data: serverGateReadiness } = trpc.gateReviews.readiness.useQuery(
    { projectId: project.id, phaseId: activePhaseId },
    { staleTime: 5_000 }
  );
  const { data: releasePrecheck } = trpc.products.releasePrecheck.useQuery(
    { projectId: project.id },
    { staleTime: 10_000 }
  );

  useEffect(() => {
    if (roleDefaultAppliedRef.current || perms.isLoading) return;
    const legacyDefault = defaultTabForRole(perms.role);
    setMainTab(normalizeMainTab(legacyDefault));
    setTaskView(taskSubViewForLegacy(legacyDefault));
    setReviewsView(reviewSubViewForLegacy(legacyDefault));
    setMaterialsView(materialSubViewForLegacy(legacyDefault));
    roleDefaultAppliedRef.current = true;
  }, [perms.isLoading, perms.role]);

  // Change Log helpers
  const changeLog: ChangeRecord[] = project.changeLog || [];
  const pendingChangeCount = changeLog.filter((r) => r.status === 'proposed').length;
  const updateChangeLog = (records: ChangeRecord[]) => {
    onUpdate({ ...project, changeLog: records });
  };

  // 闭环:由问题一键发起变更(预填来源,跳到变更记录补充决策人/影响)
  const handleRaiseChange = (issue: Issue) => {
    const now = new Date();
    const newRecord: ChangeRecord = {
      id: `tmp-${now.getTime()}`,
      number: '',
      type: 'eco',
      title: `[问题] ${issue.title}`,
      description: issue.desc || '',
      reason: issue.rootCause || `源于问题「${issue.title}」(${issue.severity})`,
      decisionMaker: '',
      affectedPhases: [activePhaseId],
      status: 'proposed',
      createdAt: now.toISOString(),
      createdDate: now.toISOString().slice(0, 10),
      notes: `来源:问题「${issue.title}」(#${issue.id})`,
    };
    updateChangeLog([...(project.changeLog ?? []), newRecord]);
    setMainTab('activity');
    toast.success('已从问题发起变更,请补充决策人与影响');
  };

  const projectPhases = getProjectPhases(project);
  const phaseMap = Object.fromEntries(projectPhases.map((p) => [p.id, p]));
  const activeBasePhase = phaseMap[activePhaseId] || PHASE_MAP[activePhaseId];
  const activePhaseData = project.phases[activePhaseId];
  const activePhase = getPhaseWithHandoffTasks(activeBasePhase, activePhaseData, project);
  const effectiveActivePhase = effectiveProcess?.phases.find((phase) => phase.id === activePhaseId);
  const activeGateDeliverables =
    effectiveActivePhase?.submittedDeliverables ?? activePhase?.gateStandard?.requiredDeliverables ?? [];
  // Derive satisfied deliverable names from server readiness: required minus the blockers list.
  // While loading, keep a conservative empty set instead of falling back to legacy task checks.
  const serverDelivSatisfiedSet: string[] = (() => {
    const dim = serverGateReadiness?.dimensions.find((d) => d.dimension === 'deliverables');
    if (!dim) return [];
    const missingSet = new Set(dim.blockers);
    return activeGateDeliverables.filter((name) => !missingSet.has(name));
  })();
  // 归集项映射：deliverableName → 来源阶段显示名（用于 DeliverablesChecklist 标注）
  const activeGateCarriedMap: Record<string, string> = Object.fromEntries(
    (effectiveActivePhase?.carriedDeliverables ?? []).map(({ name, fromPhaseId }) => [
      name,
      PHASE_MAP[fromPhaseId]?.name ?? fromPhaseId,
    ])
  );
  const activeProgress = computePhaseProgress(activePhaseData, activePhaseId, activePhase);
  const overallProgress = computeOverallProgress(project);
  const health = HEALTH_CONFIG[project.risk];
  const riskOverrideActive = !!project.riskOverrideRisk;
  const riskOverrideReason = project.riskOverrideReason?.trim() ?? '';
  const [riskOverrideOpen, setRiskOverrideOpen] = useState(false);
  // 设置抽屉占位（真实抽屉为后续任务 PD2；当前仅打开总览的设置面板入口）。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [riskOverrideDraft, setRiskOverrideDraft] = useState<Project['risk']>(project.riskOverrideRisk ?? project.risk);
  const [riskOverrideReasonDraft, setRiskOverrideReasonDraft] = useState(project.riskOverrideReason ?? '');
  const isCurrentPhaseUnlocked = isPhaseUnlocked(project, activePhaseId);
  const blockingGate = getBlockingGate(project, activePhaseId);
  const catConfig = project.category ? CATEGORY_MAP[project.category] : null;
  // 任务 tab 头部摘要：全项目完成度 + 当前阶段完成度（复用 projectPhases / project.phases 完成位图）。
  const taskSummary = (() => {
    let totalTasks = 0;
    let doneTasks = 0;
    for (const phase of projectPhases) {
      const pd = project.phases[phase.id];
      for (const task of phase.tasks) {
        totalTasks += 1;
        if (pd?.tasks?.[task.id]) doneTasks += 1;
      }
    }
    const currentPhaseTotal = activePhase?.tasks.length || 0;
    const currentPhaseDone = (activePhase?.tasks || []).filter((t) => activePhaseData?.tasks?.[t.id]).length;
    return {
      totalTasks,
      doneTasks,
      currentPhaseTotal,
      currentPhaseDone,
      currentPhaseName: activePhase?.name ?? activePhaseId,
    };
  })();
  const visibleActiveTasks = activePhase?.tasks.filter((task) => {
    // 指派优先于岗位可见性：指派给当前用户的任务无条件可见，
    // 避免「被指派了任务、工作台能看到、点进项目却被 visibleRoles 过滤隐藏」的死角。
    const assignee = activePhaseData?.taskDetails?.[task.id]?.assigneeUserId;
    if (assignee != null && assignee === currentUser?.id) return true;
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
  // 任务当事人：被指派人，或任务对其角色可见（viewer 除外）。与服务端 taskAllowsEvidence
  // 判定一致——qa/scm/sales/cert/battery_safety 没有 canEditTasks，这是他们完成自己任务的通道。
  const canActOnTask = (taskId: string) => {
    if (perms.canEditTasks) return true;
    if (!perms.role || perms.role === 'viewer') return false;
    const assignee = activePhaseData?.taskDetails?.[taskId]?.assigneeUserId;
    if (assignee != null && assignee === currentUser?.id) return true;
    const effectiveRoles = project.taskVisibleRoles?.[taskId]
      ?? (activePhase?.tasks.find((t) => t.id === taskId)?.visibleRoles || []);
    return effectiveRoles.length > 0 && effectiveRoles.includes(perms.role);
  };
  const canActOnSelectedTask = selectedTask ? canActOnTask(selectedTask.id) : false;
  const compactTaskDetail = isExecutionRole(perms.role) && !selectedTaskIsGate;
  // P2: 执行角色(如结构工程师)收敛项目详情标签——只保留 总览/任务/问题/BOM/文件,
  // 隐藏 PM/管理层导向的 度量/看板/需求池/甘特/变更,减少干扰(内容仍按 mainTab 渲染,不影响深链)。
  const execLens = isExecutionRole(perms.role);

  // 执行角色视角：若(经由深链等)落到被隐藏的子视图/标签，回落到可见默认，避免空白。
  useEffect(() => {
    if (!execLens) return;
    if (taskView !== 'list') setTaskView('list');
    if (reviewsView === 'requirements') setReviewsView('issues');
    if (mainTab === 'activity') setMainTab('reviews');
  }, [execLens, taskView, reviewsView, mainTab]);

  // 阶段筛选器选中某阶段时，让「列表」子视图跟随切到该阶段（'all' 不动，保留 phase-nav 原行为）。
  useEffect(() => {
    if (taskPhaseFilter !== 'all') setActivePhaseId(taskPhaseFilter);
  }, [taskPhaseFilter]);

  const updateField = (field: keyof Project, value: string) => onUpdate({ ...project, [field]: value });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateFieldAny = (field: keyof Project, value: any) => onUpdate({ ...project, [field]: value });
  const openRiskOverrideEditor = () => {
    setRiskOverrideDraft(project.riskOverrideRisk ?? project.risk);
    setRiskOverrideReasonDraft(project.riskOverrideReason ?? '');
    setRiskOverrideOpen(true);
  };
  const saveRiskOverride = () => {
    const reason = riskOverrideReasonDraft.trim();
    if (!reason) {
      toast.error('请填写手动覆盖原因');
      return;
    }
    onUpdate({
      ...project,
      risk: riskOverrideDraft,
      riskOverrideRisk: riskOverrideDraft,
      riskOverrideReason: reason,
    });
    setRiskOverrideOpen(false);
    toast.success('健康度已手动覆盖');
  };
  const clearRiskOverride = () => {
    onUpdate({
      ...project,
      riskOverrideRisk: null,
      riskOverrideReason: null,
      riskOverrideUpdatedAt: null,
      riskOverrideUpdatedBy: null,
    });
    setRiskOverrideOpen(false);
    toast.success('已恢复自动健康度');
  };

  const toggleTask = (taskId: string) => {
    // Gate lock check: if this phase is locked, disallow toggling
    if (!isPhaseUnlocked(project, activePhaseId)) return;
    // 无权限时给出明确反馈，不做静默 no-op（用户点了没反应会反复点）
    if (!canActOnTask(taskId)) {
      toast.error('没有编辑此任务的权限（仅任务负责人或对应岗位可完成）');
      return;
    }
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = {
      ...activePhaseData,
      tasks: { ...activePhaseData.tasks, [taskId]: !activePhaseData.tasks[taskId] },
    };
    const becameDone = !activePhaseData.tasks[taskId];
    const newProgress = computePhaseProgress(newProject.phases[activePhaseId], activePhaseId, activePhase);
    let advancedTo: string | null = null;
    if (newProgress === 100) {
      const idx = projectPhases.findIndex((p) => p.id === activePhaseId);
      if (idx < projectPhases.length - 1 && activePhaseId === project.currentPhase) {
        newProject.currentPhase = projectPhases[idx + 1].id;
        advancedTo = projectPhases[idx + 1].name;
      }
    }
    onUpdate(newProject);
    // P1-2: 完成任务后给执行者明确反馈——是否推进阶段 / 还差什么阻塞项。
    if (becameDone) {
      if (advancedTo) {
        toast.success(`本阶段已全部完成，阶段推进至「${advancedTo}」`);
      } else {
        const { blockers } = computeGateReadiness(activePhase, newProject.phases[activePhaseId], activeGateDeliverables, serverDelivSatisfiedSet);
        if (blockers.length > 0) {
          toast(`任务已完成。本阶段距 Gate 放行还差：${blockers.join('、')}`);
        } else {
          toast.success('任务已完成');
        }
      }
    }
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
    setTaskView('list');
    setMainTab('tasks');
  };

  // Issue List helpers
  const activeIssues: Issue[] = activePhaseData?.issues || [];
  const selectedTaskIssues = selectedTask
    ? dedupeRelatedIssues(activeIssues.filter((issue) => issue.relatedTaskId === selectedTask.id))
    : [];
  const openIssueCount = activeIssues.filter((i) => i.status === 'open' || i.status === 'in_progress').length;
  const projectOpenIssueCount = projectPhases.reduce(
    (sum, phase) => sum + (project.phases[phase.id]?.issues ?? []).filter((i) => i.status === 'open' || i.status === 'in_progress').length,
    0,
  );
  const firstOpenIssuePhaseId = projectPhases.find((phase) =>
    (project.phases[phase.id]?.issues ?? []).some((i) => i.status === 'open' || i.status === 'in_progress')
  )?.id;

  useEffect(() => {
    if (issueDeepLinkPhaseAppliedRef.current || initialTab !== 'issues' || initialPhaseId || !firstOpenIssuePhaseId) return;
    issueDeepLinkPhaseAppliedRef.current = true;
    setActivePhaseId(firstOpenIssuePhaseId);
  }, [firstOpenIssuePhaseId, initialPhaseId, initialTab]);

  const updateIssues = (issues: Issue[]) => {
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = { ...activePhaseData, issues };
    onUpdate(newProject);
  };

  const handleCreateIssueFromSelectedTask = () => {
    if (!selectedTask || !perms.canEditIssues) return;
    const now = new Date();
    const newIssue: Issue = {
      id: `tmp-${now.getTime()}`,
      title: `[任务] ${selectedTask.name}`,
      desc: selectedTask.desc || '',
      severity: 'P2',
      status: 'open',
      category: categoryForRole(perms.role),
      owner: selectedTask.owner || '',
      reporter: currentUser?.name || currentUser?.username || '',
      foundDate: localDateISO(now),
      targetDate: '',
      rootCause: '',
      solution: '',
      relatedTaskId: selectedTask.id,
      creatorId: currentUser?.id ? String(currentUser.id) : undefined,
    };
    updateIssues([...activeIssues, newIssue]);
    toast.success('已从当前任务创建关联 Issue');
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

  const handleGateReviewConfirm = async (review: GateReview) => {
    // 原子化：服务端一次完成「记录评审 + 标 gate task done + 推进阶段」，
    // 避免旧的客户端三笔分散写经 600ms 防抖串起时的部分持久化（→阶段锁死）。
    const phaseId = activePhaseId;
    setGateReviewPending(null);
    try {
      await confirmGateMutation.mutateAsync({
        projectId: project.id,
        phaseId,
        gateTaskId: activePhase?.gateTaskId || null,
        phaseName: activePhase?.name ?? phaseId,
        gateName: activePhase?.gate ?? 'Gate 评审',
        reviewDate: review.reviewDate,
        participants: review.participants || null,
        decision: review.decision,
        conditions: review.conditions || null,
        notes: review.notes || null,
      });
      // 刷新项目详情 + 组合看板（取代旧的乐观本地更新，确保与服务端一致）
      await Promise.all([
        detailUtils.projects.get.invalidate({ id: project.id }),
        detailUtils.tasks.list.invalidate({ projectId: project.id }),
        detailUtils.gateReviews.list.invalidate({ projectId: project.id }),
        detailUtils.gateReviews.readiness.invalidate({ projectId: project.id, phaseId }),
        detailUtils.phases.list.invalidate({ projectId: project.id }),
        detailUtils.projects.list.invalidate(),
        detailUtils.projects.portfolio.invalidate(),
      ]);
      if (review.decision === 'rejected') toast.error('已记录：本阶段 Gate 未通过，整改后可重新评审');
      else toast.success(review.decision === 'conditional' ? 'Gate 有条件通过，已推进' : 'Gate 已通过，已推进');
    } catch (e) {
      toast.error(`Gate 评审保存失败，请重试${e instanceof Error ? `：${e.message}` : ''}`);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <LinearCard className="p-5 lg:p-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={14} /> 返回项目列表
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              title="项目设置"
              aria-label="项目设置"
              className="flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground border border-border hover:bg-secondary hover:text-foreground px-2.5 py-1.5 transition-colors"
            >
              <Settings size={13} /> 设置
            </button>
            {perms.canEditProjectInfo && (
              <button
                onClick={() => setReleaseOpen(true)}
                className="flex items-center gap-1.5 rounded-md text-xs font-medium bg-primary hover:opacity-90 text-white px-3 py-1.5 shadow-sm transition-opacity"
              >
                <Rocket size={13} /> 量产发布
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <EditableText value={project.code} onChange={perms.canEditProjectInfo ? (v) => updateField('code', v) : () => {}} readOnly={!perms.canEditProjectInfo} className="text-[10px] num uppercase tracking-widest text-muted-foreground" />
              {catConfig && (
                <span className={`text-[9px] uppercase tracking-wider rounded px-1.5 py-0.5 ${catConfig.color} ${catConfig.textColor} border ${catConfig.borderColor}`}>
                  {catConfig.badge}
                </span>
              )}
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold tracking-[-0.4px] text-foreground leading-tight">
              <EditableText
                value={project.name}
                onChange={perms.canEditProjectInfo ? (v) => updateField('name', v) : () => {}}
                readOnly={!perms.canEditProjectInfo}
                className="text-3xl lg:text-4xl font-bold tracking-[-0.4px] text-foreground leading-tight"
                inputClassName="text-3xl lg:text-4xl font-bold tracking-[-0.4px] text-foreground leading-tight w-full"
              />
            </h1>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">类型</span>
                {perms.canEditProjectInfo ? (
                  <EditableSelect
                    value={project.type}
                    options={['汽车充气泵', '自行车充气泵', '户外充气泵', '车载吸尘器', '暴力风扇', '胎压计', '机械式打气筒', '组件']}
                    // 产品类型持久化到 customFields.productType（无独立列），并同步 type 供即时显示
                    onChange={(v) => onUpdate({ ...project, type: v, customFields: { ...(project.customFields ?? {}), productType: v } })}
                    className="text-xs text-foreground"
                  />
                ) : (
                  <span className="text-xs text-foreground">{project.type || '—'}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">PM</span>
                <PmSelector
                  pmUserId={project.pmUserId ?? null}
                  onChange={(id) => updateFieldAny('pmUserId', id)}
                  disabled={!perms.canEditProjectInfo}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar size={12} className="text-muted-foreground" />
                <EditableText value={project.startDate} onChange={perms.canEditProjectInfo ? (v) => updateField('startDate', v) : () => {}} readOnly={!perms.canEditProjectInfo} className="text-xs num text-foreground" placeholder="开始日期" />
                <span className="text-muted-foreground">→</span>
                <EditableText value={project.targetDate} onChange={perms.canEditProjectInfo ? (v) => updateField('targetDate', v) : () => {}} readOnly={!perms.canEditProjectInfo} className="text-xs num text-foreground" placeholder="目标日期" />
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (perms.canEditProjectInfo) {
                      openRiskOverrideEditor();
                    } else {
                      toast.info('仅 Owner / 管理层 / PM 可手动覆盖健康度');
                    }
                  }}
                  className={`group inline-flex max-w-full items-center gap-1.5 rounded border border-transparent px-1.5 py-1 text-left transition-colors ${
                    perms.canEditProjectInfo ? 'hover:border-border hover:bg-secondary' : 'cursor-help hover:border-border hover:bg-secondary'
                  }`}
                  title={riskOverrideReason || (perms.canEditProjectInfo ? '点击手动覆盖健康度' : '仅 Owner / 管理层 / PM 可手动覆盖健康度')}
                >
                  <StatusDot tone={project.risk === 'high' ? 'red' : project.risk === 'medium' ? 'amber' : 'green'} />
                  <span className={`text-xs font-medium ${health.color}`}>项目健康度：{health.label}</span>
                  <span className={`text-[10px] ${riskOverrideActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {riskOverrideActive ? '手动' : '自动'}
                  </span>
                  {perms.canEditProjectInfo && <Edit3 size={11} className="text-muted-foreground group-hover:text-foreground" />}
                </button>
                {riskOverrideActive && riskOverrideReason && (
                  <span className="max-w-[220px] truncate text-[11px] text-muted-foreground" title={riskOverrideReason}>
                    原因：{riskOverrideReason}
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* Overall Progress */}
          <div className="lg:w-48 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">整体进度</span>
              <span className="text-lg font-semibold text-foreground num">{overallProgress}%</span>
            </div>
            <LinearBar value={overallProgress} className="h-2" />
          </div>
        </div>
      </LinearCard>

      <PhaseStepper
        phases={projectPhases}
        currentPhaseId={project.currentPhase}
        activePhaseId={activePhaseId}
        onSelect={(id) => { setActivePhaseId(id); setSelectedTaskId(null); }}
        getStatus={(id) => getPhaseStatus(project, id)}
      />

      {riskOverrideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="risk-override-title" className="w-full max-w-lg rounded-[11px] border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 id="risk-override-title" className="text-xl font-bold tracking-[-0.3px] text-foreground">手动覆盖健康度</h2>
                <p className="mt-1 text-xs text-muted-foreground">当前显示为 {health.label}，保存后工作台和项目列表会使用手动结果。</p>
              </div>
              <button type="button" onClick={() => setRiskOverrideOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <div className="mb-2 text-xs font-medium text-foreground">健康度</div>
                <div className="grid grid-cols-3 gap-2">
                  {RISK_OVERRIDE_OPTIONS.map((option) => {
                    const cfg = HEALTH_CONFIG[option.value];
                    const active = riskOverrideDraft === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setRiskOverrideDraft(option.value)}
                        className={`rounded-md border px-3 py-2 text-left transition-colors ${
                          active ? `${cfg.bg} ${cfg.border}` : 'border-border hover:bg-secondary'
                        }`}
                      >
                        <span className={`block text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-foreground">覆盖原因 *</span>
                <textarea
                  value={riskOverrideReasonDraft}
                  onChange={(event) => setRiskOverrideReasonDraft(event.target.value)}
                  placeholder="例如：[TEST] UN38.3 认证延期，DVT 样机放行存在两周风险。"
                  className="min-h-28 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[color:var(--acc-border)] focus:ring-2 focus:ring-[color:var(--acc-soft)]"
                  maxLength={1000}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5">
              <button
                type="button"
                onClick={clearRiskOverride}
                className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!riskOverrideActive}
              >
                恢复自动
              </button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setRiskOverrideOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary">
                  取消
                </button>
                <button type="button" onClick={saveRiskOverride} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                  保存覆盖
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ProjectFocusBand
        phaseName={activePhase?.name ?? activePhaseId}
        activeProgress={activeProgress}
        gateName={activePhase?.gate ?? 'Gate 评审'}
        readiness={serverGateReadiness}
        openIssueCount={projectOpenIssueCount}
        pendingChangeCount={pendingChangeCount}
        releasePrecheck={releasePrecheck}
        canReleaseAction={perms.canEditProjectInfo}
        onTasks={() => setMainTab('tasks')}
        onGate={() => {
          setMainTab('tasks');
          if (activePhase?.gateTaskId) setSelectedTaskId(activePhase.gateTaskId);
        }}
        onIssues={() => {
          if (firstOpenIssuePhaseId) setActivePhaseId(firstOpenIssuePhaseId);
          setReviewsView('issues');
          setMainTab('reviews');
        }}
        onChanges={() => setMainTab('activity')}
        onRelease={() => setReleaseOpen(true)}
      />

      {/* Main Tab Bar (collapsed to 5): 总览 / 任务 / 评审与风险 / 物料与文件 / 动态 */}
      <div className="flex flex-nowrap items-center gap-1 px-1 overflow-x-auto border-b border-border">
        <button
          onClick={() => setMainTab('overview')}
          className={`flex items-center gap-2 px-4 py-3 text-[13.5px] font-medium border-b-2 -mb-px transition-colors shrink-0 whitespace-nowrap ${
            mainTab === 'overview'
              ? 'border-b-primary text-primary'
              : 'border-b-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <LayoutDashboard size={14} />
          总览
        </button>
        <button
          onClick={() => setMainTab('tasks')}
          className={`flex items-center gap-2 px-4 py-3 text-[13.5px] font-medium border-b-2 -mb-px transition-colors shrink-0 whitespace-nowrap ${
            mainTab === 'tasks'
              ? 'border-b-primary text-primary'
              : 'border-b-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ListChecks size={14} />
          任务
          {visibleActiveTasks.length > 0 && (
            <span className="text-[9px] num rounded-full bg-secondary text-muted-foreground border border-border px-1.5 py-0.5 min-w-[18px] text-center">
              {visibleActiveTasks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setMainTab('reviews')}
          className={`flex items-center gap-2 px-4 py-3 text-[13.5px] font-medium border-b-2 -mb-px transition-colors shrink-0 whitespace-nowrap ${
            mainTab === 'reviews'
              ? 'border-b-rose-600 text-rose-700'
              : 'border-b-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bug size={14} />
          评审与风险
          {openIssueCount > 0 && (
            <span className="text-[9px] num rounded-full bg-rose-100 text-rose-700 border border-rose-200 px-1.5 py-0.5 min-w-[18px] text-center">
              {openIssueCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setMainTab('materials')}
          className={`flex items-center gap-2 px-4 py-3 text-[13.5px] font-medium border-b-2 -mb-px transition-colors shrink-0 whitespace-nowrap ${
            mainTab === 'materials'
              ? 'border-b-primary text-primary'
              : 'border-b-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <FolderOpen size={14} />
          物料与文件
        </button>
        {!execLens && (
        <button
          onClick={() => setMainTab('activity')}
          className={`flex items-center gap-2 px-4 py-3 text-[13.5px] font-medium border-b-2 -mb-px transition-colors shrink-0 whitespace-nowrap ${
            mainTab === 'activity'
              ? 'border-b-primary text-primary'
              : 'border-b-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <GitBranch size={14} />
          动态
          {pendingChangeCount > 0 && (
            <span className="text-[9px] num rounded-full bg-[color:var(--acc-soft)] text-primary border border-[color:var(--acc-border)] px-1.5 py-0.5 min-w-[18px] text-center">
              {pendingChangeCount}
            </span>
          )}
        </button>
        )}
      </div>

      {/* ── 评审与风险 Tab：问题 / 风险 / 需求池 / Gate 子视图切换 ─────────────── */}
      {mainTab === 'reviews' && (
        <div className="px-1 pt-3">
          <SegToggle<ReviewSubView>
            value={reviewsView}
            onChange={setReviewsView}
            options={[
              { value: 'issues', label: '问题' },
              { value: 'risks', label: '风险' },
              // 需求池：执行角色视角下隐藏（与原 execLens 收敛一致）。
              ...(!execLens ? [{ value: 'requirements' as const, label: '需求池' }] : []),
              { value: 'gate', label: 'Gate' },
            ]}
          />
        </div>
      )}

      {/* ── Issues sub-view ───────────────────────────────────────────────── */}
      {mainTab === 'reviews' && reviewsView === 'issues' && (
        <div className="space-y-4">
          {/* Phase Navigation (compact) — 任何阶段都可记录问题 */}
          <LinearCard className="overflow-x-auto">
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
                      isActive ? 'border-b-rose-600 bg-rose-50/30' : 'border-b-transparent hover:bg-secondary'
                    }`}
                  >
                    <div className="text-[9px] num uppercase tracking-widest text-muted-foreground mb-0.5">{phase.code}</div>
                    <div className={`text-xs font-medium ${isActive ? 'text-rose-700' : 'text-muted-foreground'}`}>{phase.name}</div>
                    <div className="mt-1 flex items-center gap-1">
                      {openCount > 0 ? (
                        <span className="text-[9px] num rounded bg-rose-100 text-rose-700 border border-rose-200 px-1 py-0.5">
                          {openCount} 待处理
                        </span>
                      ) : (
                        <span className="text-[9px] num text-muted-foreground">{phaseIssues.length} 问题</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </LinearCard>
          <IssueList
            phaseId={activePhaseId}
            phaseName={activePhase?.name || activePhaseId}
            issues={activeIssues}
            onUpdate={updateIssues}
            canEdit={perms.canEditIssues}
            currentUserId={currentUser?.id !== undefined ? String(currentUser.id) : undefined}
            canManage={perms.canManageMembers}
            phaseTasks={(activePhase?.tasks ?? []).map((t) => ({ id: t.id, name: t.name }))}
            onRaiseChange={perms.canEditChangelog ? handleRaiseChange : undefined}
          />
        </div>
      )}

      {/* ── 风险 sub-view（复用 OverviewPanel 风险生命周期所用的 RisksPanel）──── */}
      {mainTab === 'reviews' && reviewsView === 'risks' && (
        <div className="p-6">
          <RisksPanel projectId={project.id} canEdit={perms.canEditProjectInfo} />
        </div>
      )}

      {/* ── 需求池 sub-view ────────────────────────────────────────────────── */}
      {mainTab === 'reviews' && reviewsView === 'requirements' && !execLens && (
        <div className="p-6">
          <RequirementPoolPanel
            scope={{ kind: 'project', projectId: project.id, phases: projectPhases }}
            canEdit={perms.canEditRequirements}
          />
        </div>
      )}

      {/* ── Gate sub-view：复用现有 Gate 评审就绪度 + GateReviewModal 流程 ────── */}
      {mainTab === 'reviews' && reviewsView === 'gate' && (
        <div className="p-6 space-y-4">
          <LinearCard className="overflow-x-auto">
            <div className="flex min-w-max">
              {projectPhases.map((phase) => {
                const isActive = phase.id === activePhaseId;
                const reviews = project.phases[phase.id]?.gateReviews || [];
                const latest = reviews[reviews.length - 1];
                return (
                  <button
                    key={phase.id}
                    onClick={() => setActivePhaseId(phase.id)}
                    className={`flex-1 min-w-[100px] p-3 text-left transition-all border-b-2 ${
                      isActive ? 'border-b-primary bg-secondary' : 'border-b-transparent hover:bg-secondary'
                    }`}
                  >
                    <div className="text-[9px] num uppercase tracking-widest text-muted-foreground mb-0.5">{phase.code}</div>
                    <div className={`text-xs font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>{phase.name}</div>
                    <div className="mt-1.5 flex items-center gap-1">
                      {latest ? <GateReviewBadge review={latest} /> : <span className="text-[9px] num text-muted-foreground">未评审</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </LinearCard>
          <LinearCard className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Target size={14} className="text-primary" />
              <span className="text-sm font-medium text-foreground">{activePhase?.name} · {activePhase?.gate || 'Gate 评审'}</span>
            </div>
            {(() => {
              const reviews = activePhaseData?.gateReviews || [];
              const latest = reviews[reviews.length - 1];
              const { blockers } = computeGateReadiness(activePhase, activePhaseData, activeGateDeliverables, serverDelivSatisfiedSet);
              return (
                <>
                  {latest ? (
                    <div className="space-y-2">
                      <GateReviewBadge review={latest} />
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <div><span>参与人：</span>{latest.participants}</div>
                        {latest.conditions && <div className="col-span-2"><span>条件：</span>{latest.conditions}</div>}
                        {latest.notes && <div className="col-span-2 italic">{latest.notes}</div>}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">本阶段尚无 Gate 评审记录。</div>
                  )}
                  {blockers.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      放行阻塞项：{blockers.join('、')}
                    </div>
                  )}
                  <button
                    onClick={() => setGateReviewPending({ phaseId: activePhaseId })}
                    className="text-xs text-primary rounded-md border border-dashed border-[color:var(--acc-border)] px-3 py-2 hover:bg-[color:var(--acc-soft)] transition-colors"
                  >
                    {latest ? '查看 / 补充 Gate 评审记录' : '+ 填写 Gate 评审记录'}
                  </button>
                </>
              );
            })()}
          </LinearCard>
        </div>
      )}

      {/* ── 动态 Tab：变更记录 ───────────────────────────────────────────── */}
      {mainTab === 'activity' && !execLens && (
        <div className="p-6">
          <ChangeLog
            projectId={project.id}
            records={changeLog}
            onUpdate={updateChangeLog}
            canEdit={perms.canEditChangelog}
          />
        </div>
      )}

      {/* ── 物料与文件 Tab：BOM / 文件 子视图切换 ─────────────────────────── */}
      {mainTab === 'materials' && (
        <div className="px-1 pt-3">
          <SegToggle<MaterialSubView>
            value={materialsView}
            onChange={setMaterialsView}
            options={[
              { value: 'bom', label: 'BOM' },
              { value: 'files', label: '文件' },
            ]}
          />
        </div>
      )}

      {mainTab === 'materials' && materialsView === 'bom' && (
        <div className="p-6">
          <BomPanel projectId={project.id} canEdit={perms.canEditProjectInfo || perms.canEditChangelog} />
        </div>
      )}

      {mainTab === 'materials' && materialsView === 'files' && (
        <div className="p-6">
          <FilesPanel project={project} role={perms.role} />
        </div>
      )}

      {/* ── Overview Tab：三栏只读仪表盘（OverviewPanel 保留供后续设置抽屉复用）── */}
      {mainTab === 'overview' && (
        <div className="p-6">
          <ProjectDashboard
            project={project}
            onSelectTab={(tab) => {
              const legacy = tab as LegacyMainTab;
              setTaskView(taskSubViewForLegacy(legacy));
              setReviewsView(reviewSubViewForLegacy(legacy));
              setMaterialsView(materialSubViewForLegacy(legacy));
              setMainTab(normalizeMainTab(legacy));
            }}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
      )}

      {/* ── 项目设置抽屉：复用 OverviewPanel 的全部编辑分区 ─────────────────── */}
      <ProjectSettingsDrawer open={settingsOpen} onOpenChange={setSettingsOpen}>
        <OverviewPanel
          project={project}
          onUpdate={onUpdate}
          canEdit={perms.canEditProjectInfo}
          canManageMembers={perms.canManageMembers}
          isAdmin={currentUser?.role === 'admin'}
          onOpenRiskOverride={perms.canEditProjectInfo ? openRiskOverrideEditor : undefined}
        />
      </ProjectSettingsDrawer>

      {/* ── 任务 Tab：列表 / 看板 / 甘特 / 度量 子视图（toggle 置顶，内容紧随其下） ── */}
      {mainTab === 'tasks' && (
        <div className="space-y-4">
          {/* 头部：子视图切换 + 完成度摘要 */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3">
            <SegToggle<TaskSubView>
              value={taskView}
              onChange={setTaskView}
              options={[
                { value: 'list', label: '列表' },
                // 看板/甘特/度量：执行角色视角下隐藏（与原 execLens 收敛一致）。
                ...(!execLens
                  ? ([
                      { value: 'kanban' as const, label: '看板' },
                      { value: 'gantt' as const, label: '甘特' },
                      { value: 'metrics' as const, label: '度量' },
                    ])
                  : []),
              ]}
            />
            <div className="text-xs text-muted-foreground">
              <span className="num text-foreground font-medium">{taskSummary.doneTasks}/{taskSummary.totalTasks}</span> 完成
              <span className="mx-1.5 text-border">·</span>
              当前 {taskSummary.currentPhaseName}{' '}
              <span className="num text-foreground font-medium">{taskSummary.currentPhaseDone}/{taskSummary.currentPhaseTotal}</span>
            </div>
          </div>

          {/* 阶段筛选器：全部 + 各阶段，统一作用看板/列表/甘特；阶段多时横向滚动 */}
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex w-max items-center gap-1.5">
              {([{ id: 'all', name: '全部' }, ...projectPhases] as { id: string; name: string }[]).map((p) => {
                const isActive = taskPhaseFilter === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setTaskPhaseFilter(p.id)}
                    className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-primary text-white'
                        : 'border border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 列表 sub-view ──────────────────────────────────────────────── */}
          {taskView === 'list' && (
        <>
          {/* Phase Navigation */}
          <LinearCard className="overflow-x-auto">
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
                        ? 'border-b-primary bg-secondary'
                        : 'border-b-transparent hover:bg-secondary'
                    } ${!unlocked ? 'opacity-60' : ''}`}
                  >
                    <div className="text-[9px] num uppercase tracking-widest text-muted-foreground mb-0.5">{phase.code}</div>
                    <div className={`text-xs font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                      {phase.nameEn}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      {!unlocked ? (
                        <Lock size={10} className="text-muted-foreground shrink-0" />
                      ) : status === 'completed' ? (
                        <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                      ) : status === 'active' ? (
                        <Zap size={10} className="text-primary shrink-0" />
                      ) : (
                        <Circle size={10} className="text-muted-foreground shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </LinearCard>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Task List */}
            <div className="lg:col-span-2 space-y-3">
              {/* Phase Header */}
              <LinearCard className="p-5" style={{ borderLeftWidth: 4, borderLeftColor: activePhase?.color }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{activePhase?.code}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">·</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{activePhase?.duration}</span>
                    </div>
                    <h2 className="text-2xl font-bold tracking-[-0.3px] text-foreground">{activePhase?.name}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{activePhase?.desc}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="text-2xl font-semibold text-foreground num">{activeProgress}%</div>
                    <div className="text-[10px] text-muted-foreground">完成</div>
                  </div>
                </div>
                <LinearBar value={activeProgress} className="h-1.5" />
                <div className="mt-3 flex items-center gap-1.5">
                  <Target size={12} className="text-primary" />
                  <span className="text-xs font-medium text-foreground">Gate: {activePhase?.gate}</span>
                </div>
              </LinearCard>

              {/* Gate Lock Banner */}
              {!isCurrentPhaseUnlocked && blockingGate && (
                <div className="flex items-start gap-3 p-4 rounded-md bg-rose-50 border border-rose-200 border-l-4 border-l-rose-500">
                  <ShieldAlert size={18} className="text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold text-rose-800 mb-0.5">此阶段已锁定</div>
                    <div className="text-xs text-rose-700">
                      请先完成 <span className="num font-semibold">{blockingGate.phaseName}</span> 的
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
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[color:var(--acc-soft)] border border-[color:var(--acc-border)] text-xs text-primary">
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
                  const isGateTask = task.id === activePhase?.gateTaskId;
                  const locked = !isCurrentPhaseUnlocked;
                  const selected = selectedTaskId === task.id;
                  // status 为主状态;checked 已由 status 派生(done/skipped),直接显示真实状态
                  const status = details?.taskStatus || (checked ? 'done' : 'todo');
                  const isPendingApproval = status === 'pending_approval';

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`rounded-[10px] border transition-all cursor-pointer min-h-[118px] shadow-[0_1px_2px_rgb(0_0_0/0.03)] ${
                        locked
                          ? 'border-border bg-secondary/40 opacity-60'
                        : isGateTask
                          ? checked
                            ? 'border-l-4 border-l-emerald-500 border-border bg-emerald-50/30'
                            : 'border-l-4 border-l-primary border-[color:var(--acc-border)] bg-[color:var(--acc-soft)]'
                          : checked
                          ? 'border-l-2 border-l-primary border-border bg-secondary/50'
                          : 'border-border bg-card'
                      } ${selected ? 'ring-2 ring-[color:var(--acc-border)] border-[color:var(--acc-border)]' : 'hover:border-[color:var(--acc-border)] hover:bg-secondary/40 hover:shadow-md'}`}
                    >
                      {/* Gate Task Label */}
                      {isGateTask && (
                        <div className={`flex items-center gap-1.5 px-3 pt-2 pb-0 ${
                          checked ? 'text-emerald-700' : 'text-primary'
                        }`}>
                          <Flag size={10} />
                          <span className="text-[9px] uppercase tracking-widest font-semibold">
                            Gate 评审 · 通过后解锁下一阶段
                          </span>
                        </div>
                      )}

                      <div className="flex items-start gap-3 p-3 group">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (locked) return;
                            // 待审批中：点击撤回（恢复为未完成，由 setTaskCompletion(completed=false) 处理）
                            if (isPendingApproval) { withdrawTaskApproval(task.id); return; }
                            isGateTask ? handleGateTaskToggle(task.id) : toggleTask(task.id);
                          }}
                          className={`mt-0.5 shrink-0 ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                          title={
                            locked ? '此阶段已锁定，请先完成前置 Gate 评审'
                            : isPendingApproval ? '待审批中，点击撤回'
                            : isGateTask && !checked ? '点击完成 Gate 评审并填写评审记录'
                            : undefined
                          }
                        >
                          {locked ? (
                            <Lock size={18} className="text-muted-foreground" />
                          ) : isPendingApproval ? (
                            <Clock size={18} className="text-[color:var(--warning)]" />
                          ) : checked ? (
                            <CheckCircle2 size={18} className={isGateTask ? 'text-emerald-600' : 'text-primary'} />
                          ) : (
                            <Circle size={18} className={`${isGateTask ? 'text-primary/50 hover:text-primary' : 'text-muted-foreground hover:text-foreground'} transition-colors`} />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${
                              locked ? 'text-muted-foreground' : checked ? 'text-muted-foreground line-through' : isGateTask ? 'text-foreground font-semibold' : 'text-foreground'
                            }`}>
                              {task.name}
                            </span>
                            <span className="text-[10px] num uppercase tracking-wider text-muted-foreground">{task.id}</span>
                            {!locked && hasInstructions && (
                              <span className="text-[10px] uppercase tracking-wider text-primary flex items-center gap-0.5">
                                <Edit3 size={9} /> 已批注
                              </span>
                            )}
                            {!locked && fileCount > 0 && (
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-0.5">
                                <Paperclip size={9} /> {fileCount}
                              </span>
                            )}
                          </div>
                          <p className={`text-xs mt-1 ${locked || checked ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
                            {task.desc}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <span className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 ${
                              isPendingApproval
                                ? 'text-[color:var(--warning)] border-[color:var(--acc-border)] bg-[color:var(--acc-soft)]'
                                : 'text-muted-foreground border-border bg-secondary'
                            }`}>
                              {status === 'done' ? '已完成' :
                                status === 'pending_approval' ? '待审批' :
                                status === 'in_progress' ? '进行中' :
                                status === 'blocked' ? '阻塞' :
                                status === 'skipped' ? '跳过' : '待开始'}
                            </span>
                            {details?.taskPriority && (
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground rounded border border-border bg-secondary px-1.5 py-0.5">
                                {details.taskPriority}
                              </span>
                            )}
                            {selected && (
                              <span className="text-[10px] uppercase tracking-wider text-primary bg-[color:var(--acc-soft)] border border-[color:var(--acc-border)] rounded px-1.5 py-0.5">
                                详情已打开
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight size={16} className={`shrink-0 mt-0.5 transition-colors ${selected ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
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
                  className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
                  onClick={() => setSelectedTaskId(null)}
                >
                  <div
                    className="relative w-full max-w-4xl h-fit my-auto rounded-[11px] border border-border bg-card shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => setSelectedTaskId(null)}
                      className="absolute top-3.5 right-3.5 z-10 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      title="关闭 (Esc)"
                    >
                      <X size={18} />
                    </button>
                    <div className="max-h-[86vh] overflow-y-auto p-6">
                    {/* ── Header (full width) ───────────────────────────────── */}
                    <div className="flex items-start justify-between gap-3 pr-8">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{selectedTask.id}</span>
                          {selectedTaskIsGate && (
                            <span className="text-[9px] uppercase tracking-wider rounded bg-[color:var(--acc-soft)] text-primary border border-[color:var(--acc-border)] px-1.5 py-0.5">
                              Gate
                            </span>
                          )}
                          {selectedTaskChecked && (
                            <span className="text-[9px] uppercase tracking-wider rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5">
                              Done
                            </span>
                          )}
                        </div>
                        <h3 className="text-xl font-bold tracking-[-0.3px] leading-tight text-foreground">{selectedTask.name}</h3>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{selectedTask.desc}</p>
                      </div>
                    </div>

                    {!isCurrentPhaseUnlocked && (
                      <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        <Lock size={13} className="shrink-0 mt-0.5" />
                        <span>
                          {blockingGate ? (
                            <>前置条件未完成：需先通过 <span className="num font-semibold">{blockingGate.phaseName}</span> 的 Gate 评审「{blockingGate.gateTaskName}」。本任务暂仅可查看。</>
                          ) : (
                            <>此阶段被前置 Gate 锁定，当前任务详情仅可查看。</>
                          )}
                        </span>
                      </div>
                    )}

                    {/* ── Body: two columns ─────────────────────────────────── */}
                    <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_300px]">

                      {/* ── Left main column ────────────────────────────────── */}
                      <div className="min-w-0 space-y-4">
                        {selectedTask.guide && (
                          <div className="p-3 rounded-md border-l-2 border-primary bg-[color:var(--acc-soft)]">
                            <div className="text-[10px] uppercase tracking-widest text-primary mb-1.5">操作指南</div>
                            <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">{selectedTask.guide}</pre>
                          </div>
                        )}

                        <div>
                          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                            <Target size={11} />
                            交付物
                          </div>
                          <DeliverablesChecklist
                            projectId={project.id}
                            phaseId={activePhaseId}
                            taskId={selectedTask.id}
                            items={
                              selectedTaskIsGate
                                ? activeGateDeliverables
                                : getTaskDeliverables(selectedTask.id, activePhase?.deliverables || [])
                            }
                            status={selectedTaskDetails?.deliverables || {}}
                            canEdit={canActOnSelectedTask && isCurrentPhaseUnlocked}
                            carried={selectedTaskIsGate ? activeGateCarriedMap : undefined}
                          />
                          {selectedTaskIsGate && (
                            <GateDeliverableOverridePanel
                              projectId={project.id}
                              phaseId={activePhaseId}
                              effectiveDeliverables={activeGateDeliverables}
                              /* 与服务端一致：仅管理员 / 项目 PM(pmUserId 或 pm 角色) 可裁剪，避免 owner/rd_* 看到必失败的按钮 */
                              canEdit={currentUser?.role === 'admin' || project.pmUserId === currentUser?.id || perms.role === 'pm'}
                            />
                          )}
                          {selectedTaskIsGate && activeGateDeliverables.length > 0 && (
                            <DeliverableReviewControls
                              projectId={project.id}
                              phaseId={activePhaseId}
                              deliverableNames={activeGateDeliverables}
                              canEditTasks={perms.canEditTasks}
                              canSubmitDeliverable={(name) => canSubmitDeliverableFromUi({
                                deliverableName: name,
                                role: perms.role,
                                canEditTasks: perms.canEditTasks,
                                canEditProjectInfo: perms.canEditProjectInfo,
                                isTaskAssignee: selectedTaskDetails?.assigneeUserId != null
                                  && selectedTaskDetails.assigneeUserId === currentUser?.id,
                                taskVisibleRoles: selectedTaskRoles,
                              })}
                              currentUserId={currentUser?.id}
                              isAdmin={currentUser?.role === 'admin'}
                              gateTaskId={activePhase?.gateTaskId}
                              pmUserId={project.pmUserId ?? null}
                            />
                          )}
                        </div>

                        {/* ── Gate-only sections (under 交付物) ──────────────── */}
                        {selectedTaskIsGate && (() => {
                          const r = computeGateReadiness(activePhase, activePhaseData, activeGateDeliverables, serverDelivSatisfiedSet);
                          return (
                            <div className={`p-3 rounded-md border ${r.ready ? 'border-emerald-200 bg-emerald-50/50' : 'border-[color:var(--acc-border)] bg-[color:var(--acc-soft)]'}`}>
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Gate 就绪检查</div>
                                <span className={`text-[10px] rounded px-1.5 py-0.5 border ${r.ready ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]'}`}>
                                  {r.ready ? '已就绪' : '未就绪'}
                                </span>
                              </div>
                              <div className="divide-y divide-border">
                                <ReadinessRow label="阶段任务完成" ok={r.tasksDone === r.tasksTotal} detail={`${r.tasksDone}/${r.tasksTotal}`} />
                                <ReadinessRow label="交付物审核" ok={r.delivTotal === 0 || r.delivDone === r.delivTotal} detail={`${r.delivDone}/${r.delivTotal}`} />
                                <ReadinessRow label="无未关闭 P0/P1" ok={r.openP0P1 === 0} detail={r.openP0P1 === 0 ? '通过' : `${r.openP0P1} 个待关闭`} />
                                <ReadinessRow label="关键文件已上传" ok={r.fileCount > 0} detail={`${r.fileCount} 个`} soft />
                              </div>
                              {r.signoffRoles.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-border">
                                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">需会签角色</div>
                                  <div className="flex flex-wrap gap-1">
                                    {r.signoffRoles.map((role, i) => (
                                      <span key={i} className="text-[10px] text-muted-foreground bg-card border border-border rounded px-1.5 py-0.5">{role}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {!r.ready && (
                                <div className="mt-2 pt-2 border-t border-[color:var(--acc-border)] text-xs text-primary leading-relaxed">
                                  未就绪:{r.blockers.join('、')}。补齐后再通过;若需放行,请在评审里选「有条件通过」并填写例外项的责任人与截止。
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {selectedTaskIsGate && activePhase?.gateStandard && (
                          <div className="p-3 rounded-md border-l-2 border-l-primary bg-secondary">
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Gate 管理标准</div>
                            <GateStandardPanel standard={activePhase.gateStandard} compact evidenceHint />
                          </div>
                        )}

                        <div className="p-3 rounded-md bg-secondary/40">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                              <Bug size={11} />
                              关联问题
                            </div>
                            {perms.canEditIssues && isCurrentPhaseUnlocked && (
                              <button
                                onClick={handleCreateIssueFromSelectedTask}
                                className="text-[10px] rounded px-2 py-1 text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
                              >
                                从此任务创建 Issue
                              </button>
                            )}
                          </div>
                          {selectedTaskIssues.length === 0 ? (
                            <div className="mt-2 text-xs text-muted-foreground">暂无关联问题。</div>
                          ) : (
                            <div className="mt-2 divide-y divide-border">
                              {selectedTaskIssues.map((issue) => (
                                <div key={issue.id} className="py-2 flex items-start gap-2">
                                  <span className={`mt-0.5 text-[10px] num rounded px-1.5 py-0.5 border ${
                                    issue.severity === 'P0' || issue.severity === 'P1'
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-secondary text-muted-foreground border-border'
                                  }`}>
                                    {issue.severity}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm text-foreground truncate">{issue.title}</div>
                                    <div className="text-[11px] text-muted-foreground">
                                      {issueStatusLabel(issue.status)}{issue.owner ? ` · ${issue.owner}` : ''}
                                      {(issue.duplicateCount ?? 1) > 1 ? ` · 重复 ${issue.duplicateCount} 条` : ''}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {selectedTaskIsGate && (() => {
                          const reviews = activePhaseData?.gateReviews || [];
                          const latest = reviews[reviews.length - 1];
                          if (selectedTaskChecked && latest) {
                            return (
                              <div className={`rounded-md border p-3 ${
                                latest.decision === 'approved' ? 'border-emerald-200 bg-emerald-50/50' :
                                latest.decision === 'conditional' ? 'border-[color:var(--acc-border)] bg-[color:var(--acc-soft)]' :
                                'border-rose-200 bg-rose-50/50'
                              }`}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">评审记录</span>
                                    {reviews.length > 1 && (
                                      <span className="text-[9px] num text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border border-border">
                                        共 {reviews.length} 次
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => setGateReviewPending({ phaseId: activePhaseId })}
                                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    查看历史
                                  </button>
                                </div>
                                <GateReviewBadge review={latest} />
                                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                  <div><span className="text-muted-foreground">参与人：</span>{latest.participants}</div>
                                  {latest.conditions && (
                                    <div className="col-span-2"><span className="text-muted-foreground">条件：</span>{latest.conditions}</div>
                                  )}
                                  {latest.notes && (
                                    <div className="col-span-2 mt-1 text-muted-foreground italic">{latest.notes}</div>
                                  )}
                                </div>
                              </div>
                            );
                          }
                          if (selectedTaskChecked && !latest) {
                            return (
                              <button
                                onClick={() => setGateReviewPending({ phaseId: activePhaseId })}
                                className="w-full text-xs text-primary rounded-md border border-dashed border-[color:var(--acc-border)] py-2 hover:bg-[color:var(--acc-soft)] transition-colors"
                              >
                                + 补充填写 Gate 评审记录
                              </button>
                            );
                          }
                          return null;
                        })()}

                        {/* ── 执行说明 (left main) ──────────────────────────── */}
                        <TaskDetail
                          taskId={selectedTask.id}
                          taskDetails={selectedTaskDetails || { instructions: '', files: [] }}
                          onUpdate={(details) => updateTaskDetails(selectedTask.id, details)}
                          canEdit={canActOnSelectedTask && isCurrentPhaseUnlocked}
                          compact={compactTaskDetail}
                          projectId={project.id}
                          phaseId={activePhaseId}
                          layout="main"
                        />

                        {/* ── Tab bar (评论 / 活动 / 流转 / 状态审批) ─────────── */}
                        <div className="border-t border-border pt-3">
                          <div className="flex items-center gap-4 border-b border-border -mb-px">
                            {([
                              ['comments', '评论'],
                              ['activity', '活动'],
                              ['flow', '流转'],
                              ['approval', '状态审批'],
                            ] as const).map(([key, label]) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setTaskTab(key)}
                                className={`relative pb-2 text-xs transition-colors ${
                                  taskTab === key
                                    ? 'text-foreground font-medium border-b-2 border-primary'
                                    : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <div className="pt-3">
                            {taskTab === 'comments' && (
                              <CommentThread
                                entityType="task"
                                entityId={`${project.id}:${selectedTask.id}`}
                                projectId={project.id}
                              />
                            )}
                            {taskTab === 'activity' && (
                              <TaskActivityTab
                                projectId={project.id}
                                phaseId={activePhaseId}
                                taskId={selectedTask.id}
                                users={detailUsers}
                              />
                            )}
                            {taskTab === 'flow' && (
                              <TaskFlowTab
                                projectId={project.id}
                                phaseId={activePhaseId}
                                taskId={selectedTask.id}
                                users={detailUsers}
                              />
                            )}
                            {taskTab === 'approval' && (
                              <TaskApprovalTab
                                projectId={project.id}
                                phaseId={activePhaseId}
                                taskId={selectedTask.id}
                                users={detailUsers}
                                approvalStatus={selectedTaskDetails?.approvalStatus ?? 'none'}
                                approverUserId={selectedTaskDetails?.approverUserId ?? null}
                                approvalNote={selectedTaskDetails?.approvalNote ?? null}
                                canDecide={
                                  selectedTaskDetails?.approverUserId === currentUser?.id ||
                                  currentUser?.role === 'admin'
                                }
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* ── Right sidebar: 属性 ──────────────────────────────── */}
                      <aside className="rounded-lg border border-border bg-secondary p-3 h-fit space-y-3">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">属性</div>
                        {/* 责任角色 (read-only summary). 可见岗位移入「任务设置」⚙ 弹层。 */}
                        <div className="space-y-1.5 text-xs">
                          <div className="flex gap-2">
                            <span className="w-16 shrink-0 text-muted-foreground">责任角色</span>
                            <span className="text-foreground">{selectedTask.owner || '未指定'}</span>
                          </div>
                          {selectedTaskIsGate && activePhase?.gateStandard?.responsibleRoles?.length > 0 && (
                            <div className="pt-1 text-muted-foreground">
                              <div className="mb-1">Gate 责任分工</div>
                              <div className="space-y-1">
                                {activePhase.gateStandard.responsibleRoles.map((role, i) => (
                                  <div key={i} className="flex items-start gap-2 text-foreground">
                                    <span className="text-muted-foreground mt-0.5">▸</span>
                                    <span>{role}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        {/* meta (assignee/due/status/priority) + 需审批配置 + 附件 + 可见岗位编辑 */}
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
                          currentUserId={currentUser?.id}
                          canEdit={canActOnSelectedTask && isCurrentPhaseUnlocked}
                          /* 优先级仅管理/PM 可改 */
                          canEditPriority={perms.canEditProjectInfo}
                          /* 文件上传/删除限负责人本人或管理/PM */
                          canUploadFiles={
                            (selectedTaskDetails?.assigneeUserId != null
                              && selectedTaskDetails.assigneeUserId === currentUser?.id)
                            || perms.canEditProjectInfo
                          }
                          compact={compactTaskDetail}
                          projectId={project.id}
                          phaseId={activePhaseId}
                          layout="sidebar"
                        />
                      </aside>
                    </div>
                    </div>{/* /scroll-body */}
                  </div>{/* /modal-panel */}
                </div>
              )}

              {/* Phase Notes */}
              <LinearCard className="p-5">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">阶段备注</div>
                <textarea
                  value={activePhaseData?.notes || ''}
                  disabled={!perms.canEditProjectInfo}
                  onChange={(e) => {
                    if (!perms.canEditProjectInfo) return;
                    const newProject = { ...project };
                    newProject.phases = { ...project.phases };
                    newProject.phases[activePhaseId] = { ...activePhaseData, notes: e.target.value };
                    onUpdate(newProject);
                  }}
                  rows={5}
                  placeholder={perms.canEditProjectInfo ? '记录阶段备注、决策记录、风险说明...' : '仅 Owner/管理层/PM 可编辑阶段备注'}
                  className="w-full text-xs text-foreground rounded-md border border-border focus:border-[color:var(--acc-border)] outline-none px-3 py-2 resize-none transition-colors disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
                />
              </LinearCard>

              {/* Phase Progress Summary */}
              <LinearCard className="p-5">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">全阶段进度</div>
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
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{phase.code}</span>
                          </div>
                          <span className="text-[10px] num text-muted-foreground">{prog}%</span>
                        </div>
                        <ProgressBar
                          value={prog}
                          color={status === 'completed' ? 'bg-emerald-500' : status === 'active' ? 'bg-primary' : 'bg-secondary'}
                          height="h-1"
                        />
                      </div>
                    );
                  })}
                </div>
              </LinearCard>
            </div>
          </div>
        </>
          )}

          {/* ── 看板 sub-view ──────────────────────────────────────────────── */}
          {taskView === 'kanban' && !execLens && (
            <KanbanBoard project={project} onUpdate={onUpdate} canEdit={perms.canEditTasks} phaseFilter={taskPhaseFilter} />
          )}

          {/* ── 甘特 sub-view ──────────────────────────────────────────────── */}
          {taskView === 'gantt' && !execLens && (
            <div className="space-y-3">
              <div className="flex items-center gap-0 rounded-md border border-border w-fit overflow-hidden">
                {([['task', '任务视图'], ['phase', '阶段视图']] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setGanttMode(m)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${ganttMode === m ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {ganttMode === 'task' ? (
                <TaskGanttView project={project} phaseFilter={taskPhaseFilter} onTaskClick={(phaseId, taskId) => { setActivePhaseId(phaseId); setSelectedTaskId(taskId); setTaskView('list'); setMainTab('tasks'); }} />
              ) : (
                <GanttView
                  project={project}
                  onUpdate={onUpdate}
                  onPhaseClick={handleGanttPhaseClick}
                  readOnly={!perms.canEditProjectInfo}
                />
              )}
            </div>
          )}

          {/* ── 度量 sub-view ──────────────────────────────────────────────── */}
          {taskView === 'metrics' && !execLens && (
            <MetricsView project={project} />
          )}
        </div>
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
          projectId={project.id}
          gateTaskId={activePhase?.gateTaskId}
          /* 就绪清单上传/删除按钮：viewer 隐藏，避免点了就 403 */
          canEditDeliverables={perms.role !== 'viewer' && (perms.canEditProjectInfo || perms.canEditTasks)}
          blockers={computeGateReadiness(activePhase, activePhaseData, activeGateDeliverables, serverDelivSatisfiedSet).blockers}
          onConfirm={perms.canGateReview
            ? handleGateReviewConfirm
            // readOnly 下表单不会渲染；这里兜底报错而不是静默丢弃，防止未来回归
            : () => toast.error('只有管理层可以提交 Gate 评审结论')}
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
